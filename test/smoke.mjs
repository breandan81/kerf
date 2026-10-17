// Headless smoke test: node test/smoke.mjs [file.kerf] — needs serve.py on :8790
import puppeteer from 'puppeteer-core';
const file = process.argv[2] || 'box.kerf';
const out = process.argv[3] || '/tmp';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--window-size=1500,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto(`http://127.0.0.1:8790/?file=${file}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.kerf && window.kerf.result, { timeout: 15000 }).catch(() => {});
await new Promise(r => setTimeout(r, 800));
const info = await page.evaluate(() => ({
  parts: kerf.result && kerf.result.parts.map(p => p.name),
  console: document.getElementById('console').innerText,
  stats: document.getElementById('stats').innerText,
  fit: document.getElementById('fitstatus').innerText,
}));
console.log(JSON.stringify(info, null, 1));
for (const v of ['3d', 'part', 'sheets']) {
  await page.evaluate(v => kerf.setView(v), v);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${out}/kerf-${file.replace(/\W/g, '_')}-${v}.png` });
}
console.log('errors:', errors);
await browser.close();
