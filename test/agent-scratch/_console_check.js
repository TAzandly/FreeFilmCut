const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = 'D:/GrokbotWork/FreeFilmCut/three.js';
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/editor/`;

// minimal static server
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.wasm':'application/wasm','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.glsl':'text/plain' };
const server = http.createServer((req,res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const fp = path.join(ROOT, u.replace(/^\//,''));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found '+u); return;
  }
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
});

function findBrowser() {
  const cands = [
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.PROGRAMFILES + '/Google/Chrome/Application/chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function cdp(wsUrl, method, params={}) {
  const WebSocket = (await import('ws')).default;
  // if no ws module, use raw
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log('serving', URL);
  const browser = findBrowser();
  console.log('browser', browser);
  if (!browser) { console.log('NO_BROWSER'); process.exit(2); }

  const profile = path.join(process.env.TEMP, 'fcc-console-profile');
  try { fs.mkdirSync(profile, {recursive:true}); } catch {}
  const debugPort = 9223;
  const args = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--headless=new',
    '--disable-gpu',
    URL + '?nocache=' + Date.now(),
  ];
  const child = spawn(browser, args, { stdio: 'ignore', detached: true });
  console.log('spawned pid', child.pid);

  // wait for CDP
  let targets = null;
  for (let i=0;i<40;i++) {
    try {
      targets = await new Promise((resolve,reject)=>{
        http.get(`http://127.0.0.1:${debugPort}/json`, res => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} });
        }).on('error', reject);
      });
      if (targets && targets.length) break;
    } catch {}
    await sleep(250);
  }
  if (!targets || !targets.length) {
    console.log('CDP_FAILED');
    try { process.kill(child.pid); } catch {}
    server.close();
    process.exit(3);
  }
  console.log('targets', targets.map(t=>({type:t.type, url:t.url, title:t.title})));

  // Use puppeteer-core if available, else raw websocket via dynamic import
  let collected = [];
  try {
    // try npx puppeteer-core connect - or use chrome-remote-interface via fetch + websocket
    const wsUrl = targets.find(t=>t.type==='page' && /editor/.test(t.url))?.webSocketDebuggerUrl
      || targets.find(t=>t.type==='page')?.webSocketDebuggerUrl;
    console.log('ws', wsUrl);

    // Implement minimal CDP over ws using Node 22 built-in? Node may not have ws.
    // Use PowerShell/.NET? Better: write messages via a small script using `websocket` from undici?
    // Node 21+ has experimental WebSocket global.
    const WS = global.WebSocket;
    if (!WS) throw new Error('no WebSocket global');

    await new Promise((resolve, reject) => {
      const ws = new WS(wsUrl);
      let id = 0;
      const pending = new Map();
      const send = (method, params={}) => new Promise((res,rej)=>{
        const i = ++id;
        pending.set(i, {res,rej});
        ws.send(JSON.stringify({id:i, method, params}));
      });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const {res,rej} = pending.get(msg.id); pending.delete(msg.id);
          if (msg.error) rej(msg.error); else res(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
          const a = msg.params;
          const text = (a.args||[]).map(x => x.value !== undefined ? String(x.value) : (x.description || x.type)).join(' ');
          collected.push({ type: a.type, text, ts: Date.now() });
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const ex = msg.params.exceptionDetails || {};
          const text = ex.text || (ex.exception && ex.exception.description) || JSON.stringify(ex);
          const url = ex.url || (ex.stackTrace && ex.stackTrace.callFrames && ex.stackTrace.callFrames[0] && ex.stackTrace.callFrames[0].url) || '';
          const line = ex.lineNumber;
          collected.push({ type: 'exception', text, url, line, ts: Date.now() });
        }
      };
      ws.onerror = (e) => reject(e);
      ws.onopen = async () => {
        try {
          await send('Runtime.enable');
          await send('Network.enable');
          await send('Page.enable');
          // reload to catch early errors
          await send('Page.reload', { ignoreCache: true });
          await sleep(8000);
          // also collect failed network for .js
          resolve();
        } catch (e) { reject(e); }
      };
    });
  } catch (e) {
    console.log('CDP_ERR', e && e.message || e);
  }

  console.log('===CONSOLE===');
  for (const c of collected) {
    if (c.type === 'exception' || c.type === 'error' || /SyntaxError|Uncaught|Failed to load|404/.test(c.text||'')) {
      console.log(JSON.stringify(c));
    }
  }
  console.log('===ALL_ERRORS_WARNINGS===');
  for (const c of collected.filter(x => x.type==='exception'||x.type==='error'||x.type==='warning')) {
    console.log(JSON.stringify(c));
  }
  console.log('total_events', collected.length);

  try { process.kill(child.pid); } catch {}
  // also taskkill browser
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore'}); } catch {}
  server.close();
  process.exit(0);
});
