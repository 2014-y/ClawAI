const { app } = require('electron');
const { fork } = require('child_process');
const path = require('path');

app.whenReady().then(() => {
    const nodeExePath = path.join(__dirname, '.node-sandbox', 'node.exe');
    console.log('Using execPath:', nodeExePath);
    
    // Test fork with vanilla node.exe
    const child = fork(path.join(__dirname, 'test_regex.js'), [], {
        execPath: nodeExePath,
        stdio: 'pipe'
    });
    
    child.stdout.on('data', d => console.log('STDOUT:', d.toString()));
    child.stderr.on('data', d => console.log('STDERR:', d.toString()));
    child.on('error', e => console.log('ERROR:', e));
    child.on('exit', code => {
        console.log('EXIT CODE:', code);
        app.quit();
    });
});
