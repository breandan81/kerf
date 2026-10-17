// Hosted (static) mode checks: node test/hosted.mjs <outdir>, with KERF_URL set to a static server of dist/
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const out = process.argv[2] || '/tmp';
const url = process.env.KERF_URL || 'http://127.0.0.1:8791/';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());
const dl = out + '/kerf-downloads';
fs.rmSync(dl, { recursive: true, force: true });
fs.mkdirSync(dl);
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
const wait = ms => new Promise(r => setTimeout(r, ms));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.kerf && kerf.result);
await page.evaluate(() => { document.getElementById('tutclose').click(); });
await page.select('#file', 'sign.kerf');
await page.waitForFunction(() => document.getElementById('file').value === 'sign.kerf' && kerf.result && kerf.result.parts.length === 3);
await wait(800);
console.log('where:', await page.$eval('#where', e => e.textContent), '| openfolder visible:', await page.$eval('#openfolder', e => !e.hidden));
console.log('sign:', await page.$eval('#stats', e => e.textContent), '| engrave paths:', await page.evaluate(() => kerf.result.parts[1].shape.engrave.length), '| images:', await page.evaluate(() => kerf.result.parts[1].shape.images.length));
// unknown font → note + fallback
await page.evaluate(() => kerf.editor.setValue(kerf.editor.getValue().replace('font = "Liberation Sans:style=Bold"', 'font = "Papyrus"')));
await wait(1500);
console.log('console:', (await page.$eval('#console', e => e.innerText)).slice(0, 160));
// stencil font works
await page.evaluate(() => kerf.editor.setValue(kerf.editor.getValue().replace('font = "Papyrus"', 'font = "Allerta Stencil"')));
await wait(1500);
console.log('stencil console:', JSON.stringify(await page.$eval('#console', e => e.innerText)));
// save survives reload
await page.evaluate(() => document.getElementById('save').click());
await wait(500);
// upload a file through the hidden input
const input = await page.$('#openinput');
fs.writeFileSync(out + '/up.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
await input.uploadFile(out + '/up.svg');
await wait(800);
console.log('files after upload:', await page.$$eval('#file option', o => o.length), await page.evaluate(async () => (await (await import('./js/storage.js')).BrowserStore.prototype.list.call({}))));
await page.click('#export');
await wait(1500);
console.log('downloads:', fs.readdirSync(dl));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.kerf && kerf.result);
await wait(500);
console.log('after reload draft has stencil font:', await page.evaluate(() => kerf.editor.getValue().includes('Allerta Stencil')), 'file:', await page.$eval('#file', e => e.value));
await page.screenshot({ path: out + '/hosted.png' });
console.log('errors:', errors);
await browser.close();
