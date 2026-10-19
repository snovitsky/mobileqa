const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const punycode = require('node:punycode');

(async () => {
 const source = fs.readFileSync(path.join(__dirname, '../extension/url-display.js'), 'utf8');
 const { displayAddress } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
 const labels = ['россия', 'москва', 'пример', 'рф', 'кухни-заказ', 'bücher', 'mañana', '例子', '日本語', 'العربية', 'ελληνικά', 'cafe\u0301', 'a\u0308', '😀'];
 for (const label of labels) {
  const ascii = punycode.toASCII(label);
  assert.equal(displayAddress(`https://${ascii}/`), `https://${label}/`);
  assert.equal(displayAddress(`http://*.${ascii}/path?q=xn--e1afmkfd#part`), `http://*.${label}/path?q=xn--e1afmkfd#part`);
  assert.equal(displayAddress(`HTTPS://${ascii}:8443/*`), `HTTPS://${label}:8443/*`);
 }
 assert.equal(displayAddress('https://xn--e1afmkfd.xn--p1ai/*'), 'https://пример.рф/*');
 for (const address of ['https://example.com/*', 'http://*.example.com/*', 'https://пример.рф/текст',
  'https://example.com/xn--e1afmkfd?path=%2F#xn--p1ai', 'https://[::1]:8080/*',
  'file://xn--e1afmkfd/path', 'not a URL', 'https://user:password@xn--e1afmkfd/',
  'https://xn--/*', 'https://xn--a/*', 'https://xn--abc-/*', 'https://xn--!invalid/*',
  'https://xn--99999999999999999999999999999999999999999999999999999999999999/*']) {
  assert.equal(displayAddress(address), address);
 }
 assert.equal(displayAddress(null), null);
 console.log('PASS URL display: IDN corpus, wildcard/scheme/port/path preservation, ASCII/Unicode unchanged and malformed fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
