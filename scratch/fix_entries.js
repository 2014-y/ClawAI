// Fix plugin entry points: repair ./index.ts → ./dist/index.js for all OpenClaw plugins
const fs = require('fs');
const path = require('path');

const configDir = path.join(process.env.USERPROFILE || '', '.openclaw');
const configPath = path.join(configDir, 'openclaw.json');

const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
const config = JSON.parse(raw);

let changed = false;

// 1. Fix load.paths: replace Program Files paths with local dev paths where available
const devRoot = path.resolve(__dirname, '..');
const loadPaths = config.plugins.load.paths || [];
const newPaths = [];

for (const p of loadPaths) {
    let resolved = p;
    
    // If path points to Program Files, check if local dev copy exists
    if (/Program Files/i.test(p)) {
        // Extract the relative part after resources\app\ 
        const m = p.match(/resources[\\/]app[\\/](.*)/i);
        if (m) {
            const localPath = path.join(devRoot, m[1]);
            if (fs.existsSync(localPath)) {
                console.log(`REDIRECT: ${p} → ${localPath}`);
                resolved = localPath;
                changed = true;
            }
        }
    }
    newPaths.push(resolved);
}

config.plugins.load.paths = newPaths;

// 2. Repair ALL plugin package.json entries: fix ./index.ts → ./dist/index.js
function repairPluginEntry(pluginDir, label) {
    const pkgPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { return; }
    
    let pkgChanged = false;
    
    if (pkg.openclaw && Array.isArray(pkg.openclaw.extensions)) {
        const newExts = pkg.openclaw.extensions.map(ext => {
            if (!ext || typeof ext !== 'string') return ext;
            const absPath = path.isAbsolute(ext) ? ext : path.join(pluginDir, ext);
            if (fs.existsSync(absPath)) return ext; // file exists, no fix needed
            
            // Try fallbacks
            const fallbacks = ['./dist/index.js', './dist/channel-entry.js', './index.js', './index.mjs'];
            for (const fb of fallbacks) {
                if (fs.existsSync(path.join(pluginDir, fb))) {
                    console.log(`REPAIR [${label}]: ${ext} → ${fb}`);
                    pkgChanged = true;
                    return fb;
                }
            }
            console.log(`WARN [${label}]: ${ext} not found, no fallback available`);
            return ext;
        });
        if (pkgChanged) {
            pkg.openclaw.extensions = newExts;
        }
    }
    
    if (pkgChanged) {
        try {
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            console.log(`FIXED [${label}]: ${pkgPath}`);
            changed = true;
        } catch (e) {
            console.log(`CANNOT WRITE [${label}]: ${e.message}`);
        }
    }
}

// Repair all paths in load.paths
for (const p of config.plugins.load.paths) {
    if (fs.existsSync(p)) {
        repairPluginEntry(p, path.basename(p));
    }
}

// Repair install paths
for (const [id, install] of Object.entries(config.plugins.installs || {})) {
    if (install.installPath && fs.existsSync(install.installPath)) {
        repairPluginEntry(install.installPath, `install:${id}`);
    }
}

// Repair local dev node_modules
const devPlugins = [
    path.join(devRoot, 'node_modules', '@openclaw', 'feishu'),
    path.join(devRoot, 'node_modules', '@openclaw', 'qqbot'),
    path.join(devRoot, 'node_modules', '@tencent-weixin', 'openclaw-weixin'),
];
for (const p of devPlugins) {
    if (fs.existsSync(p)) {
        repairPluginEntry(p, `dev:${path.basename(p)}`);
    }
}

// 3. Also fix installs to point to local dev paths instead of npm/projects copies
// (since the npm/projects copies also have broken index.ts)
for (const [id, install] of Object.entries(config.plugins.installs || {})) {
    if (install.installPath && fs.existsSync(install.installPath)) {
        const installPkg = path.join(install.installPath, 'package.json');
        if (fs.existsSync(installPkg)) {
            repairPluginEntry(install.installPath, `install:${id}`);
        }
    }
}

// 4. Write back config
if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('\n✅ Config updated!');
} else {
    console.log('\n(no config changes needed)');
}

// 5. Verify final state
console.log('\n=== FINAL LOAD.PATHS ===');
for (const p of config.plugins.load.paths) {
    const exists = fs.existsSync(p);
    let entryOk = false;
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8'));
        const exts = pkg.openclaw && pkg.openclaw.extensions;
        if (Array.isArray(exts)) {
            entryOk = exts.every(ext => fs.existsSync(path.join(p, ext)));
        }
        console.log(`  ${entryOk ? '✓' : '✗'} ${path.basename(p)} → exts: ${JSON.stringify(exts)}`);
    } catch (e) {
        console.log(`  ? ${path.basename(p)} → (no package.json or parse error)`);
    }
}
