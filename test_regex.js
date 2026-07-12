const text = "\x1b[4mhttps://liteapp.weixin.qq.com/q/7GiQu1?qrcode=123&bot_type=3\x1b[24m"; 
const qrMatch = text.match(/https?:\/\/[^\s"'\n]*weixin\.qq\.com\/[^\s"'\n]+/); 
console.log(qrMatch);
