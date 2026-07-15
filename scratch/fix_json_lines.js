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

// Fix lines that contain "name": ".... without a closing quote before EOL
const lines = raw.split(/\r?\n/);
let fixes = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/^(\s*"name"\s*:\s*")(.*)$/);
  if (!m) continue;
  const rest = m[2];
  // Valid if rest has a closing quote (allow escaped quotes carefully)
  let closed = false;
  for (let k = 0; k < rest.length; k++) {
    if (rest[k] === '\\') { k++; continue; }
    if (rest[k] === '"') { closed = true; break; }
  }
  if (!closed) {
    let value = rest.replace(/\uFFFD/g, '').replace(/\?+$/, '').trim();
    if (!value) value = 'bot';
    // Keep trailing comma if original line structure suggests object continues
    const indent = line.match(/^\s*/)[0];
    const next = lines[i + 1] || '';
    const needsComma = /^\s*"/.test(next) || /^\s*}/.test(next);
    lines[i] = `${indent}"name": ${JSON.stringify(value)}${needsComma && !/,$/.test(value) ? ',' : ''}`;
    // JSON.stringify already quoted; ensure comma when next property/object end
    if (needsComma && !lines[i].trim().endsWith(',')) {
      // for `}` next, usually no comma on previous name if it's last field... 
      // If next is `"key"` need comma; if next is `}` no comma
      if (/^\s*"/.test(next) && !lines[i].endsWith(',')) lines[i] += ',';
    }
    fixes++;
    console.log('fixed_line=' + (i + 1));
  }
}

let out = lines.join('\r\n');
err = tryParse(out);
if (err) {
  // Second pass: close ANY unclosed JSON string that runs to EOL on a property line
  const lines2 = out.split(/\r?\n/);
  for (let i = 0; i < lines2.length; i++) {
    const line = lines2[i];
    const m = line.match(/^(\s*"[^"]+"\s*:\s*")(.*)$/);
    if (!m) continue;
    const rest = m[2];
    let closed = false;
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '\\') { k++; continue; }
      if (rest[k] === '"') { closed = true; break; }
    }
    if (!closed) {
      let value = rest.replace(/\uFFFD/g, '').replace(/\?+$/, '').trim();
      const next = lines2[i + 1] || '';
      lines2[i] = m[1].replace(/"$/, '') ; // shouldn't happen
      const keyPart = line.match(/^(\s*"[^"]+"\s*:\s*)/)[1];
      lines2[i] = `${keyPart}${JSON.stringify(value || 'bot')}`;
      if (/^\s*"/.test(next) && !lines2[i].endsWith(',')) lines2[i] += ',';
      fixes++;
      console.log('fixed_prop_line=' + (i + 1));
    }
  }
  out = lines2.join('\r\n');
  err = tryParse(out);
}

if (err) {
  console.log('STILL_BAD=' + err);
  const m = /position\s+(\d+)/i.exec(err);
  const pos = m ? Number(m[1]) : -1;
  if (pos >= 0) {
    console.log('around=' + JSON.stringify(out.slice(Math.max(0, pos - 60), pos + 60)));
  }
  process.exit(0);
}

fs.copyFileSync(cf, bak);
fs.writeFileSync(cf, bom + out, 'utf8');
console.log('FIXED fixes=' + fixes);
console.log('BACKUP=' + bak);
process.exit(0);
