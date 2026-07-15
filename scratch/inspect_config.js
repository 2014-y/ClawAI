const fs = require('fs');
const path = require('path');

const cf = path.join(process.env.USERPROFILE || '', '.openclaw', 'openclaw.json');
const log = path.join(process.env.USERPROFILE || '', '.openclaw', 'gateway_stdout.log');

function redact(line) {
  return String(line)
    .replace(/token=[^&\s"]+/g, 'token=***')
    .replace(/openclaw-dev-token-\d+/g, '***')
    .replace(/[a-fA-F0-9]{32}/g, '***');
}

try {
  if (!fs.existsSync(cf)) {
    console.log('NO_CONFIG');
  } else {
    let s = fs.readFileSync(cf, 'utf8');
    console.log('len=' + s.length);
    console.log('bom=' + (s.charCodeAt(0) === 0xfeff));
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

    // show control chars near parse failures
    try {
      JSON.parse(s);
      console.log('JSON_OK');
    } catch (e) {
      console.log('JSON_ERR=' + e.message);
      const m = /position\s+(\d+)/i.exec(e.message);
      const i = m ? Number(m[1]) : 5076;
      console.log('pos=' + i);
      console.log('around=' + JSON.stringify(s.slice(Math.max(0, i - 80), i + 80)));
      const codes = [];
      for (let k = Math.max(0, i - 20); k < Math.min(s.length, i + 20); k++) {
        codes.push(k + ':' + s.charCodeAt(k));
      }
      console.log('codes=' + codes.join(','));
    }

    // CRLF / weird line endings count
    const crlf = (s.match(/\r\n/g) || []).length;
    const cr = (s.match(/\r(?!\n)/g) || []).length;
    const lf = (s.match(/(?<!\r)\n/g) || []).length;
    console.log('crlf=' + crlf + ' lone_cr=' + cr + ' lf=' + lf);
  }

  console.log('---log---');
  if (fs.existsSync(log)) {
    const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-30);
    for (const line of lines) console.log(redact(line));
  } else {
    console.log('NO_LOG');
  }
} catch (e) {
  console.log('ERR=' + e.message);
}
process.exit(0);
