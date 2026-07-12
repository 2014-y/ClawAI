const text = `
这是普通文本
██████████████
██  ▄▄▄▄  ██
▄▄▄▄▄▄▄▄▄▄▄▄▄▄
这又是普通文本
`;
const result = text.replace(/^[\u2580-\u259F\s]*[\u2580-\u259F][\u2580-\u259F\s]*$/gm, match => `<span style="line-height: 1; letter-spacing: 0;">${match}</span>`);
console.log(result);
