const { spawn } = require('child_process');

const child = spawn('.\\.node-sandbox\\node.exe', ['node_modules\\openclaw\\dist\\index.js', 'channels', 'login', '--channel', 'openclaw-weixin'], { stdio: 'pipe' });
child.stdout.on('data', d => console.log('STDOUT:', d.toString()));
child.stderr.on('data', d => console.log('STDERR:', d.toString()));
child.on('error', e => console.log('ERROR:', e));
child.on('exit', code => {
    console.log('EXIT CODE:', code);
    process.exit();
});

setTimeout(() => {
    console.log('Timeout reached. Killing child.');
    child.kill();
}, 5000);
