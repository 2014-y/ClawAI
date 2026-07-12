const text = `
正在启动...
用手机微信扫描以下二维码，以继续连接：
██████████████
██  ▄▄▄▄  ██
▄▄▄▄▄▄▄▄▄▄▄▄▄▄
`;
const result = text.replace(/^[\u2580-\u259F\s]*[\u2580-\u259F][\u2580-\u259F\s]*$/gm, match => `<span style="line-height: 1.1; letter-spacing: 0;">${match}</span>`);
console.log(result);
