/* Real backend/browser acceptance. No API response mocking. Uses PC demo only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HEADSAFE_PLAYWRIGHT || '@playwright/test');
if(process.env.TMPDIR){process.env.TEMP=process.env.TMPDIR;process.env.TMP=process.env.TMPDIR;}
const origin=process.env.HEADSAFE_LIVE_URL || 'http://127.0.0.1:8767';
const screenshotDir=process.env.HEADSAFE_SCREENSHOTS || 'verification/live';
async function status(){const response=await fetch(origin+'/api/status');assert.equal(response.status,200);return response.json();}
async function command(path,body){const d=await status();assert.equal(d.mode,'simulation','Live suite refuses to command physical hardware');const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-HeadSafe-Token':d.resetToken},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();}
async function clean(){await command('/api/simulate',{action:'sensor-recover'});await command('/api/reset',{commandId:crypto.randomUUID()});}
async function waitText(page,selector,pattern){await page.waitForFunction(({selector,pattern})=>new RegExp(pattern,'i').test(document.querySelector(selector)?.textContent),{selector,pattern});}
test('real PC server: responsive original design, latched alarm, fault, reset, CSV and offline',async()=>{
 await clean();await mkdir(screenshotDir,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.HEADSAFE_BROWSER || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const errors=[],external=[],artifacts=[];
 try{
  for(const width of [360,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:950}});const page=await context.newPage();page.setDefaultTimeout(6000);
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin+'/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
   await page.goto(origin);await waitText(page,'#status-title','Sin alarma');
   assert.equal(await page.locator('.hero-card img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
   assert.equal(await page.evaluate(()=>document.fonts.check('600 14px Manrope')),true);
   for(const view of ['inicio','actividad','dispositivo']){
    await page.locator(`[data-view="${view}"]:visible`).click();assert.equal(await page.locator('#view-'+view).isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' at '+width);
   }
   await page.locator('[data-view="inicio"]:visible').click();
   await page.locator('#simulate-button').click();await page.locator('#impact-modal[open]').waitFor();
   await page.keyboard.press('Tab');assert.equal(await page.locator('#impact-modal').evaluate(d=>d.contains(document.activeElement)),true);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#impact-modal').isVisible(),false);assert.equal((await status()).alarmaActiva,true);
   await page.waitForTimeout(900);assert.equal(await page.locator('#impact-modal').isVisible(),false);
   await page.locator('#sensor-fail-button').click();await waitText(page,'#status-title','fallo del sensor');assert.match(await page.locator('#status-title').textContent(),/Alarma/);
   await page.locator('#sensor-recover-button').click();await waitText(page,'#status-title','Alarma de impacto');
   page.once('dialog',d=>d.accept());await page.locator('#reset-button').click();await waitText(page,'#status-title','Sin alarma');assert.equal((await status()).alarmaActiva,false);
   await page.locator('[data-view="actividad"]:visible').click();const ready=page.waitForEvent('download');await page.locator('#export-history').click();const download=await ready;const csv=await readFile(await download.path(),'utf8');assert.match(csv,/65001/);assert.match(csv,/receivedAt/);
   await page.locator('[data-view="inicio"]:visible').click();
   const path=`${screenshotDir}/dashboard-${width}.png`;await page.screenshot({path,fullPage:true});artifacts.push(path);
   if(width===390){
    await page.locator('#simulate-button').click();await page.locator('#impact-modal[open]').waitFor();await page.keyboard.press('Escape');
    await page.route('**/api/status',r=>r.abort());await waitText(page,'#connection-state','Sin conexión');assert.equal(await page.locator('#reset-button').isEnabled(),false);assert.match(await page.locator('#status-title').textContent(),/Alarma activa/);
    await page.unroute('**/api/status');await clean();
   }
   await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({server:origin,widths:[360,390,768,1440],browserErrors:errors,externalRequests:external,screenshots:artifacts},null,2));
 }finally{await browser.close();await clean();}
});
