import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,get} from 'node:http';
import {once} from 'node:events';
import {createHeadSafeHandler} from '../server.mjs';

async function fixture(t){const server=createServer(createHeadSafeHandler());server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}

test('original-design dashboard serves its own local assets and technical guide, not source files',async t=>{
 const base=await fixture(t);
 for(const [path,type] of [['/','text/html'],['/styles.css','text/css'],['/app.js','javascript'],['/base-informativa.html','text/html'],['/guide.css','text/css'],['/assets/favicon.svg','image/svg+xml'],['/assets/images/headsafe-hero.webp','image/webp'],['/assets/images/headsafe-wiring.svg','image/svg+xml'],['/assets/fonts/Manrope.ttf','font/ttf']]){
  const r=await fetch(base+path);assert.equal(r.status,200,path);assert.ok(r.headers.get('content-type').includes(type),path);assert.ok((await r.arrayBuffer()).byteLength>0,path);
 }
 for(const path of ['/server.py','/server.mjs','/firmware/HeadSafe/config.h','/.env','/package-lock.json','/verification/source-provenance.json','/sw.js'])assert.equal((await fetch(base+path)).status,404,path);
});

test('local simulator rejects DNS rebinding hosts and strict reset JSON mismatches',async t=>{
 const base=await fixture(t);const s=await (await fetch(base+'/api/status')).json();
 // Node fetch intentionally rewrites Host; use http.get to exercise the actual rebinding header.
 const badHost=await new Promise((resolve,reject)=>get(base+'/api/status',{headers:{Host:'attacker.invalid'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject));assert.equal(badHost,421);
 for(const body of ['{"commandId":"a","extra":1}','{"commandId":"a","commandId":"b"}','null','[]']) {
  const r=await fetch(base+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-HeadSafe-Token':s.resetToken},body});assert.equal(r.status,400,body);
 }
 const r=await fetch(base+'/api/reset',{method:'POST',headers:{'Content-Type':'text/plain','X-HeadSafe-Token':s.resetToken},body:'{"commandId":"valid"}'});assert.equal(r.status,415);
});

test('status exposes only original accelerometer telemetry and the reset budget',async t=>{
 const base=await fixture(t);const response=await fetch(base+'/api/status');const s=await response.json();
 assert.equal(s.mode,'simulation');assert.equal(s.deviceId,'HEADSAFE-ORIGINAL-DESIGN-DEMO');
 for(const key of ['gx','gy','gz','battery','latitude','longitude'])assert.equal(key in s,false,key);
 for(const key of ['ax','ay','az','fuerzaImpactoHorizontal'])assert.equal(typeof s[key],'number');
 assert.equal(s.sampleRateHz,200);assert.equal(s.resetCommandsRemaining,128);
 assert.equal('battery' in s,false);assert.equal('latitude' in s,false);
 const r=await fetch(base+'/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-HeadSafe-Token':s.resetToken},body:JSON.stringify({commandId:'test-budget'})});
 assert.equal((await r.json()).resetCommandsRemaining,127);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('permissions-policy'),/accelerometer=\(\)/);
 assert.ok(response.headers.get('content-security-policy').includes("style-src 'self';"));
 assert.ok(response.headers.get('content-security-policy').includes("worker-src 'none';"));
});
