'use strict';
/**
 * 加速通道：基于 mihomo (Clash Meta) 内核的本地代理管理。
 * 支持订阅 URL / 本地文件导入，节点选择，启停后为网关注入 HTTP(S)_PROXY。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const net = require('net');

let MIXED_PORT = 17890;
const CONTROLLER_HOST = '127.0.0.1';
let CONTROLLER_PORT = 19090;
const CONTROLLER_SECRET = 'nexora-acc-secret';
const MIHOMO_VERSION = 'v1.19.28';

const NO_PROXY_LIST = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '.weixin.qq.com',
    '.qq.com',
    '.wechat.com',
    '.feishu.cn',
    '.feishu.net',
    '.larksuite.com',
    '.dingtalk.com'
].join(',');

let appRef = null;
let mihomoProc = null;
let state = {
    enabled: false,
    activeProfileId: null,
    selectedProxy: null,
    selectedGroup: 'GLOBAL',
    mode: 'rule',
    systemProxy: false,
    virtualNic: false
};

function getRootDir() {
    const base = appRef && appRef.getPath
        ? appRef.getPath('userData')
        : path.join(process.env.APPDATA || process.cwd(), 'Nexora Agent');
    return path.join(base, 'acceleration');
}

function getProfilesDir() {
    return path.join(getRootDir(), 'profiles');
}

function getCoreDir() {
    return path.join(getRootDir(), 'core');
}

function getStatePath() {
    return path.join(getRootDir(), 'state.json');
}

function getRuntimeConfigPath() {
    return path.join(getRootDir(), 'runtime-config.yaml');
}

function ensureDirs() {
    for (const d of [getRootDir(), getProfilesDir(), getCoreDir()]) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    }
}

function init(electronApp) {
    appRef = electronApp;
    ensureDirs();
    loadState();
}

function loadState() {
    try {
        const p = getStatePath();
        if (!fs.existsSync(p)) return;
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        state = { ...state, ...raw };
    } catch (e) {}
}

function saveState() {
    ensureDirs();
    try {
        fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {}
}

function getMihomoExeName() {
    return process.platform === 'win32' ? 'mihomo.exe' : 'mihomo';
}

function getMihomoPath() {
    return path.join(getCoreDir(), getMihomoExeName());
}

function isCoreReady() {
    try {
        return fs.existsSync(getMihomoPath());
    } catch (e) {
        return false;
    }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const follow = (currentUrl, redirects) => {
            if (redirects > 8) return reject(new Error('Too many redirects'));
            let parsed;
            try { parsed = new URL(currentUrl); } catch (e) { return reject(e); }
            const lib = parsed.protocol === 'https:' ? https : http;
            const req = lib.get(currentUrl, {
                headers: { 'User-Agent': 'NexoraAgent/2.0', Accept: '*/*' },
                timeout: 120000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    const next = new URL(res.headers.location, currentUrl).toString();
                    return follow(next, redirects + 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    try {
                        fs.writeFileSync(destPath, Buffer.concat(chunks));
                        resolve(destPath);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Download timeout'));
            });
        };
        follow(url, 0);
    });
}

async function ensureCore(onProgress) {
    ensureDirs();
    if (isCoreReady()) return { success: true, path: getMihomoPath() };

    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const zipName = process.platform === 'win32'
        ? `mihomo-windows-${arch}-${MIHOMO_VERSION}.zip`
        : process.platform === 'darwin'
            ? `mihomo-darwin-${arch}-${MIHOMO_VERSION}.gz`
            : `mihomo-linux-${arch}-${MIHOMO_VERSION}.gz`;
    const githubUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${zipName}`;
    const mirrors = [
        githubUrl,
        `https://ghproxy.net/${githubUrl}`,
        `https://mirror.ghproxy.com/${githubUrl}`
    ];

    const tmpPath = path.join(getCoreDir(), zipName);
    let lastErr = null;
    for (const url of mirrors) {
        try {
            if (typeof onProgress === 'function') onProgress({ stage: 'download', url });
            await downloadFile(url, tmpPath);
            lastErr = null;
            break;
        } catch (e) {
            lastErr = e;
        }
    }
    if (lastErr) {
        return { success: false, error: `下载代理内核失败: ${lastErr.message || lastErr}` };
    }

    try {
        if (typeof onProgress === 'function') onProgress({ stage: 'extract' });
        if (zipName.endsWith('.zip')) {
            await extractZipWindows(tmpPath, getCoreDir());
        } else {
            const gunzipped = zlib.gunzipSync(fs.readFileSync(tmpPath));
            fs.writeFileSync(getMihomoPath(), gunzipped);
            try { fs.chmodSync(getMihomoPath(), 0o755); } catch (e) {}
        }
        try { fs.unlinkSync(tmpPath); } catch (e) {}
        if (!isCoreReady()) {
            // zip 内可能带版本号文件名，扫描目录
            const files = fs.readdirSync(getCoreDir());
            const hit = files.find((f) => /^mihomo/i.test(f) && (f.endsWith('.exe') || !f.includes('.')));
            if (hit) {
                const src = path.join(getCoreDir(), hit);
                if (src !== getMihomoPath()) {
                    try { fs.renameSync(src, getMihomoPath()); } catch (e) {
                        fs.copyFileSync(src, getMihomoPath());
                    }
                }
            }
        }
        if (!isCoreReady()) {
            return { success: false, error: '内核解压后未找到 mihomo 可执行文件' };
        }
        return { success: true, path: getMihomoPath() };
    } catch (e) {
        return { success: false, error: `解压内核失败: ${e.message || e}` };
    }
}

function extractZipWindows(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destDir.replace(/'/g, "''")}')
`;
        const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', ps], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(err || `unzip exit ${code}`));
        });
        child.on('error', reject);
    });
}

function fetchText(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 8) return reject(new Error('Too many redirects'));
        let parsed;
        try { parsed = new URL(url); } catch (e) { return reject(e); }
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': 'ClashMetaForAndroid/2.11.1',
                Accept: '*/*'
            },
            timeout: 60000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return fetchText(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                let text = buf.toString('utf8');
                // 订阅常见 base64
                const trimmed = text.replace(/\s+/g, '');
                if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 80) {
                    try {
                        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
                        if (decoded.includes('proxies:') || decoded.includes('proxy-groups:') || decoded.includes('port:')) {
                            text = decoded;
                        }
                    } catch (e) {}
                }
                resolve(text);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
    });
}

function sanitizeProfileName(name) {
    const n = String(name || '订阅').trim().slice(0, 48) || '订阅';
    return n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function listProfiles() {
    ensureDirs();
    const metaPath = path.join(getRootDir(), 'profiles.json');
    let list = [];
    try {
        if (fs.existsSync(metaPath)) list = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {}
    if (!Array.isArray(list)) list = [];
    return list.filter((p) => p && p.id && fs.existsSync(path.join(getProfilesDir(), `${p.id}.yaml`)));
}

function saveProfilesMeta(list) {
    ensureDirs();
    fs.writeFileSync(path.join(getRootDir(), 'profiles.json'), JSON.stringify(list, null, 2), 'utf8');
}

function writeProfileYaml(id, content) {
    ensureDirs();
    const file = path.join(getProfilesDir(), `${id}.yaml`);
    fs.writeFileSync(file, content, 'utf8');
    return file;
}

function buildRuntimeYaml(profileContent) {
    let body = String(profileContent || '').replace(/^\uFEFF/, '');
    // 去掉可能冲突的端口/控制器配置行，统一由我们注入
    const dropKeys = [
        /^mixed-port\s*:/i,
        /^port\s*:/i,
        /^socks-port\s*:/i,
        /^redir-port\s*:/i,
        /^tproxy-port\s*:/i,
        /^external-controller\s*:/i,
        /^secret\s*:/i,
        /^allow-lan\s*:/i,
        /^bind-address\s*:/i,
        /^external-ui\s*:/i,
        /^mode\s*:/i,
        /^log-level\s*:/i,
        /^ipv6\s*:/i
    ];

    // 需要整块剔除的顶层 YAML 节点（包含其所有缩进子行）
    const blockDropKeys = [/^tun\s*:/i, /^geox-url\s*:/i, /^dns\s*:/i];

    let inBlock = false;
    const lines = body.split(/\r?\n/).filter((line) => {
        const trimmed = line.trim();
        if (dropKeys.some((re) => re.test(trimmed))) return false;

        // 检测是否进入需要整块删除的 YAML 节点
        if (blockDropKeys.some((re) => re.test(line))) {
            inBlock = true;
            return false;
        }
        if (inBlock) {
            // 缩进行或空行都属于该块的子行
            if (/^\s+/.test(line) || trimmed === '') {
                return false;
            } else {
                // 遇到新的非缩进行，退出块模式
                inBlock = false;
            }
        }
        return true;
    });
    body = lines.join('\n');

    const mode = ['rule', 'global', 'direct'].includes(state.mode) ? state.mode : 'rule';
    const header = [
        `mixed-port: ${MIXED_PORT}`,
        'allow-lan: false',
        `mode: ${mode}`,
        'log-level: warning',
        `external-controller: ${CONTROLLER_HOST}:${CONTROLLER_PORT}`,
        `secret: "${CONTROLLER_SECRET}"`,
        'ipv6: false',
        'geox-url:',
        '  geoip: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"',
        '  geosite: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"',
        '  mmdb: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"',
        'tun:',
        `  enable: ${state.virtualNic ? 'true' : 'false'}`,
        '  stack: gvisor',
        '  auto-route: true',
        '  auto-detect-interface: true',
        '  dns-hijack:',
        '    - any:53',
        'dns:',
        '  enable: true',
        '  listen: 0.0.0.0:1053',
        '  enhanced-mode: fake-ip',
        '  fake-ip-range: 198.18.0.1/16',
        '  nameserver:',
        '    - https://dns.alidns.com/dns-query',
        '    - https://doh.pub/dns-query',
        '  fallback:',
        '    - https://dns.google/dns-query',
        '    - https://cloudflare-dns.com/dns-query',
        '  fallback-filter:',
        '    geoip: true',
        '    geoip-code: CN',
        ''
    ].join('\n');

    return header + body;
}

async function addProfileFromUrl(url, name) {
    const content = await fetchText(String(url).trim());
    if (!content || (!content.includes('proxies') && !content.includes('proxy-providers'))) {
        throw new Error('订阅内容不是有效的 Clash/Mihomo 配置');
    }
    return addProfileFromContent(content, name || guessNameFromUrl(url), { source: 'url', url: String(url).trim() });
}

function guessNameFromUrl(url) {
    try {
        const u = new URL(url);
        return sanitizeProfileName(u.hostname || 'URL订阅');
    } catch (e) {
        return 'URL订阅';
    }
}

function addProfileFromContent(content, name, meta = {}) {
    ensureDirs();
    const id = crypto.randomBytes(6).toString('hex');
    writeProfileYaml(id, content);
    const list = listProfiles();
    const profile = {
        id,
        name: sanitizeProfileName(name),
        createdAt: Date.now(),
        ...meta
    };
    list.push(profile);
    saveProfilesMeta(list);
    if (!state.activeProfileId) {
        state.activeProfileId = id;
        saveState();
    }
    return profile;
}

function addProfileFromFile(filePath, name) {
    const content = fs.readFileSync(filePath, 'utf8');
    const base = path.basename(filePath, path.extname(filePath));
    return addProfileFromContent(content, name || base, { source: 'file', file: filePath });
}

function removeProfile(id) {
    const list = listProfiles().filter((p) => p.id !== id);
    saveProfilesMeta(list);
    try { fs.unlinkSync(path.join(getProfilesDir(), `${id}.yaml`)); } catch (e) {}
    if (state.activeProfileId === id) {
        state.activeProfileId = list[0] ? list[0].id : null;
        saveState();
    }
    return list;
}

function renameProfile(id, newName) {
    const list = listProfiles();
    const profile = list.find((p) => p.id === id);
    if (!profile) throw new Error('配置不存在');
    profile.name = String(newName || '').trim() || profile.id;
    saveProfilesMeta(list);
    return profile;
}

async function updateProfileFromUrl(id) {
    const list = listProfiles();
    const profile = list.find((p) => p.id === id);
    if (!profile) throw new Error('配置不存在');
    if (!profile.url) throw new Error('该配置不是 URL 订阅，无法在线更新');
    const content = await fetchText(String(profile.url).trim());
    if (!content || (!content.includes('proxies') && !content.includes('proxy-providers'))) {
        throw new Error('订阅内容不是有效的 Clash/Mihomo 配置');
    }
    writeProfileYaml(id, content);
    profile.updatedAt = Date.now();
    saveProfilesMeta(list);
    if (state.enabled && state.activeProfileId === id) {
        await startCore(id);
    }
    return profile;
}

function getProfileContent(id) {
    const file = path.join(getProfilesDir(), `${id}.yaml`);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
}

function parseProxiesFromYaml(yamlText) {
    const text = String(yamlText || '');
    const proxies = [];
    const lines = text.split(/\r?\n/);
    let inProxies = false;
    let current = null;

    const flush = () => {
        if (current && current.name) {
            proxies.push({
                name: current.name,
                type: (current.type || 'unknown').toLowerCase(),
                latency: null
            });
        }
        current = null;
    };

    // 辅助状态机解析 Flow Style 内联 YAML
    const parseInlineLine = (line) => {
        let clean = line.trim();
        if (clean.startsWith('-')) {
            clean = clean.substring(1).trim();
        }
        if (clean.startsWith('{') && clean.endsWith('}')) {
            clean = clean.substring(1, clean.length - 1).trim();
        } else {
            if (clean.startsWith('{')) clean = clean.substring(1).trim();
            if (clean.endsWith('}')) clean = clean.substring(0, clean.length - 1).trim();
        }

        const res = {};
        let i = 0;
        while (i < clean.length) {
            while (i < clean.length && /\s/.test(clean[i])) i++;
            if (i >= clean.length) break;

            let keyStart = i;
            while (i < clean.length && clean[i] !== ':') i++;
            if (i >= clean.length) break;
            const key = clean.substring(keyStart, i).trim();
            i++; // 跳过 ':'

            while (i < clean.length && /\s/.test(clean[i])) i++;
            if (i >= clean.length) break;

            let val = '';
            if (clean[i] === '"' || clean[i] === "'") {
                const quote = clean[i];
                i++; // 跳过引言号
                let valStart = i;
                while (i < clean.length) {
                    if (clean[i] === quote) {
                        if (clean[i - 1] === '\\') {
                            i++;
                            continue;
                        }
                        break;
                    }
                    i++;
                }
                val = clean.substring(valStart, i);
                if (i < clean.length) i++; // 跳过引言号

                while (i < clean.length && clean[i] !== ',') i++;
                if (i < clean.length) i++; // 跳过逗号
            } else {
                let valStart = i;
                while (i < clean.length && clean[i] !== ',') i++;
                val = clean.substring(valStart, i).trim();
                if (i < clean.length) i++; // 跳过逗号
            }
            res[key.toLowerCase()] = val;
        }
        return res;
    };

    for (const raw of lines) {
        const line = raw.replace(/\t/g, '  ');
        if (/^proxies\s*:/.test(line.trim())) {
            inProxies = true;
            continue;
        }
        if (inProxies && /^[A-Za-z0-9_-]+\s*:/.test(line) && !/^\s/.test(line)) {
            flush();
            inProxies = false;
            continue;
        }
        if (!inProxies) continue;

        // 如果是内联多字段 YAML
        if (line.includes('name:') && (line.includes('{') || line.includes(',') || line.includes('type:') || line.includes('server:'))) {
            flush();
            try {
                const inlineData = parseInlineLine(line);
                if (inlineData.name) {
                    proxies.push({
                        name: inlineData.name,
                        type: (inlineData.type || 'unknown').toLowerCase(),
                        latency: null
                    });
                }
            } catch (e) {
                console.warn('[Acceleration] parse inline line failed:', e.message);
            }
            continue;
        }

        const nameMatch = line.match(/^\s*-\s*name\s*:\s*(.+)$/i)
            || line.match(/^\s*name\s*:\s*(.+)$/i);
        const typeMatch = line.match(/^\s*type\s*:\s*(.+)$/i);
        const newItem = /^\s*-\s+/.test(line);

        if (newItem && /name\s*:/i.test(line)) {
            flush();
            current = {};
            const m = line.match(/name\s*:\s*(.+)$/i);
            if (m) current.name = stripYamlScalar(m[1]);
            const tm = line.match(/type\s*:\s*(\S+)/i);
            if (tm) current.type = stripYamlScalar(tm[1]);
            continue;
        }
        if (newItem && current) {
            flush();
            current = {};
        }
        if (nameMatch) {
            if (!current) current = {};
            current.name = stripYamlScalar(nameMatch[1]);
        }
        if (typeMatch && current) {
            current.type = stripYamlScalar(typeMatch[1]);
        }
    }
    flush();
    return proxies;
}

function stripYamlScalar(v) {
    let s = String(v || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1);
    }
    return s.trim();
}

function guessFlag(name) {
    const n = String(name || '');
    if (/香港|HK|Hong\s*Kong/i.test(n)) return 'hk';
    if (/台湾|TW|Taiwan/i.test(n)) return 'tw';
    if (/日本|JP|Japan|东京|大阪/i.test(n)) return 'jp';
    if (/新加坡|SG|Singapore/i.test(n)) return 'sg';
    if (/美国|US|USA|United\s*States|洛杉矶|硅谷/i.test(n)) return 'us';
    if (/韩国|KR|Korea|首尔/i.test(n)) return 'kr';
    if (/英国|UK|Britain|伦敦/i.test(n)) return 'gb';
    if (/德国|DE|Germany/i.test(n)) return 'de';
    if (/法国|FR|France/i.test(n)) return 'fr';
    if (/加拿大|CA|Canada/i.test(n)) return 'ca';
    if (/澳大利亚|AU|Australia|悉尼/i.test(n)) return 'au';
    if (/俄罗斯|RU|Russia/i.test(n)) return 'ru';
    if (/土耳其|TR|Turkey/i.test(n)) return 'tr';
    if (/马来|MY|Malaysia/i.test(n)) return 'my';
    if (/泰国|TH|Thailand/i.test(n)) return 'th';
    if (/越南|VN|Vietnam/i.test(n)) return 'vn';
    if (/菲律宾|PH|Philippines/i.test(n)) return 'ph';
    if (/印度|IN|India/i.test(n)) return 'in';
    if (/阿根廷|AR|Argentina/i.test(n)) return 'ar';
    if (/巴西|BR|Brazil/i.test(n)) return 'br';
    if (/荷兰|NL|Netherlands/i.test(n)) return 'nl';
    return 'globe';
}

function controllerRequest(method, apiPath, bodyObj) {
    return new Promise((resolve, reject) => {
        const payload = bodyObj != null ? JSON.stringify(bodyObj) : null;
        const req = http.request({
            host: CONTROLLER_HOST,
            port: CONTROLLER_PORT,
            path: apiPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${CONTROLLER_SECRET}`,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: 15000
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
                else reject(new Error(`Controller ${res.statusCode}: ${text.slice(0, 200)}`));
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Controller timeout'));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

async function waitControllerReady(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await controllerRequest('GET', '/version');
            return true;
        } catch (e) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    return false;
}

async function stopCore() {
    if (mihomoProc) {
        try {
            mihomoProc.kill();
        } catch (e) {}
        mihomoProc = null;
    }

    // 强制彻底清理任何 mihomo 进程残留，确保端口 100% 被释放
    if (process.platform === 'win32') {
        try {
            // taskkill /F /IM 同步执行，阻塞直至进程完全退出，速度极快且稳定
            execSync('taskkill /F /IM mihomo.exe', { stdio: 'ignore' });
        } catch (e) {}
    } else {
        try {
            execSync('killall -9 mihomo', { stdio: 'ignore' });
        } catch (e) {}
    }

    // 给系统一点微小的时间来释放端口描述符
    await new Promise((r) => setTimeout(r, 200));
}

function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        server.listen(port, '127.0.0.1');
    });
}

async function getNextAvailablePort(startPort) {
    let port = startPort;
    while (port < 65535) {
        if (await isPortAvailable(port)) {
            return port;
        }
        port++;
    }
    return startPort;
}

async function startCore(profileId) {
    const id = profileId || state.activeProfileId;
    if (!id) throw new Error('请先添加加速厂商订阅');
    const content = getProfileContent(id);
    if (!content) throw new Error('订阅配置文件不存在');

    const ensured = await ensureCore();
    if (!ensured.success) throw new Error(ensured.error || '内核不可用');

    await stopCore();

    // 自动检测并避让占用端口
    MIXED_PORT = await getNextAvailablePort(17890);
    CONTROLLER_PORT = await getNextAvailablePort(19090);
    console.log(`[Acceleration] Auto allocated MIXED_PORT=${MIXED_PORT}, CONTROLLER_PORT=${CONTROLLER_PORT}`);

    const runtimeYaml = buildRuntimeYaml(content);
    fs.writeFileSync(getRuntimeConfigPath(), runtimeYaml, 'utf8');

    mihomoProc = spawn(getMihomoPath(), ['-d', getRootDir(), '-f', getRuntimeConfigPath()], {
        cwd: getRootDir(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    mihomoProc.on('exit', () => {
        mihomoProc = null;
        if (state.enabled) {
            state.enabled = false;
            saveState();
        }
    });

    const ready = await waitControllerReady(30000);
    if (!ready) {
        await stopCore();
        throw new Error('代理内核启动超时，请检查订阅配置是否有效');
    }

    state.activeProfileId = id;
    state.enabled = true;
    saveState();
    await applySystemProxy(state.systemProxy);

    if (state.selectedProxy) {
        try { await selectProxy(state.selectedGroup || 'GLOBAL', state.selectedProxy); } catch (e) {}
    }

    return getDashboardData(id);
}

async function setEnabled(enabled, profileId) {
    if (enabled) {
        return startCore(profileId || state.activeProfileId);
    }
    await stopCore();
    await applySystemProxy(false);
    state.enabled = false;
    saveState();
    return getDashboardData();
}

function powershell(script) {
    return new Promise((resolve) => {
        const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', `${script}; exit 0`], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', () => resolve({ out, err }));
        child.on('error', (e) => resolve({ out, err: e.message }));
    });
}

async function applySystemProxy(enabled) {
    if (process.platform !== 'win32') return { success: true, skipped: true };
    const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    if (enabled) {
        await powershell(`try { Set-ItemProperty -Path '${key}' -Name ProxyEnable -Type DWord -Value 1; Set-ItemProperty -Path '${key}' -Name ProxyServer -Type String -Value '127.0.0.1:${MIXED_PORT}'; Set-ItemProperty -Path '${key}' -Name ProxyOverride -Type String -Value 'localhost;127.*;<local>' } catch {}`);
    } else {
        await powershell(`try { Set-ItemProperty -Path '${key}' -Name ProxyEnable -Type DWord -Value 0 } catch {}`);
    }
    return { success: true };
}

async function setOptions(options = {}) {
    let restart = false;
    if (['rule', 'global', 'direct'].includes(options.mode) && options.mode !== state.mode) {
        state.mode = options.mode;
        restart = true;
    }
    if (typeof options.virtualNic === 'boolean' && options.virtualNic !== state.virtualNic) {
        state.virtualNic = options.virtualNic;
        restart = true;
    }
    if (typeof options.systemProxy === 'boolean') {
        state.systemProxy = options.systemProxy;
        if (state.enabled) await applySystemProxy(state.systemProxy);
    }
    saveState();
    if (restart && state.enabled && state.activeProfileId) {
        await startCore(state.activeProfileId);
    }
    return getDashboardData();
}

function getProxyEnv() {
    if (!state.enabled) return null;
    const proxyUrl = `http://127.0.0.1:${MIXED_PORT}`;
    return {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        all_proxy: proxyUrl,
        NO_PROXY: NO_PROXY_LIST,
        no_proxy: NO_PROXY_LIST
    };
}

function applyProxyToEnvObject(envObj) {
    const proxyEnv = getProxyEnv();
    if (!proxyEnv) {
        // 加速关闭时清掉可能继承的系统代理，避免污染
        for (const key of Object.keys(envObj || {})) {
            if (key.toLowerCase().includes('proxy')) delete envObj[key];
        }
        return envObj;
    }
    Object.assign(envObj, proxyEnv);
    return envObj;
}

async function getProxiesFromController() {
    try {
        const data = await controllerRequest('GET', '/proxies');
        return data && data.proxies ? data.proxies : {};
    } catch (e) {
        return null;
    }
}

function buildNodeList(profileId) {
    const id = profileId || state.activeProfileId;
    const content = id ? getProfileContent(id) : null;
    const parsed = content ? parseProxiesFromYaml(content) : [];
    return parsed.map((p) => ({
        ...p,
        flag: guessFlag(p.name),
        selected: state.selectedProxy === p.name
    }));
}

async function enrichNodesWithLatency(nodes) {
    if (!state.enabled) return nodes;
    const proxies = await getProxiesFromController();
    if (!proxies) return nodes;
    return nodes.map((n) => {
        const info = proxies[n.name];
        let latency = null;
        if (info && Array.isArray(info.history) && info.history.length) {
            const last = info.history[info.history.length - 1];
            if (last && typeof last.delay === 'number' && last.delay > 0) latency = last.delay;
        }
        return { ...n, type: (info && info.type) ? String(info.type).toLowerCase() : n.type, latency };
    });
}

async function selectProxy(group, name) {
    const g = group || 'GLOBAL';
    await controllerRequest('PUT', `/proxies/${encodeURIComponent(g)}`, { name });
    // 常见策略组也尝试切换
    try {
        const proxies = await getProxiesFromController();
        if (proxies) {
            for (const [key, val] of Object.entries(proxies)) {
                if (val && (val.type === 'Selector' || val.type === 'URLTest') && Array.isArray(val.all) && val.all.includes(name)) {
                    if (key !== g) {
                        try { await controllerRequest('PUT', `/proxies/${encodeURIComponent(key)}`, { name }); } catch (e) {}
                    }
                }
            }
        }
    } catch (e) {}
    state.selectedProxy = name;
    state.selectedGroup = g;
    saveState();
    return { success: true };
}

async function delayTest(names) {
    if (!state.enabled) throw new Error('请先开启 Nexora Clash');
    const list = Array.isArray(names) && names.length
        ? names
        : buildNodeList().map((n) => n.name);
    const results = {};
    // 并发限制
    const queue = [...list];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length) {
            const name = queue.shift();
            try {
                const data = await controllerRequest(
                    'GET',
                    `/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent('https://www.gstatic.com/generate_204')}`
                );
                results[name] = data && typeof data.delay === 'number' ? data.delay : null;
            } catch (e) {
                results[name] = null;
            }
        }
    });
    await Promise.all(workers);
    return results;
}

function setActiveProfileId(id) {
    state.activeProfileId = id || null;
    saveState();
    return state.activeProfileId;
}

function getStatus() {
    return {
        enabled: !!state.enabled,
        coreReady: isCoreReady(),
        activeProfileId: state.activeProfileId,
        selectedProxy: state.selectedProxy,
        mode: state.mode || 'rule',
        systemProxy: !!state.systemProxy,
        virtualNic: !!state.virtualNic,
        mixedPort: MIXED_PORT,
        controller: `${CONTROLLER_HOST}:${CONTROLLER_PORT}`,
        profiles: listProfiles(),
        running: !!mihomoProc
    };
}

async function getDashboardData(profileId) {
    const status = getStatus();
    const pid = profileId || status.activeProfileId;
    let nodes = buildNodeList(pid);
    try { nodes = await enrichNodesWithLatency(nodes); } catch (e) {}
    const groups = [];
    if (status.enabled) {
        try {
            const proxies = await getProxiesFromController();
            if (proxies) {
                for (const [name, val] of Object.entries(proxies)) {
                    if (val && (val.type === 'Selector' || val.type === 'URLTest' || val.type === 'Fallback')) {
                        groups.push({
                            name,
                            type: val.type,
                            now: val.now,
                            all: val.all || []
                        });
                    }
                }
            }
        } catch (e) {}
    }
    return { ...status, nodes, groups, profileId: pid };
}

async function getConnections() {
    if (!state.enabled) return { connections: [], downloadTotal: 0, uploadTotal: 0 };
    try {
        const data = await controllerRequest('GET', '/connections');
        return data || { connections: [], downloadTotal: 0, uploadTotal: 0 };
    } catch (e) {
        return { connections: [], downloadTotal: 0, uploadTotal: 0 };
    }
}

async function closeConnection(id) {
    if (!state.enabled) return { success: false };
    try {
        if (id) {
            await controllerRequest('DELETE', `/connections/${encodeURIComponent(id)}`);
        } else {
            await controllerRequest('DELETE', '/connections');
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message || String(e) };
    }
}

module.exports = {
    get MIXED_PORT() { return MIXED_PORT; },
    init,
    ensureCore,
    isCoreReady,
    listProfiles,
    addProfileFromUrl,
    addProfileFromFile,
    addProfileFromContent,
    removeProfile,
    renameProfile,
    updateProfileFromUrl,
    getProfileContent,
    setActiveProfileId,
    setOptions,
    applySystemProxy,
    setEnabled,
    startCore,
    stopCore,
    getStatus,
    getDashboardData,
    selectProxy,
    delayTest,
    getProxyEnv,
    applyProxyToEnvObject,
    buildNodeList,
    guessFlag,
    getConnections,
    closeConnection
};
