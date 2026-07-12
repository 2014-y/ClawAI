const fs = require('fs');
const path = require('path');

let mainJs = fs.readFileSync('main.js', 'utf8');

mainJs = mainJs.replace(/function httpsGetJson\(url\).*?\}\)\;\n\s*\}/s, `function httpsGetJson(urlStr) {
    const { net } = require('electron');
    return new Promise((resolve, reject) => {
        net.fetch(urlStr, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/vnd.github.v3+json'
            }
        }).then(async (res) => {
            if (res.status === 301 || res.status === 302) {
                return httpsGetJson(res.headers.get('location')).then(resolve).catch(reject);
            }
            if (!res.ok) {
                return reject(new Error(\`请求失败，状态码: \${res.status}\`));
            }
            try {
                const parsedData = await res.json();
                resolve(parsedData);
            } catch (e) {
                reject(e);
            }
        }).catch(reject);
    });
}`);

mainJs = mainJs.replace(/function getLatestVersionFromRedirect\(url\).*?\}\)\;\n\s*\}/s, `function getLatestVersionFromRedirect(urlStr) {
    const { net } = require('electron');
    return new Promise((resolve, reject) => {
        net.fetch(urlStr, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'manual'
        }).then(res => {
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get('location');
                if (location) {
                    const match = location.match(/\\/releases\\/tag\\/(v?[0-9a-zA-Z.-]+)/);
                    if (match) {
                        return resolve(match[1]);
                    }
                }
                reject(new Error('未在重定向目标中找到版本号'));
            } else {
                reject(new Error(\`请求未发生重定向，状态码: \${res.status}\`));
            }
        }).catch(reject);
    });
}`);

fs.writeFileSync('main.js', mainJs, 'utf8');
console.log('Patched main.js successfully');
