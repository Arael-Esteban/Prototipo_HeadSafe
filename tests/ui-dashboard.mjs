import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HEADSAFE_PLAYWRIGHT || '@playwright/test');
if(process.env.TMPDIR){process.env.TEMP=process.env.TMPDIR;process.env.TMP=process.env.TMPDIR;}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let browser, server, origin, current, fail = false, delay = 0, requests = [], active = 0, maxActive = 0, resetDelay=0, resetCode=200, resetInvalid=false, resetReAlarm=false;
const sample = (overrides = {}) => ({ deviceId:'HS-test', bootId:'boot-one', mode:'hardware', alarmaActiva:false, sensorOk:true, ax:-32000, ay:12000, az:16000, fuerzaImpactoHorizontal:44000, peak:44000, threshold:65000, uptimeMs:5000, sequence:1, events:[], resetToken:'test-token', resetCommandsRemaining:128, ...overrides });
before(async () => {
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push({url:req.url, method:req.method, headers:req.headers, body});
      if (req.url === '/api/status') {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, delay)); active--;
        if (fail) { res.writeHead(503); return res.end('{"error":"unavailable"}'); }
        res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(current));
      }
      res.setHeader('Content-Type','application/json');
      if (req.url === '/api/reset') { await new Promise(r=>setTimeout(r,resetDelay)); res.statusCode=resetCode; if(resetCode!==200) {res.end('{"error":"reset_limit_per_boot"}');return;} if(resetInvalid){res.end('{"ok":true}');return;} current={...current,alarmaActiva:resetReAlarm};res.end(JSON.stringify(current)); return; }
      if (req.url === '/api/simulate') { const action = JSON.parse(body).action; current = {...current, alarmaActiva:action === 'impact' ? true : current.alarmaActiva, sensorOk:action === 'sensor-fail' ? false : action === 'sensor-recover' ? true : current.sensorOk}; res.end('{"ok":true}'); return; }
      res.writeHead(404); return res.end('{}');
    }
    const path = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    try { const data = await readFile(resolve(root, '.'+decodeURIComponent(path))); res.setHeader('Content-Type', path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webp')?'image/webp':path.endsWith('.woff2')?'font/woff2':'text/html'); res.end(data); }
    catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath:process.env.HEADSAFE_BROWSER || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless:true});
});
after(async () => { await browser?.close(); await new Promise(r=>server.close(r)); });
async function open(overrides={}, viewport={width:1440,height:1000}) {
  current=sample(overrides); fail=false; delay=0; requests=[]; maxActive=0; resetDelay=0;resetCode=200;resetInvalid=false;resetReAlarm=false;
  const context=await browser.newContext({viewport}); const page=await context.newPage();
  await page.goto(origin, {waitUntil:'domcontentloaded'}); page.setDefaultTimeout(4000); return {page,context};
}
async function waitText(page, selector, text) { await page.waitForFunction(({selector,text}) => document.querySelector(selector)?.textContent.includes(text),{selector,text}); }
test('latched alarm dismisses with Escape without a reset and remains stale offline', async () => {
  const {page,context}=await open({alarmaActiva:true});
  await page.locator('#impact-modal[open]').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#impact-modal').isVisible(),false);
  assert.match(await page.locator('#status-title').textContent(),/Alarma/);
  assert.equal(requests.filter(r=>r.url==='/api/reset').length,0);
  fail=true; await waitText(page,'#connection-state','Sin conexión');
  assert.match(await page.locator('#status-title').textContent(),/Alarma activa/);
  assert.equal(await page.locator('#reset-button').isEnabled(),false);
  assert.match(await page.locator('#status-detail').textContent(),/503/);
  await context.close();
});
test('hardware status uses same-origin telemetry, no phone sensors or pretend health', async () => {
  const {page,context}=await open();
  await waitText(page,'#connection-state','Conectada');
  assert.equal(await page.locator('#horizontal-value').textContent(),'44.000');
  assert.match(await page.locator('#status-title').textContent(),/Sin alarma/);
  assert.equal(await page.locator('#simulate-button').isVisible(),false);
  assert.equal(await page.locator('#reset-button').isEnabled(),false);
  assert.equal(await page.locator('#date-label').textContent() === 'JUEVES · 23 JUL 2026',false);
  assert.equal(await page.locator('img[src="assets/images/headsafe-hero.webp"]').count(),1);
  assert.ok(requests.some(r=>r.url==='/api/status'));
  await context.close();
});

test('reset sends authenticated exact UUID body and never clears before device acknowledgement',async()=>{
  const {page,context}=await open({alarmaActiva:true}); await page.locator('#impact-modal[open]').waitFor();
  resetDelay=800; page.once('dialog',dialog=>dialog.accept());
  await page.locator('#modal-reset-button').click(); await waitText(page,'#status-title','Esperando confirmación');
  assert.equal(await page.locator('#reset-button').isEnabled(),false);
  await waitText(page,'#status-title','Sin alarma');
  const command=requests.find(r=>r.url==='/api/reset');
  assert.deepEqual(Object.keys(JSON.parse(command.body)),['commandId']);
  assert.match(JSON.parse(command.body).commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(command.headers['x-headsafe-token'],'test-token');
  assert.equal(await page.locator('#impact-modal').isVisible(),false);
  await context.close();
});
test('unverified reset response remains uncertain and retries the same command ID',async()=>{
  const {page,context}=await open({alarmaActiva:true});await page.locator('#impact-modal[open]').waitFor();
  resetInvalid=true;page.on('dialog',dialog=>dialog.accept());await page.locator('#modal-reset-button').click();
  await waitText(page,'#status-title','Restablecimiento sin confirmar');
  await page.locator('#modal-reset-button').click();
  await page.waitForFunction(()=>document.querySelector('#status-title').textContent.includes('sin confirmar'));
  const commands=requests.filter(r=>r.url==='/api/reset');assert.equal(commands.length,2);assert.equal(commands[0].body,commands[1].body);
  await context.close();
});

test('PC demo controls call simulation API with token and show sensor failure honestly',async()=>{
 const {page,context}=await open({mode:'simulation'});await page.locator('#simulate-button').waitFor();
 await page.locator('#sensor-fail-button').click();await waitText(page,'#status-title','Fallo del sensor');
 assert.equal(await page.locator('#horizontal-value').textContent(),'—');
 await page.locator('#sensor-recover-button').click();await waitText(page,'#status-title','Sin alarma');
 await page.locator('#simulate-button').click();await page.locator('#impact-modal[open]').waitFor();
 const commands=requests.filter(r=>r.url==='/api/simulate');assert.deepEqual(commands.map(r=>JSON.parse(r.body)),[{action:'sensor-fail'},{action:'sensor-recover'},{action:'impact',value:65001}]);
 assert.ok(commands.every(r=>r.headers['x-headsafe-token']==='test-token'));
 await context.close();
});

test('firmware-only sections are accessible on 360px mobile without horizontal overflow',async()=>{
 const {page,context}=await open({}, {width:360,height:800});
 await waitText(page,'#connection-state','Conectada');
 for(const view of ['inicio','actividad','dispositivo']){
  const button=page.locator(`.mobile-nav [data-view="${view}"]`);await button.click();
  assert.equal(await page.locator(`#view-${view}`).isVisible(),true);
  assert.equal(await button.getAttribute('aria-current'),'page');
  const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' overflow');
 }
 await context.close();
});

test('device history deduplicates per boot, exports safe CSV and keeps cleared IDs suppressed',async()=>{
 const event={id:1,uptimeMs:1200,value:65001,type:'impact',source:'sensor'};
 const {page,context}=await open({deviceId:'=FORMULA()',events:[event]});await waitText(page,'#event-count','1');
 await page.waitForTimeout(1000);assert.equal(await page.locator('#event-count').textContent(),'1');
 await page.locator('.nav [data-view="actividad"]').click();
 const downloaded=page.waitForEvent('download');await page.locator('#export-history').click();const download=await downloaded;const csv=await readFile(await download.path(),'utf8');
 assert.match(csv,/"'=FORMULA\(\)"/);assert.match(csv,/uptimeMs/);assert.match(csv,/receivedAt/);assert.match(csv,/1200/);
 current={...current,bootId:'boot-two'};await waitText(page,'#event-count','2');
 page.once('dialog',d=>d.dismiss());await page.locator('#clear-history').click();assert.equal(await page.locator('#event-count').textContent(),'2');
 page.once('dialog',d=>d.accept());await page.locator('#clear-history').click();assert.equal(await page.locator('#event-count').textContent(),'0');
 await page.waitForTimeout(800);await page.reload();await page.waitForTimeout(800);assert.equal(await page.locator('#event-count').textContent(),'0');
 assert.equal(await page.locator('#ring-count').textContent(),'1 / 32');
 await context.close();
});

test('dismissed alarm does not reopen on polling or sensor failure, and fault is explicit while latched',async()=>{
 const {page,context}=await open({alarmaActiva:true,events:[{id:7,uptimeMs:1500,value:65001,type:'impact',source:'sensor'}]});
 await page.locator('#impact-modal[open]').waitFor();await page.locator('#dismiss-alarm').click();
 current={...current,sensorOk:false,sequence:2};await waitText(page,'#status-title','fallo del sensor');await page.waitForTimeout(1000);
 assert.equal(await page.locator('#impact-modal').isVisible(),false);assert.match(await page.locator('#status-title').textContent(),/Alarma/);
 assert.equal(requests.filter(r=>r.url==='/api/reset').length,0);
 await context.close();
});


test('a stale displayed sample cannot authorize a remote reset',async()=>{
 const {page,context}=await open({alarmaActiva:true});await page.locator('#impact-modal[open]').waitFor();await page.locator('#dismiss-alarm').click();
 await page.evaluate(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+10000;});
 page.on('dialog',d=>d.accept());await page.locator('#reset-button').click();await page.waitForTimeout(150);
 assert.equal(requests.filter(r=>r.url==='/api/reset').length,0,'stale status must require a new poll before reset');
 await context.close();
});

test('hiding the panel invalidates live state and returning requires fresh telemetry',async()=>{
 const {page,context}=await open({alarmaActiva:true});await page.locator('#impact-modal[open]').waitFor();await page.locator('#dismiss-alarm').click();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('#reset-button').isEnabled(),false);
 assert.match(await page.locator('#status-title').textContent(),/sin conexión|sin confirmar/i);
 await page.waitForTimeout(600);assert.equal(await page.locator('#reset-button').isEnabled(),false);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await waitText(page,'#connection-state','Conectada');assert.equal(await page.locator('#reset-button').isEnabled(),true);
 await context.close();
});

test('acknowledged reset with a still-active alarm remains alarmed and permits a new deliberate command',async()=>{
 const {page,context}=await open({alarmaActiva:true});await page.locator('#impact-modal[open]').waitFor();resetReAlarm=true;
 page.on('dialog',d=>d.accept());await page.locator('#modal-reset-button').click();await page.waitForTimeout(200);
 assert.match(await page.locator('#status-title').textContent(),/Alarma/);
 assert.doesNotMatch(await page.locator('#modal-reset-button').textContent(),/Reintentar confirmación/);
 assert.match(await page.locator('#reset-feedback').textContent(),/sigue activa|nueva alarma|permanece|continúa/i);
 await page.locator('#modal-reset-button').click();await page.waitForTimeout(200);
 const commands=requests.filter(r=>r.url==='/api/reset');assert.equal(commands.length,2);assert.notEqual(commands[0].body,commands[1].body);
 await context.close();
});

test('scope contains firmware features only, with no contacts, profile, audio or phone sensors',async()=>{
 const {page,context}=await open();await waitText(page,'#connection-state','Conectada');
 for(const selector of ['#view-contactos','#view-ajustes','#sound-toggle','#profile-form','#contact-form','#gyro-value'])assert.equal(await page.locator(selector).count(),0,selector);
 assert.equal(await page.locator('.mobile-nav a[href="base-informativa.html"]').count(),1);
 const source=await readFile(resolve(root,'app.js'),'utf8');assert.doesNotMatch(source,/AudioContext|devicemotion|navigator\.bluetooth|navigator\.geolocation|navigator\.share/);
 await context.close();
});

test('device address opens a validated local panel and never pretends pairing or cross-origin polling',async()=>{
 const {page,context}=await open();await page.locator('.nav [data-view="dispositivo"]').click();
 assert.equal(await page.locator('#device-address').inputValue(),'http://192.168.4.1');
 await page.locator('#device-address').fill('https://example.com');await page.locator('#device-form button').click();await waitText(page,'#device-error','local');assert.equal(page.url(),origin+'/');
 await page.locator('#device-address').fill('http://user:password@192.168.4.1');await page.locator('#device-form button').click();await waitText(page,'#device-error','local');assert.equal(page.url(),origin+'/');
 await page.route('http://192.168.4.1/**',route=>route.fulfill({contentType:'text/html',body:'<title>Local target navigation fixture</title>'}));
 await page.locator('#device-address').fill('http://192.168.4.1');await page.locator('#device-form button').click();await page.waitForURL('http://192.168.4.1/');
 assert.ok(requests.filter(r=>r.url.startsWith('/api/')).every(r=>r.url==='/api/status'));await context.close();
});

test('invalid telemetry never turns unknown state healthy and recovery requires valid data',async()=>{
 const {page,context}=await open({sensorOk:'true'});await waitText(page,'#status-detail','inválida');
 assert.match(await page.locator('#status-title').textContent(),/Sin datos/);assert.equal(await page.locator('#horizontal-value').textContent(),'—');
 current=sample();await waitText(page,'#status-title','Sin alarma');
 current={...current,events:[{id:1,uptimeMs:100,value:2,type:'unknown',source:'sensor'}]};await waitText(page,'#connection-state','Sin conexión');assert.match(await page.locator('#status-title').textContent(),/sin confirmar/);
 await context.close();
});
test('polling does not overlap and timeout marks telemetry stale with reset disabled',async()=>{
 const {page,context}=await open();await waitText(page,'#connection-state','Conectada');delay=800;
 await page.waitForTimeout(2100);assert.equal(maxActive,1);
 delay=3000;await waitText(page,'#connection-state','Sin conexión');assert.match(await page.locator('#status-detail').textContent(),/2,5 s/);assert.equal(await page.locator('#reset-button').isEnabled(),false);
 delay=0;await context.close();await new Promise(r=>setTimeout(r,600));
});
test('reset quota errors are explicit and never change alarm locally',async()=>{
 const {page,context}=await open({alarmaActiva:true});await page.locator('#impact-modal[open]').waitFor();resetCode=429;
 page.once('dialog',dialog=>dialog.accept());await page.locator('#modal-reset-button').click();await waitText(page,'#reset-feedback','429');assert.match(await page.locator('#reset-feedback').textContent(),/botón físico/);assert.match(await page.locator('#status-title').textContent(),/Alarma/);
 current={...current,resetCommandsRemaining:0};await page.waitForTimeout(600);assert.equal(await page.locator('#modal-reset-button').isEnabled(),false);await context.close();
});
test('storage failure warns without breaking telemetry or event rendering',async()=>{
 current=sample({events:[{id:1,uptimeMs:100,value:2,type:'reset',source:'physical'}]});fail=false;delay=0;
 const context=await browser.newContext();await context.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked');};Storage.prototype.setItem=()=>{throw new Error('blocked');};});
 const page=await context.newPage();await page.goto(origin);await waitText(page,'#connection-state','Conectada');assert.equal(await page.locator('#storage-warning').isVisible(),true);assert.equal(await page.locator('#event-count').textContent(),'1');await context.close();
});

test('remote reset UUID fallback works without secure-context randomUUID',async()=>{
 current=sample({alarmaActiva:true});fail=false;delay=0;resetDelay=0;resetCode=200;resetInvalid=false;requests=[];
 const context=await browser.newContext();await context.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined}));
 const page=await context.newPage();await page.goto(origin);await page.locator('#impact-modal[open]').waitFor();page.once('dialog',d=>d.accept());await page.locator('#modal-reset-button').click();await waitText(page,'#status-title','Sin alarma');
 const command=requests.find(r=>r.url==='/api/reset');assert.match(JSON.parse(command.body).commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);await context.close();
});
