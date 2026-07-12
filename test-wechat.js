const fetch = globalThis.fetch;
globalThis.fetch = function() {
    return fetch.apply(this, arguments);
};

const controller = new AbortController();
setTimeout(() => controller.abort(), 10);

fetch('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=wechat', { method: 'POST', body: JSON.stringify({ local_token_list: [] }), signal: controller.signal })
    .then(r => console.log('Status:', r.status))
    .catch(e => {
        console.log('Error name:', e.name);
        console.log('Error message:', e.message);
    });
