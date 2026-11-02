import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

async function fixture(t) {
  const {createHeadSafeHandler}=await import('../server.mjs');
  const server=createServer(createHeadSafeHandler({webRoot:fileURLToPath(new URL('./fixtures/web',import.meta.url))}));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base, get:async()=> (await fetch(base+'/api/status')).json()};
}

test('serves real local assets and rejects unsupported paths and HTTP methods',async t=>{
  const {base}=await fixture(t);
  let r=await fetch(base+'/'); assert.equal(r.status,200); assert.match(r.headers.get('content-type'),/text\/html/);
  assert.match(await r.text(),/Fixture estática de prueba/);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
  assert.equal((await fetch(base+'/%2e%2e/server.mjs')).status,404);
  assert.equal((await fetch(base+'/api/status',{method:'DELETE'})).status,405);
});

test('simulator is explicitly labelled, initially healthy, with uncached status',async t=>{
  const {base}=await fixture(t);
  const response=await fetch(base+'/api/status');
  assert.match(response.headers.get('cache-control'),/no-store/);
  const s=await response.json();
  assert.equal(s.mode,'simulation'); assert.equal(s.alarmaActiva,false);
  assert.equal(s.sensorOk,true); assert.equal(s.threshold,65000);
  assert.equal(s.events.length,0); assert.ok(s.resetToken.length>=32);
});

test('reset command limit matches firmware and never evicts old identifiers',async t=>{
  const {base,get}=await fixture(t);const state=await get();
  const reset=commandId=>fetch(base+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-HeadSafe-Token':state.resetToken},body:JSON.stringify({commandId})});
  for(let i=0;i<128;i++)assert.equal((await reset(`capacity-${i}`)).status,200);
  assert.equal((await reset('capacity-overflow')).status,429);
  await fetch(base+'/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'impact',value:65001})});
  assert.equal((await reset('capacity-0')).status,200);
  assert.equal((await get()).alarmaActiva,true);
});

test('maximum magnitude uses valid signed 16-bit samples',async t=>{
  const {base}=await fixture(t);
  const r=await fetch(base+'/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'impact',value:65536})});
  const s=await r.json();assert.equal(r.status,200);
  assert.ok(s.ax>=-32768 && s.ax<=32767);assert.ok(s.ay>=-32768 && s.ay<=32767);
  assert.equal(Math.abs(s.ax)+Math.abs(s.ay),s.fuerzaImpactoHorizontal);
});

test('sensor fault never clears a latched alarm and can recover explicitly',async t=>{
  const {base,get}=await fixture(t);
  const sim=async data=>(await fetch(base+'/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  await sim({action:'impact',value:65001});
  let s=await sim({action:'sensor-fail'});
  assert.equal(s.sensorOk,false); assert.equal(s.alarmaActiva,true);
  s=await sim({action:'sensor-recover'});
  assert.equal(s.sensorOk,true); assert.equal(s.alarmaActiva,true);
});

test('simulator rejects invalid samples and cross-origin writes',async t=>{
  const {base,get}=await fixture(t);
  const post=(data,headers={})=>fetch(base+'/api/simulate',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  for(const value of [-1,65537,'65001',null,1.5]) assert.equal((await post({action:'impact',value})).status,400);
  assert.equal((await post({action:'unknown'})).status,400);
  assert.equal((await post({action:'impact',value:65001},{Origin:'http://evil.invalid'})).status,403);
  assert.equal((await get()).events.length,0);
});

test('impact threshold latches once and only authenticated reset clears it',async t=>{
  const {base,get}=await fixture(t);
  const post=(route,data,token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-HeadSafe-Token':token}:{})},body:JSON.stringify(data)});
  await post('/api/simulate',{action:'impact',value:65000});
  assert.equal((await get()).alarmaActiva,false);
  await post('/api/simulate',{action:'impact',value:65001});
  let s=await get(); assert.equal(s.alarmaActiva,true); assert.equal(s.events.length,1); assert.equal(s.events[0].value,65001);
  await post('/api/simulate',{action:'impact',value:65002});
  assert.equal((await get()).events.length,1);
  assert.equal((await post('/api/reset',{commandId:'blocked'})).status,403);
  assert.equal((await get()).alarmaActiva,true);
  let r=await post('/api/reset',{commandId:'reset-1'},s.resetToken);
  assert.equal(r.status,200); s=await r.json(); assert.equal(s.alarmaActiva,false);
  assert.equal(s.events[0].type,'reset'); assert.equal(s.events[0].source,'remote');
  await post('/api/reset',{commandId:'reset-1'},s.resetToken);
  assert.equal((await get()).events.length,2);
  await post('/api/simulate',{action:'impact',value:65001});
  await post('/api/reset',{commandId:'reset-1'},s.resetToken);
  assert.equal((await get()).alarmaActiva,true,'an old reset command must not clear a new alarm');
});
