import {test,expect} from '@playwright/test';

async function cleanDevice(request){const s=await (await request.get('/api/status')).json();await request.post('/api/simulate',{data:{action:'sensor-recover'}});await request.post('/api/reset',{headers:{'X-HeadSafe-Token':s.resetToken},data:{commandId:crypto.randomUUID()}});}
async function navigate(page,name){const button=page.locator(`[data-view="${name}"]:visible`).first();await button.click();}

for(const width of [360,390,768,1440])test(`original design: alarm, Escape, acknowledged reset and CSV at ${width}px`,async({page,request})=>{
 await cleanDevice(request);await page.setViewportSize({width,height:900});
 const errors=[];const external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(!['127.0.0.1','localhost'].includes(u.hostname)&&!['data:','blob:'].includes(u.protocol))external.push(r.url());});
 await page.goto('/');await expect(page.locator('#status-title')).toHaveText(/sin alarma|conectado/i);
 await expect(page.locator('#simulate-button')).toBeVisible();await page.locator('#simulate-button').click();
 await expect(page.locator('#status-title')).toHaveText(/alarma|impacto/i);
 await expect(page.locator('#impact-modal')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('#impact-modal')).toBeHidden();
 expect((await (await request.get('/api/status')).json()).alarmaActiva).toBe(true);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#reset-button').click();
 await expect(page.locator('#status-title')).toHaveText(/sin alarma|conectado/i);
 await navigate(page,'actividad');
 const wait=page.waitForEvent('download');await page.locator('#export-history').click();const download=await wait;
 const stream=await download.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk.toString();expect(csv).toMatch(/impact|sensor/i);expect(csv).toContain('65001');
 for(const name of ['dispositivo','inicio']){await navigate(page,name);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.screenshot({path:`verification/dashboard-${width}.png`,fullPage:true});expect(errors).toEqual([]);expect(external).toEqual([]);
});

test('offline retains the alarm as stale, disables reset, and recovers with explicit sensor fault',async({page,request})=>{
 await cleanDevice(request);await request.post('/api/simulate',{data:{action:'impact',value:65001}});await page.goto('/');await expect(page.locator('#status-title')).toHaveText(/alarma|impacto/i);await page.keyboard.press('Escape');
 await page.route('**/api/status',r=>r.abort());await expect(page.locator('#connection-state')).toHaveText(/sin conexión|desconectado/i,{timeout:10000});await expect(page.locator('#reset-button')).toBeDisabled();
 expect((await (await request.get('/api/status')).json()).alarmaActiva).toBe(true);
 await request.post('/api/simulate',{data:{action:'sensor-fail'}});await page.unroute('**/api/status');await expect(page.locator('#status-title')).toHaveText(/sensor|error|fallo/i,{timeout:10000});
 await request.post('/api/simulate',{data:{action:'sensor-recover'}});await expect(page.locator('#status-title')).toHaveText(/alarma|impacto/i);await cleanDevice(request);
});

test('hardware contract hides simulation without any phone sensor permissions',async({page,request})=>{
 await cleanDevice(request);
 await page.route('**/api/status',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,mode:'hardware',deviceId:'CONTRACT-FIXTURE-ESP32'}});});
 await page.goto('/');await expect(page.locator('#connection-state')).toHaveText(/conectad[ao]|en línea|en vivo/i);
 await expect(page.locator('#simulate-button')).toBeHidden();
 const html=await page.content();expect(html).not.toContain('PROTECCIÓN ACTIVA');
});

test('offline technical guide has correct pins, no outside requests and fits mobile',async({page})=>{
 await page.setViewportSize({width:360,height:800});const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8768/')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto('/base-informativa.html');await expect(page.getByRole('heading',{level:1})).toContainText('Conecta la placa');
 await expect(page.locator('table')).toContainText('GPIO26');await expect(page.locator('table')).toContainText('GPIO27');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(external).toEqual([]);
 await page.screenshot({path:'verification/guide-mobile.png',fullPage:true});
});
