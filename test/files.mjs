// Website Open/Save: node test/files.mjs <outdir>  (KERF_URL = static server of dist/)
// mode "firefox": no File System Access API → downloads; mode "chrome": stubbed pickers → in-place writes
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const out = process.argv[2] || '/tmp';
const url = process.env.KERF_URL || 'http://127.0.0.1:8791/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

fs.writeFileSync(out + '/mine.kerf', 'part("p", thickness=3) { square([60,40]); engrave() translate([30,20]) image("pics/logo.png", width=20, center=true); }\n');
fs.copyFileSync('examples/assets/sunburst.png', out + '/logo.png');

async function run(mode) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 850 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'renamed.kerf' : undefined));
  const dl = `${out}/dl-${mode}`;
  fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: ctx.id });
  await page.evaluateOnNewDocument((mode) => {
    localStorage.setItem('kerf.tutOpen', 'false');
    if (mode === 'firefox') { delete window.showSaveFilePicker; delete window.showOpenFilePicker; delete window.showDirectoryPicker; }
    else {
      window.__writes = [];
      const fakeHandle = name => ({ name, kind: 'file', createWritable: async () => ({ write: async d => window.__writes.push([name, typeof d === 'string' ? d : '<blob>']), close: async () => {} }) });
      window.showSaveFilePicker = async o => fakeHandle(o.suggestedName === 'mine.kerf' ? 'mine-copy.kerf' : o.suggestedName);
      window.__fakeOpen = files => { window.showOpenFilePicker = async () => files.map(f => ({ ...fakeHandle(f.name), getFile: async () => f })); };
    }
  }, mode);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.kerf && kerf.result);
  const vis = await page.evaluate(() => ['open', 'save', 'saveas', 'openfolder'].map(id => id + ':' + !document.getElementById(id).hidden).join(' '));
  // open mine.kerf + logo.png
  if (mode === 'firefox') {
    const input = await page.$('#openinput');
    await input.uploadFile(out + '/mine.kerf', out + '/logo.png');
  } else {
    await page.evaluate(async (kerf, png) => {
      const f1 = new File([kerf], 'mine.kerf');
      const f2 = new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'logo.png', { type: 'image/png' });
      window.__fakeOpen([f1, f2]);
    }, fs.readFileSync(out + '/mine.kerf', 'utf8'), fs.readFileSync(out + '/logo.png').toString('base64'));
    await page.click('#open');
  }
  await page.waitForFunction(() => document.getElementById('file').value === 'mine.kerf' && kerf.result && kerf.result.parts[0].name === 'p', { timeout: 8000 });
  await wait(600);
  const imgs = await page.evaluate(() => kerf.result.parts[0].shape.images.length);
  // edit + Ctrl+S
  await page.evaluate(() => kerf.editor.setValue(kerf.editor.getValue().replace('[60,40]', '[70,40]')));
  await wait(300);
  const dirtyBefore = await page.$eval('#dirty', e => !e.hidden);
  await page.click('#save');
  await wait(1200);
  const dirtyAfter = await page.$eval('#dirty', e => !e.hidden);
  // save as
  await page.evaluate(() => kerf.editor.setValue(kerf.editor.getValue() + '// v2\n'));
  await page.click('#saveas');
  await wait(1200);
  const fileAfterSaveAs = await page.$eval('#file', e => e.value);
  const writes = mode === 'chrome' ? await page.evaluate(() => window.__writes.map(w => w[0] + ':' + (w[1].includes('[70,40]') ? '70' : '?') + (w[1].includes('// v2') ? '+v2' : ''))) : null;
  // draft recovery: edit, reload without saving
  await page.evaluate(() => kerf.editor.setValue(kerf.editor.getValue() + '// unsaved\n'));
  await wait(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.kerf && kerf.result);
  await wait(500);
  const rec = await page.evaluate(() => ({ file: document.getElementById('file').value, has: kerf.editor.getValue().includes('// unsaved'), dirty: !document.getElementById('dirty').hidden, msg: document.getElementById('console').innerText.split('\n')[0] }));
  console.log(mode, { vis, imgs, dirtyBefore, dirtyAfter, fileAfterSaveAs, downloads: fs.readdirSync(dl), writes, rec, errors });
  if (mode === 'firefox') for (const f of fs.readdirSync(dl)) console.log('  ', f, '→', fs.readFileSync(`${dl}/${f}`, 'utf8').includes('[70,40]') ? 'has edit' : 'MISSING EDIT');
  await ctx.close();
}
await run('firefox');
await run('chrome');
await browser.close();
