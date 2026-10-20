// Click through every tutorial lesson in a fresh browser profile.
// Needs serve.py on :8790 (ideally with an empty project folder).
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '/tmp';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());
await page.goto((process.env.KERF_URL || 'http://127.0.0.1:8790/'), { waitUntil: 'load' });
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 14; i++) {
  await page.waitForFunction(i => document.getElementById('file').value.startsWith(`tutorial/${String(i + 1).padStart(2, '0')}`) && kerf.result, { timeout: 10000 }, i);
  await wait(700);
  const info = await page.evaluate(() => ({
    file: document.getElementById('file').value,
    title: document.querySelector('.tut-body h2').textContent,
    stats: document.getElementById('stats').textContent,
    fit: document.getElementById('fitstatus').textContent,
    console: document.getElementById('console').innerText.trim(),
  }));
  console.log(JSON.stringify(info));
  if ([0, 4, 7, 10, 11, 12, 13].includes(i)) await page.screenshot({ path: `${out}/tut-${i + 1}.png` });
  if (i < 13) await page.click('#tutnext');
}
// reset restores edited code
await page.evaluate(() => kerf.editor.setValue('// scribble'));
await page.click('#tutreset');
await wait(1200);
console.log('after reset starts with:', JSON.stringify(await page.evaluate(() => kerf.editor.getValue().slice(0, 40))));
console.log('errors:', errors);
await browser.close();
