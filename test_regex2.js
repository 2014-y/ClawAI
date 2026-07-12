const fs = require('fs');
const text = fs.readFileSync('wechat_login_stdout.log', 'utf16le');
const match = text.match(/https?:\/\/[^\s"'\n]*weixin\.qq\.com\/[^\s"'\n]+/);
if (match) {
    const url = match[0];
    console.log('Matched URL:', JSON.stringify(url));
    console.log('Contains ANSI?', /\x1b/.test(url));
}
