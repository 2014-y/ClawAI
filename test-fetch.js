const f = globalThis.fetch;
globalThis.fetch = function() {
    return f.apply(this, arguments);
};
fetch('https://www.baidu.com').then(r => console.log(r.status)).catch(e => console.log('Error:', e));
