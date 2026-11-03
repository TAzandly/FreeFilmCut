const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = 'D:/GrokbotWork/FreeFilmCut/three.js';
const PORT = 8766;
const URL = `http://127.0.0.1:${PORT}/editor/?t=` + Date.now();
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.wasm':'application/wasm','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.glsl':'text/plain','.map':'application/json' };
const server = http.createServer((req,res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const fp = path.normalize(path.join(ROOT, u.replace(/^\//,'')));
  if (!fp.startsWith(path.normalize(ROOT)) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found '+u); return;
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
});
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function findBrowser() {
  for (const c of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (c && fs.existsSync(c)) return c;
  return null;
}

server.listen(PORT, '127.0.0.1', async () => {
  const browser = findBrowser();
  const profile = path.join(process.env.TEMP, 'fcc-console-profile2');
  fs.mkdirSync(profile, {recursive:true});
  const debugPort = 9224;
  // start on blank, we navigate after enabling Runtime
  const child = spawn(browser, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions',
    '--headless=new','--disable-gpu','about:blank'
  ], { stdio: 'ignore', detached: true });

  let targets=null;
  for (let i=0;i<50;i++) {
    try {
      targets = await new Promise((resolve,reject)=>{
        http.get(`http://127.0.0.1:${debugPort}/json/list`, res => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)));
        }).on('error', reject);
      });
      if (targets.some(t=>t.type==='page')) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find(t=>t.type==='page');
  console.log('page', page && page.webSocketDebuggerUrl);

  const collected = [];
  const netFails = [];
  const WS = globalThis.WebSocket;
  await new Promise((resolve, reject) => {
    const ws = new WS(page.webSocketDebuggerUrl);
    let id=0; const pending=new Map();
    const send=(method,params={})=>new Promise((res,rej)=>{
      const i=++id; pending.set(i,{res,rej});
      ws.send(JSON.stringify({id:i,method,params}));
      setTimeout(()=>{ if(pending.has(i)){ pending.delete(i); rej(new Error('timeout '+method)); } }, 15000);
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const {res,rej}=pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) rej(Object.assign(new Error(msg.error.message), msg.error)); else res(msg.result);
        return;
      }
      if (msg.method==='Runtime.consoleAPICalled') {
        const a=msg.params;
        const text=(a.args||[]).map(x=>x.value!==undefined?String(x.value):(x.description||x.type)).join(' ');
        collected.push({kind:'console', type:a.type, text});
      } else if (msg.method==='Runtime.exceptionThrown') {
        const ex=msg.params.exceptionDetails||{};
        collected.push({
          kind:'exception',
          text: ex.text || (ex.exception&&ex.exception.description) || '',
          url: ex.url||'',
          line: ex.lineNumber,
          col: ex.columnNumber,
        });
      } else if (msg.method==='Log.entryAdded') {
        const e=msg.params.entry||{};
        collected.push({kind:'log', type:e.level, text:e.text, url:e.url, line:e.lineNumber});
      } else if (msg.method==='Network.loadingFailed') {
        netFails.push(msg.params);
      } else if (msg.method==='Network.responseReceived') {
        const r=msg.params.response;
        if (r.status>=400) netFails.push({ url:r.url, status:r.status });
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', async () => {
      try {
        await send('Runtime.enable');
        await send('Log.enable');
        await send('Network.enable');
        await send('Page.enable');
        await send('Page.navigate', { url: URL });
        // wait for load
        await sleep(10000);
        const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
        const ready = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        const hasEditor = await send('Runtime.evaluate', { expression: '!!(window.editor || window.EDITOR || document.querySelector("#viewport") || document.body.innerText.slice(0,80))', returnByValue: true });
        const bodySample = await send('Runtime.evaluate', { expression: 'document.body && document.body.innerText.slice(0,200)', returnByValue: true });
        console.log('title', title.result && title.result.value);
        console.log('ready', ready.result && ready.result.value);
        console.log('hasEditor', hasEditor.result && hasEditor.result.value);
        console.log('body', bodySample.result && bodySample.result.value);
        resolve();
      } catch (e) { reject(e); }
    });
  });

  console.log('===EXCEPTIONS===');
  for (const c of collected.filter(x=>x.kind==='exception' || x.type==='error')) console.log(JSON.stringify(c));
  console.log('===WARNINGS===');
  for (const c of collected.filter(x=>x.type==='warning'||x.type==='warn')) console.log(JSON.stringify(c));
  console.log('===NET_FAILS===');
  for (const n of netFails.slice(0,30)) console.log(JSON.stringify(n));
  console.log('===ALL===');
  for (const c of collected) console.log(JSON.stringify(c));
  console.log('counts', {collected:collected.length, netFails:netFails.length});

  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore'}); } catch {}
  server.close();
});
