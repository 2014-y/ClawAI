const path = require('path');
const fs = require('fs');
// resolve from app root when launched via sandbox node
const appRoot = path.resolve(__dirname, '..');
let Database;
try {
  Database = require(path.join(appRoot, 'node_modules', 'better-sqlite3'));
} catch (e) {
  Database = require('better-sqlite3');
}

const p = path.join(
  process.env.USERPROFILE || '',
  '.openclaw',
  'agents',
  'main',
  'agent',
  'openclaw-agent.sqlite'
);
if (!fs.existsSync(p)) {
  console.log('NO_DB');
  process.exit(0);
}

const db = new Database(p, { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('tables=' + tables.join(','));

function redact(v) {
  if (typeof v !== 'string') return v;
  if (v === 'YOUR_AGNES_API_KEY_HERE') return 'PLACEHOLDER';
  if (v.startsWith('sk-')) return v.slice(0, 8) + '...len' + v.length;
  if (v.length > 160) return v.slice(0, 160) + '...';
  return v;
}

for (const t of tables) {
  if (!/auth|cred|secret|provider|key|token|model|profile/i.test(t)) continue;
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    console.log('---' + t + ' cols=' + cols.join(','));
    const rows = db.prepare(`SELECT * FROM ${t} LIMIT 10`).all();
    for (const row of rows) {
      const o = {};
      for (const [k, v] of Object.entries(row)) o[k] = redact(v);
      console.log(JSON.stringify(o));
    }
  } catch (e) {
    console.log('err ' + t + ': ' + e.message);
  }
}
db.close();
process.exit(0);
