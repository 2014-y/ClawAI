// Simulate normal Windows zero-env: TEMP is AppData\Local\Temp, OPENCLAW_HOME preset by Electron
const path = require('path');
const fs = require('fs');

const patchPath = path.join(__dirname, '..', 'patch_gateway.js');
const src = fs.readFileSync(patchPath, 'utf8');

// Extract the key logic by eval in isolation is risky; instead smoke-check source contains the fixes.
const checks = [
  ['has detectCloudishEnv', /function detectCloudishEnv/.test(src)],
  ['has isSessionTempPath', /function isSessionTempPath/.test(src)],
  ['prefers OPENCLAW_HOME', /env\.OPENCLAW_HOME/.test(src) && /presetHome/.test(src)],
  ['no longer uses CLIENTNAME alone', !/Boolean\(env\.CLIENTNAME\)/.test(src)],
  ['no longer uses isTempLikeHomePath\(env\.TEMP\) in cloudish', !/isTempLikeHomePath\(env\.TEMP\)/.test(src)]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? 'OK ' : 'FAIL ') + name);
  if (!pass) ok = false;
}

// Runtime simulation of detectCloudishEnv + preset preference via a tiny reimplementation
function isTempLikeHomePath(p) {
  const n = String(p || '').toLowerCase().replace(/\//g, '\\');
  return n.includes('\\temp\\') || n.includes('\\tmp\\') || n.includes('\\appdata\\local\\temp') || /\\temp\\\d+(\\|$)/.test(n);
}
function isSessionTempPath(p) {
  const n = String(p || '').toLowerCase().replace(/\//g, '\\');
  return /\\temp\\\d+(\\|$)/.test(n);
}
function detectCloudishEnv(env) {
  if (isTempLikeHomePath(env.REAL_USER_HOME) || isTempLikeHomePath(env.USERPROFILE) || isTempLikeHomePath(env.HOME)) return true;
  if (isSessionTempPath(env.TEMP) || isSessionTempPath(env.TMP)) return true;
  for (const [k, v] of Object.entries(env)) {
    if (/wuying|eds_?desktop|aliyun.*desktop|clouddesktop|citrix|vmware.?horizon|huawei.?workspace|tencent.?desk|aws.?workspaces|aspace|yunding/i.test(`${k}=${v}`)) return true;
  }
  return false;
}

const normalHome = 'C:\\Users\\NewUser';
const normalEnv = {
  USERPROFILE: normalHome,
  HOME: normalHome,
  REAL_USER_HOME: normalHome,
  TEMP: normalHome + '\\AppData\\Local\\Temp',
  TMP: normalHome + '\\AppData\\Local\\Temp',
  LOCALAPPDATA: normalHome + '\\AppData\\Local',
  OPENCLAW_HOME: normalHome,
  OPENCLAW_STATE_DIR: normalHome + '\\.openclaw',
  SESSIONNAME: 'Console'
};

console.log('sim_normal_cloudish=' + detectCloudishEnv(normalEnv)); // expect false
console.log('sim_normal_preset_ok=' + (!isTempLikeHomePath(normalEnv.OPENCLAW_HOME))); // expect true

const rdpHomeEnv = {
  ...normalEnv,
  SESSIONNAME: 'RDP-Tcp#0',
  CLIENTNAME: 'DESKTOP-ABC'
};
console.log('sim_rdp_only_cloudish=' + detectCloudishEnv(rdpHomeEnv)); // expect false (aligned with home-resolve)

const sessionTempEnv = {
  ...normalEnv,
  TEMP: normalHome + '\\AppData\\Local\\Temp\\1',
  OPENCLAW_HOME: '',
  REAL_USER_HOME: normalHome + '\\AppData\\Local\\Temp\\1',
  USERPROFILE: normalHome + '\\AppData\\Local\\Temp\\1'
};
console.log('sim_session_temp_cloudish=' + detectCloudishEnv(sessionTempEnv)); // expect true

process.exit(ok ? 0 : 1);
