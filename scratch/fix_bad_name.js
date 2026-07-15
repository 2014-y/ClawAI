const fs = require('fs');
const path = require('path');

const cf = path.join(process.env.USERPROFILE || '', '.openclaw', 'openclaw.json');
if (!fs.existsSync(cf)) {
  console.log('NO_CONFIG');
  process.exit(0);
}

const bak = cf + '.bak-broken-name-' + Date.now();
let s = fs.readFileSync(cf, 'utf8');
try {
  JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  console.log('ALREADY_OK');
  process.exit(0);
} catch (e) {
  console.log('BEFORE=' + e.message);
}

// Broken pattern observed: "name": "<utf8 garbage without closing quote>\r\n
const fixed = s.replace(
  /("name"\s*:\s*")([^"\r\n]*?)(\r?\n)/g,
  (full, prefix, value, nl) => {
    // Only rewrite values that look truncated / contain replacement char and lack a proper close
    if (value.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
      return prefix + 'bot"' + nl;
    }
    // If this match consumed a line that never had a closing quote (our case), close it
    // The regex only matches when no quote exists before newline, so always close.
    return prefix + value.replace(/\uFFFD|\?/g, '').trim() + '"' + nl;
  }
);

// Narrower surgical fallback around known corruption
let out = fixed;
try {
  JSON.parse(out.charCodeAt(0) === 0xfeff ? out.slice(1) : out);
} catch (e1) {
  out = s.replace(
    /"name"\s*:\s*"落小[^\r\n"]*/,
    '"name": "bot"'
  );
}

try {
  JSON.parse(out.charCodeAt(0) === 0xfeff ? out.slice(1) : out);
  fs.copyFileSync(cf, bak);
  fs.writeFileSync(cf, out, 'utf8');
  console.log('FIXED');
  console.log('BACKUP=' + bak);
} catch (e2) {
  console.log('STILL_BAD=' + e2.message);
}
process.exit(0);
