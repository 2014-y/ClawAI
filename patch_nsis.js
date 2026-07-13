const fs = require('fs');
const path = require('path');

// 自动为打包初始化 .node-sandbox 目录（防空漏）
try {
    const sandboxDir = path.join(__dirname, '.node-sandbox');
    const sandboxNode = path.join(sandboxDir, 'node.exe');
    if (!fs.existsSync(sandboxNode)) {
        console.log('Detecting missing .node-sandbox/node.exe, automatically initializing...');
        if (!fs.existsSync(sandboxDir)) {
            fs.mkdirSync(sandboxDir, { recursive: true });
        }
        
        // 获取当前运行的 node 执行路径
        const currentExec = process.execPath;
        if (currentExec && currentExec.toLowerCase().endsWith('node.exe') && fs.existsSync(currentExec)) {
            const currentDir = path.dirname(currentExec);
            
            // 拷贝 node.exe
            fs.copyFileSync(currentExec, sandboxNode);
            console.log(`Copied node.exe from ${currentExec} to ${sandboxNode}`);
            
            // 尝试拷贝其它关联文件，例如 npm, npx 等
            const filesToCopy = ['npm', 'npm.cmd', 'npx', 'npx.cmd', 'corepack', 'corepack.cmd', 'nodevars.bat'];
            filesToCopy.forEach(file => {
                const srcFile = path.join(currentDir, file);
                const destFile = path.join(sandboxDir, file);
                if (fs.existsSync(srcFile)) {
                    fs.copyFileSync(srcFile, destFile);
                    console.log(`Copied ${file} to sandbox`);
                }
            });
            
            // 拷贝 node_modules 目录（如果存在）
            const srcModules = path.join(currentDir, 'node_modules');
            const destModules = path.join(sandboxDir, 'node_modules');
            if (fs.existsSync(srcModules)) {
                function copyDirSync(src, dest) {
                    fs.mkdirSync(dest, { recursive: true });
                    const entries = fs.readdirSync(src, { withFileTypes: true });
                    for (let entry of entries) {
                        let srcPath = path.join(src, entry.name);
                        let destPath = path.join(dest, entry.name);
                        if (entry.isDirectory()) {
                            copyDirSync(srcPath, destPath);
                        } else {
                            fs.copyFileSync(srcPath, destPath);
                        }
                    }
                }
                try {
                    copyDirSync(srcModules, destModules);
                    console.log('Copied global node_modules to sandbox');
                } catch (e) {
                    console.error('Failed to copy global node_modules:', e);
                }
            }
        } else {
            console.warn('Current execPath does not seem to be node.exe or cannot find it:', currentExec);
        }
    }
} catch (e) {
    console.error('Error setting up node-sandbox dynamically:', e);
}

function findNsh(dir) {
    let results = [];
    try {
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory() && !file.includes('.asar')) {
                results = results.concat(findNsh(file));
            } else {
                if (file.endsWith('installSection.nsh')) {
                    results.push(file);
                }
            }
        });
    } catch (e) {}
    return results;
}

try {
    console.log('Searching for installSection.nsh to patch SetDetailsPrint...');
    const files = findNsh(path.join(__dirname, 'node_modules'));
    let patched = false;
    files.forEach(file => {
        let data = fs.readFileSync(file, 'utf8');
        if (data.includes('SetDetailsPrint none')) {
            data = data.replace(/SetDetailsPrint none/g, 'SetDetailsPrint both');
            fs.writeFileSync(file, data);
            console.log(`Patched: ${file}`);
            patched = true;
        }
    });
    if (!patched) {
        console.log('No patching was necessary or file not found.');
    }
} catch (e) {
    console.error('Error patching NSIS:', e);
}
