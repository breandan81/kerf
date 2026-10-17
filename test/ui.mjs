// UI checks: export, collision display, error display. Needs serve.py on :8790.
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '/tmp';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8790/?file=sign.kerf', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.kerf && kerf.result);
await page.evaluate(() => kerf.setView('3d'));
await page.click('#export');
await new Promise(r => setTimeout(r, 800));
console.log('export:', await page.$eval('#console', e => e.innerText));
// collide the marker with the sign
await page.evaluate(() => { const ed = kerf.editor; ed.setValue(ed.getValue().replace('translate([BW / 2 + 40, 12, tb])', 'translate([BW / 2 + 20, 20, tb])')); });
await new Promise(r => setTimeout(r, 1500));
console.log('collide:', await page.$eval('#console', e => e.innerText), await page.$eval('#fitstatus', e => e.innerText));
await page.screenshot({ path: `${out}/kerf-collide.png` });
// syntax error
await page.evaluate(() => { const ed = kerf.editor; ed.replaceRange('oops(;\n', { line: 13, ch: 0 }); });
await new Promise(r => setTimeout(r, 1200));
console.log('error:', await page.$eval('#console', e => e.innerText));
await page.screenshot({ path: `${out}/kerf-error.png` });
console.log('errors:', errors);
await browser.close();
