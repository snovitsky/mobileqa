const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

// Chromium screenshots are non-interlaced 8-bit RGB/RGBA PNGs. Decode in memory
// to check composited pixels without adding an image dependency or saved copies.
function pixels(png) {
 let width, height, channels;
 const compressed = [];
 for (let offset = 8; offset < png.length;) {
  const length = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8);
  const chunk = png.subarray(offset + 8, offset + 8 + length);
  if (kind === 'IHDR') {
   width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
   assert.equal(chunk[8], 8); assert.equal(chunk[12], 0);
   channels = chunk[9] === 6 ? 4 : chunk[9] === 2 ? 3 : 0;
   assert(channels, 'Expected an RGB/RGBA Chromium screenshot');
  }
  if (kind === 'IDAT') compressed.push(chunk);
  offset += length + 12;
 }
 const raw = zlib.inflateSync(Buffer.concat(compressed)), stride = width * channels;
 const data = Buffer.alloc(height * stride);
 function paeth(a, b, c) {
  const estimate = a + b - c, da = Math.abs(estimate - a), db = Math.abs(estimate - b), dc = Math.abs(estimate - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
 }
 for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]; assert(filter <= 4);
  for (let x = 0; x < stride; x++) {
   const a = x >= channels ? data[y * stride + x - channels] : 0;
   const b = y ? data[(y - 1) * stride + x] : 0;
   const c = y && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
   const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
   data[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
  }
 }
 return { width, height, at(x, y) {
  assert(x >= 0 && x < width && y >= 0 && y < height);
  const offset = (y * width + x) * channels;
  return [...data.subarray(offset, offset + 3)];
 } };
}

(async () => {
 const css = fs.readFileSync(path.resolve(__dirname, '../extension/panel.css'), 'utf8');
 const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url === '/panel.css' ? 'text/css' : 'text/html; charset=utf-8' });
  if (req.url === '/panel.css') return res.end(css);
  if (req.url === '/dark') return res.end('<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#1e1e1e;overflow:hidden}</style>');
  res.end('<!doctype html><link rel="stylesheet" href="/panel.css"><style>body{padding:40px}.device{width:max-content}</style><article class="device" data-platform="iPad" data-model="ipad11"><div class="shell"><div class="display"><div class="hardware-top"></div><div class="browser-top"></div><div class="screen"><iframe src="/dark"></iframe></div><div class="browser-bottom"><div class="browser-bottom-inner"></div></div></div></div></article>');
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  let cases = 0;
  for (const dpr of [1, 1.25, 2]) {
   const context = await browser.newContext({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: dpr });
   const page = await context.newPage();
   await page.goto('http://127.0.0.1:' + server.address().port);
   for (const landscape of [false, true]) for (const physical of [false, true]) {
    for (const mode of ['expanded', 'collapsed']) for (const scale of [.773428, .5, 1]) {
     const label = JSON.stringify({ dpr, landscape, physical, mode, scale });
     const geometry = await page.evaluate(({ landscape, physical, mode, scale, dpr }) => {
      const device = document.querySelector('.device'), display = document.querySelector('.display');
      const screen = document.querySelector('.screen'), frame = document.querySelector('iframe');
      const w = landscape ? 1180 : 820, h = landscape ? 820 : 1180;
      const bar = landscape ? 0 : 24, top = mode === 'expanded' ? 56 : 0, bottom = 20;
      const viewportHeight = h - bar - top - bottom;
      device.classList.toggle('landscape', landscape); device.classList.toggle('physical-size', physical);
      device.dataset.browserMode = mode;
      device.style.setProperty('--device-scale', scale);
      device.style.setProperty('--status-height', bar + 'px');
      device.style.setProperty('--browser-top-height', top + 'px');
      device.style.setProperty('--browser-bottom-height', bottom + 'px');
      display.style.width = w * scale + 'px'; display.style.height = h * scale + 'px';
      screen.style.width = w * scale + 'px'; screen.style.height = viewportHeight * scale + 'px';
      const raster = scale === 1 || dpr >= 2 ? 1 : 2;
      frame.style.width = w + 'px'; frame.style.height = viewportHeight + 'px';
      frame.style.zoom = String(raster); frame.style.transform = 'scale(' + scale / raster + ')';
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const style = getComputedStyle(screen);
      return { w, h, viewportHeight, display: rect(display), screen: rect(screen), frame: rect(frame),
       radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius] };
     }, { landscape, physical, mode, scale, dpr });
     await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
     const viewport = await page.frames()[1].evaluate(() => ({ width: innerWidth, height: innerHeight }));
     assert.deepEqual(viewport, { width: geometry.w, height: geometry.viewportHeight }, 'CSS viewport changed: ' + label);
     assert(Math.abs(Math.hypot(geometry.display.width, geometry.display.height) - Math.hypot(geometry.w, geometry.h) * scale) < .03, 'Display calibration changed: ' + label);
     assert(geometry.frame.right >= geometry.screen.right - 1 / 64 && geometry.frame.bottom >= geometry.screen.bottom - 1 / 64, 'Transformed iframe leaves a gutter: ' + label);
     const clip = { x: Math.floor(geometry.display.x), y: Math.floor(geometry.display.y), width: Math.ceil(geometry.display.right) - Math.floor(geometry.display.x), height: Math.ceil(geometry.display.bottom) - Math.floor(geometry.display.y) };
     const screenshot = pixels(await page.screenshot({ clip }));
     const sample = (x, y) => screenshot.at(Math.floor((x - clip.x) * dpr), Math.floor((y - clip.y) * dpr));
     const points = [
      [geometry.screen.x + 2, geometry.screen.bottom - 2],
      [geometry.screen.right - 2, geometry.screen.bottom - 2],
      [geometry.screen.right - 1 / dpr, geometry.screen.y + geometry.screen.height / 2],
     ];
     assert(geometry.radius.every(value => parseFloat(value) === 0), 'Inner screen must be square; display owns rounded clipping: ' + label + ' radius=' + geometry.radius + ' renderedPixels=' + JSON.stringify(points.map(point => sample(...point))));
     for (const point of points) assert(sample(...point).every(channel => channel <= 55), 'Light corner/seam in dark iframe: ' + label + ' pixel=' + sample(...point));
     cases++;
    }
   }
   await context.close();
  }
  console.log('PASS ' + cases + ' tablet geometry cases: DPR 1/1.25/2, portrait/landscape, physical class, expanded/collapsed bars, fractional scale, viewport/calibration, square inner clip and rendered dark edge pixels');
 } finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
