import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';

export function createHeadSafeHandler({webRoot=fileURLToPath(new URL('./',import.meta.url))}={}) {
  const start=Date.now();
  const resetCommands=new Set();
  const state={deviceId:'HEADSAFE-ORIGINAL-DESIGN-DEMO',bootId:randomBytes(8).toString('hex'),mode:'simulation',alarmaActiva:false,sensorOk:true,ax:0,ay:0,az:16384,sampleRateHz:200,resetCommandsRemaining:128,fuerzaImpactoHorizontal:0,peak:0,threshold:65000,uptimeMs:0,sequence:0,events:[],resetToken:randomBytes(24).toString('hex')};
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Permissions-Policy','accelerometer=(), gyroscope=(), geolocation=(), bluetooth=()');
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/i.test(req.headers.host||'')) {res.writeHead(421);res.end('Host no permitido');return;}
    if(!['GET','POST'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, POST'});res.end('Método no permitido');return;}
    const pathname=new URL(req.url,'http://localhost').pathname;
    const assets={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/base-informativa.html':['base-informativa.html','text/html; charset=utf-8'],'/guide.css':['guide.css','text/css; charset=utf-8'],'/assets/favicon.svg':['assets/favicon.svg','image/svg+xml'],'/assets/images/headsafe-hero.webp':['assets/images/headsafe-hero.webp','image/webp'],'/assets/images/headsafe-wiring.svg':['assets/images/headsafe-wiring.svg','image/svg+xml'],'/assets/fonts/Manrope.ttf':['assets/fonts/Manrope.ttf','font/ttf'],'/assets/fonts/OFL.txt':['assets/fonts/OFL.txt','text/plain; charset=utf-8']};
    if(req.method==='GET' && Object.hasOwn(assets,pathname)) {
      const [file,type]=assets[pathname];
      try {const data=await readFile(path.join(webRoot,file));res.writeHead(200,{'Content-Type':type});res.end(data);}
      catch {res.writeHead(404);res.end('Archivo no encontrado');}
      return;
    }
    if(req.method==='GET' && req.url==='/api/status') {
      state.uptimeMs=Date.now()-start;
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(state)); return;
    }
    if(req.method==='POST' && ['/api/reset','/api/simulate'].includes(req.url)) {
      const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data));};
      if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) return json(403,{error:'Origen no autorizado'});
      if(req.url==='/api/reset' && req.headers['x-headsafe-token']!==state.resetToken) return json(403,{error:'Token de reinicio incorrecto'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(415,{error:'json_required'});
      let text=''; for await (const chunk of req) {text+=chunk;if(text.length>4096)return json(413,{error:'Solicitud demasiado grande'});}
      let body; try {body=JSON.parse(text);} catch {return json(400,{error:'JSON inválido'});}
      if(!body || typeof body!=='object' || Array.isArray(body))return json(400,{error:'Objeto JSON requerido'});
      if(req.url==='/api/simulate') {
        if(!['impact','sensor-fail','sensor-recover'].includes(body.action))return json(400,{error:'Acción desconocida'});
        if(body.action==='impact' && (!Number.isInteger(body.value)||body.value<0||body.value>65536))return json(400,{error:'Magnitud fuera del rango 0–65536'});
      }
      const event=(type,source,value)=>{state.sequence++; state.events.unshift({id:state.sequence,uptimeMs:Date.now()-start,value,type,source});state.events=state.events.slice(0,32);};
      if(req.url==='/api/reset') {
        if(!/^\s*\{\s*"commandId"\s*:\s*"[A-Za-z0-9_.:-]{1,64}"\s*\}\s*$/.test(text))return json(400,{error:'invalid_commandId'});
        if(typeof body.commandId!=='string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(body.commandId)) return json(400,{error:'commandId inválido (1–64 caracteres)'});
        if(resetCommands.has(body.commandId)) return json(200,{...state,uptimeMs:Date.now()-start});
        if(resetCommands.size>=128)return json(429,{error:'reset_limit_per_boot'});
        resetCommands.add(body.commandId);
        state.resetCommandsRemaining=128-resetCommands.size;
        if(state.alarmaActiva) {state.alarmaActiva=false;event('reset','remote',state.fuerzaImpactoHorizontal);}
        state.fuerzaImpactoHorizontal=0;state.ax=0;state.ay=0;
      } else if(body.action==='impact') {
        state.fuerzaImpactoHorizontal=body.value;state.ax=-Math.min(32768,body.value);state.ay=-(body.value-Math.abs(state.ax));
        state.peak=Math.max(state.peak,body.value);
        if(state.sensorOk && !state.alarmaActiva && body.value>state.threshold) {state.alarmaActiva=true;event('impact','sensor',body.value);}
      } else if(body.action==='sensor-fail') state.sensorOk=false;
      else if(body.action==='sensor-recover') {state.sensorOk=true;state.ax=0;state.ay=0;state.fuerzaImpactoHorizontal=0;}
      state.uptimeMs=Date.now()-start;
      return json(200,state);
    }
    res.writeHead(404); res.end('No encontrado');
  };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||8767);
  createServer(createHeadSafeHandler()).listen(port,'127.0.0.1',()=>console.log(`HeadSafe SIMULADOR http://127.0.0.1:${port}`));
}
