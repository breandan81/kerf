// Drive the Electron app over raw DevTools protocol (puppeteer can't attach to Electron 33).
//   node test/desktop.mjs <scratchdir> [path/to/Kerf.AppImage]
// Window stays hidden (KERF_TEST); ~/Kerf and the profile are redirected into <scratchdir>.
import { spawn } from 'child_process';
import fs from 'fs';
const S = process.argv[2];
const bin = process.argv[3] || 'desktop/node_modules/.bin/electron';
const root = S + '/kerf-root', ud = S + '/kerf-userdata', dir = S + '/elsewhere';
for (const d of [root, ud, dir]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(dir + '/pics', { recursive: true });
fs.writeFileSync(dir + '/mine.kerf', 'part("p", thickness=3) { square([60,40]); engrave() translate([30,20]) image("pics/logo.png", width=20, center=true); engrave() translate([5,5]) text("Ab", size=5, font="DejaVu Serif:style=Bold"); }\n');
fs.copyFileSync('examples/assets/sunburst.png', dir + '/pics/logo.png');
const args = (bin.endsWith('.AppImage') ? [] : ['desktop']).concat(bin.endsWith('.AppImage') ? [] : ['--no-sandbox']).concat(['--remote-debugging-port=9333', dir + '/mine.kerf']);
const proc = spawn(bin, args, { env: { ...process.env, KERF_TEST: '1', KERF_ROOT: root, KERF_USERDATA: ud }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', d => log += d); proc.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const done = code => { proc.kill(); process.exit(code); };

let target;
for (let i = 0; i < 60 && !target; i++) {
  await wait(500);
  try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find(t => t.url.startsWith('app://')); } catch {}
}
if (!target) { console.log('no app page\n', log.slice(-1500)); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result.result.value;
};
const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr).catch(() => false)) return true; await wait(250); } throw new Error('timeout: ' + expr); };
await send('Page.enable'); await send('Runtime.enable'); try {
  await until('window.kerf && kerf.result');
  await wait(1500);
  console.log('opened from argv:', await ev(`({ file: document.getElementById('file').value, stats: document.getElementById('stats').textContent,
    images: kerf.result.parts[0].shape.images.length, engrave: kerf.result.parts[0].shape.engrave.length,
    console: document.getElementById('console').innerText,
    buttons: ['open','saveas','openfolder'].map(i => i + ':' + !document.getElementById(i).hidden).join(' '),
    webgl: !!document.createElement('canvas').getContext('webgl2') })`));
  console.log('~/Kerf seeded:', fs.readdirSync(root));
  await ev(`kerf.editor.setValue(kerf.editor.getValue().replace('[60,40]', '[75,40]'))`);
  await ev(`document.getElementById('save').click()`);
  await wait(800);
  console.log('saved in place:', fs.readFileSync(dir + '/mine.kerf', 'utf8').includes('[75,40]'), '| dirty:', await ev(`!document.getElementById('dirty').hidden`));
  await ev(`document.getElementById('export').click()`);
  await wait(1200);
  console.log('export dir:', fs.existsSync(dir + '/export') ? fs.readdirSync(dir + '/export') : 'none');
  await ev(`document.getElementById('tutbtn').click()`);
  await wait(1200);
  await ev(`(() => { const s = document.getElementById('tutsel'); s.value = '4'; s.dispatchEvent(new Event('change')); })()`);
  await until(`document.getElementById('file').value === 'tutorial/05-engrave-score.kerf' && kerf.result && kerf.result.parts.length === 2`);
  await wait(1500);
  console.log('lesson 5:', await ev(`document.getElementById('stats').textContent`), '| console:', JSON.stringify(await ev(`document.getElementById('console').innerText`)), '| files:', fs.readdirSync(root + '/tutorial'));
  console.log('errors:', errors);
  done(0);
} catch (e) { console.log('FAILED', e.message, errors, log.split('\n').filter(l => !/GL|ANGLE|EGL|gl_|viz_/.test(l)).slice(-15).join('\n')); done(1); }
