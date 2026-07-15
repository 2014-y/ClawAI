const fs = require('fs');
const path = require('path');

const cf = path.join(process.env.USERPROFILE || '', '.openclaw', 'openclaw.json');
const bak = cf + '.bak-jsonfix-' + Date.now();

let raw = fs.readFileSync(cf, 'utf8');
const bom = raw.charCodeAt(0) === 0xfeff ? raw.slice(0, 1) : '';
if (bom) raw = raw.slice(1);

function tryParse(s) {
  try { JSON.parse(s); return null; } catch (e) { return e.message; }
}

let err = tryParse(raw);
if (!err) {
  console.log('ALREADY_OK');
  process.exit(0);
}
console.log('BEFORE=' + err);

const lines = raw.split(/\r?\n/);
let fixes = 0;

function stringClosed(rest) {
  for (let k = 0; k < rest.length; k++) {
    if (rest[k] === '\\') { k++; continue; }
    if (rest[k] === '"') return true;
  }
  return false;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^(\s*"[^"]+"\s*:\s*")([\s\S]*)$/);
  if (!m) continue;
  if (stringClosed(m[2])) continue;

  const keyPart = line.match(/^(\s*"[^"]+"\s*:\s*)/)[1];
  let value = m[2].replace(/\uFFFD/g, '').replace(/\?+$/g, '').trim();
  if (!value) value = 'bot';

  const next = (lines[i + 1] || '').trim();
  const needsComma = next.startsWith('"');
  lines[i] = `${keyPart}${JSON.stringify(value)}${needsComma ? ',' : ''}`;
  fixes++;
  console.log('fixed_line=' + (i + 1) + ' key=' + (line.match(/"([^"]+)"/) || [])[1]);
}

let out = lines.join('\r\n');
err = tryParse(out);
if (err) {
  console.log('STILL_BAD=' + err);
  const m = /position\s+(\d+)/i.exec(err);
  const pos = m ? Number(m[1]) : -1;
  if (pos >= 0) {
    console.log('around=' + JSON.stringify(out.slice(Math.max(0, pos - 80), pos + 80)));
  }
  process.exit(0);
}

fs.copyFileSync(cf, bak);
fs.writeFileSync(cf, bom + out, 'utf8');
console.log('FIXED fixes=' + fixes);
console.log('BACKUP=' + path.basename(bak));

// verify gateway essentials without printing secrets
const j = JSON.parse(out);
console.log('port=' + (j.gateway && j.gateway.port));
console.log('auth.mode=' + (j.gateway && j.gateway.auth && j.gateway.auth.mode));
console.log('token_len=' + String((j.gateway && j.gateway.auth && j.gateway.auth.token) || '').length);
console.log('token_is_default_dev=' + (String(j.gateway.auth.token) === 'openclaw-dev-token-998877'));
console.log('basePath=' + (j.gateway && j.gateway.controlUi && j.gateway.controlUi.basePath));
process.exit(0);
