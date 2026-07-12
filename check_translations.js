const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const locales = fs.readFileSync('locales.js', 'utf8');
const window = {};
eval(locales);
const translations = window.LOCALES['en-US'];
const regex = /data-i18n="([^"]+)"/g;
let match;
while ((match = regex.exec(html)) !== null) {
  const key = match[1];
  const translation = translations[key];
  if (translation === undefined) console.log('MISSING:', key);
}
