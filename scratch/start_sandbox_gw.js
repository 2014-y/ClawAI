const fs = require('fs');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');

const root = path.resolve(__dirname, '..');
const sandboxNode = path.join(root, '.node-sandbox', 'node.exe');
const openclawEntry = path.join(root, 'node_modules', 'openclaw', 'dist', 'index.js');
const configDir = path.join(process.env.USERPROFILE || '', '.openclaw');
const patchPath = path.join(root, 'patch_gateway.js');

function tcpUp(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const t = setTimeout(() => { s.destroy(); resolve(false); }, 1200);
    s.on('connect', () => { clearTimeout(t); s.end(); resolve(true); });
    s.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

(async () => {
  if (await tcpUp(18789)) {
    console.log('ALREADY_UP');
    process.exit(0);
  }
  if (!fs.existsSync(sandboxNode)) {
    console.log('NO_SANDBOX_NODE');
    process.exit(0);
  }
  if (!fs.existsSync(openclawEntry)) {
    console.log('NO_OPENCLAW_ENTRY');
    process.exit(0);
  }

  // Validate config first
  try {
    JSON.parse(fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf8').replace(/^\uFEFF/, ''));
    console.log('CONFIG_OK');
  } catch (e) {
    console.log('CONFIG_BAD=' + e.message);
    process.exit(0);
  }

  const execArgv = ['--no-warnings', '--dns-result-order=ipv4first'];
  if (fs.existsSync(patchPath)) execArgv.unshift('--require', patchPath);

  console.log('STARTING via sandbox node...');
  const child = fork(openclawEntry, ['gateway', 'run', '--force', '--allow-unconfigured'], {
    cwd: configDir,
    execPath: sandboxNode,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv,
    env: {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      Path: path.dirname(sandboxNode) + path.delimiter + (process.env.Path || process.env.PATH || '')
    },
    detached: true
  });

  let log = '';
  const onData = (d) => {
    const t = d.toString();
    log += t;
    process.stdout.write(t);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await tcpUp(18789)) {
      console.log('\nGATEWAY_UP');
      child.unref();
      process.exit(0);
    }
    if (child.exitCode != null) {
      console.log('\nEXIT_CODE=' + child.exitCode);
      process.exit(0);
    }
  }
  console.log('\nSTART_TIMEOUT');
  console.log('log_tail=' + log.slice(-500).replace(/token=[^\s&"]+/g, 'token=***'));
  child.unref();
  process.exit(0);
})().catch((e) => {
  console.log('ERR=' + e.message);
  process.exit(0);
});
