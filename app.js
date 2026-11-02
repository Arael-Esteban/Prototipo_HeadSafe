/* HeadSafe local ESP32 client. No phone sensors, external calls or service worker. */
'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { data:null, online:false, receivedAt:0, polling:false, pending:false, error:'', generation:0, pollTimer:null, pollController:null };
const number = value => new Intl.NumberFormat('es-CL').format(value);
const text = (selector, value) => { $(selector).textContent = String(value); };
function renderStatus() {
  const d=state.data;
  text('#connection-state',state.online?'Conectada · API local':d?'Sin conexión · datos antiguos':'Sin conexión');
  $('#connection-state').dataset.state=state.online?'connected':'offline';
  $('#simulation-notice').hidden=d?.mode!=='simulation';
  if (!d) { text('#status-title','Sin datos de la ESP32.'); text('#status-detail',state.error || 'Esperando una respuesta válida del dispositivo.'); return; }
  $('#monitor-card').dataset.state=!state.online?'stale':d.alarmaActiva?'alarm':!d.sensorOk?'fault':'ready';
  text('#mode-label',d.mode==='simulation'?'DEMOSTRACIÓN · PC':'ESP32 · HARDWARE LOCAL');
  text('#status-title',!state.online?(d.alarmaActiva?'Alarma activa · sin conexión':'Estado sin confirmar'):d.alarmaActiva?(d.sensorOk?'Alarma de impacto activa':'Alarma activa · fallo del sensor'):!d.sensorOk?'Fallo del sensor MPU6050':'Sin alarma registrada.');
  text('#status-detail',!state.online?'Se conserva la última lectura. No se conoce el estado actual. '+state.error:d.alarmaActiva?(d.sensorOk?'La ESP32 mantiene la alarma. Restablécela solo después de revisar la situación.':'La alarma sigue activa y el MPU6050 informa un fallo. Revisa la situación, el cableado y la alimentación.'):!d.sensorOk?'La API responde, pero el sensor informa un fallo. Revisa el cableado y la alimentación.':'La ESP32 informa sensor disponible y alarma inactiva. Esto no confirma el estado de una persona.');
  text('#last-update',(state.online?'Última recepción: ':'Datos antiguos · recepción: ')+new Date(state.receivedAt).toLocaleTimeString('es-CL'));
  text('#horizontal-value',d.sensorOk?number(Math.abs(d.ax)+Math.abs(d.ay)):'—');
  for(const a of ['x','y','z']){ text(`#${a}-val`,d.sensorOk?number(d['a'+a]):'—'); $(`#axis-${a}`).style.width=d.sensorOk?Math.min(100,Math.abs(d['a'+a])/32768*100)+'%':'0%'; }
  $('#gauge-path').style.strokeDashoffset=String(157*(1-(d.sensorOk?Math.min(1,(Math.abs(d.ax)+Math.abs(d.ay))/65000):0)));
  text('#peak-value',number(d.peak)); text('#sensor-state',d.sensorOk?'Disponible':'FALLO'); text('#alarm-state',d.alarmaActiva?'ACTIVA':'Inactiva');
  text('#sensor-source',(!state.online?'Datos antiguos · ':d.mode==='simulation'?'Simulación · ':'ESP32 · ')+(d.sensorOk?'MPU6050':'sensor no disponible'));
  text('#uptime-value',number(Math.floor(d.uptimeMs/1000))+' s'); text('#reset-budget',Number.isInteger(d.resetCommandsRemaining)?d.resetCommandsRemaining:'No informado');
  text('#side-device-name',d.deviceId); text('#device-id',d.deviceId); text('#boot-id',d.bootId); text('#device-mode',d.mode==='hardware'?'Hardware ESP32':'Simulación PC');
  text('#sample-rate',Number.isFinite(d.sampleRateHz)?number(d.sampleRateHz)+' Hz':'No informado'); text('#sequence-value',number(d.sequence));
  if(state.pending){$('#monitor-card').dataset.state='pending';text('#status-title',state.pending.phase==='sending'?'Esperando confirmación de la ESP32':'Restablecimiento sin confirmar');text('#status-detail',state.pending.phase==='sending'?'El comando está en curso. La alarma no se considera restablecida hasta recibir una respuesta válida.':'No se pudo verificar la respuesta. Reintenta el mismo comando o revisa el botón físico. No se confirma una desactivación.');}
  const disabled=!state.online||(!d.alarmaActiva&&!state.pending)||state.pending?.phase==='sending'||(d.resetCommandsRemaining===0&&!state.pending);
  for(const selector of ['#reset-button','#modal-reset-button'])text(selector,state.pending?.phase==='uncertain'?'Reintentar confirmación':'Restablecer alarma');
  $('#reset-button').disabled=disabled; $('#modal-reset-button').disabled=disabled;
  for(const selector of ['#simulate-button','#sensor-fail-button','#sensor-recover-button']) $(selector).disabled=!state.online||Boolean(state.pending)||Boolean(state.simBusy);
}
function validateStatus(d) {
  if (!d || typeof d.deviceId!=='string'||!d.deviceId||typeof d.bootId!=='string'||!d.bootId||!['hardware','simulation'].includes(d.mode)||typeof d.alarmaActiva!=='boolean'||typeof d.sensorOk!=='boolean'||d.threshold!==65000||typeof d.resetToken!=='string'||!d.resetToken||!['ax','ay','az','fuerzaImpactoHorizontal','peak','uptimeMs','sequence'].every(k=>Number.isFinite(d[k]))||!Array.isArray(d.events)||d.events.length>32||!d.events.every(validEvent)) throw new Error('Respuesta de telemetría inválida.');
  return d;
}
async function poll() {
  if(state.polling||document.hidden)return;
  clearTimeout(state.pollTimer);
  state.polling=true;const generation=state.generation;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2500);
  state.pollController=controller;
  try { const response=await fetch('/api/status',{signal:controller.signal,cache:'no-store'}); if(!response.ok)throw new Error('API HTTP '+response.status); const d=validateStatus(await response.json());if(generation===state.generation&&!controller.signal.aborted&&!document.hidden)acceptStatus(d); }
  catch(error){if(generation===state.generation){state.online=false;state.error=error.name==='AbortError'?'Tiempo de espera agotado (2,5 s).':error.message;}}
  finally{clearTimeout(timeout);state.pollController=null;state.polling=false;renderStatus();if(!document.hidden)state.pollTimer=setTimeout(poll,400);}
}
function invalidateReading(message){state.generation++;state.online=false;state.error=message;clearTimeout(state.pollTimer);state.pollController?.abort();renderStatus();}
document.addEventListener('visibilitychange',()=>{invalidateReading(document.hidden?'Panel en segundo plano; la última lectura no está vigente.':'Actualizando el estado del dispositivo.');if(!document.hidden)poll();});
window.addEventListener('pagehide',()=>invalidateReading('El panel se suspendió; es necesaria una nueva lectura.'));
window.addEventListener('pageshow',()=>{invalidateReading('Actualizando el estado del dispositivo.');poll();});
window.addEventListener('offline',()=>{invalidateReading('La conexión cambió; comprobando la red local.');if(!document.hidden)poll();});
window.addEventListener('online',()=>{invalidateReading('La conexión cambió; esperando nueva telemetría.');poll();});
function updateDate(){text('#date-label',new Intl.DateTimeFormat('es-CL',{weekday:'long',day:'numeric',month:'short',year:'numeric'}).format(new Date()).toUpperCase());}
updateDate();setInterval(updateDate,60000);poll();

let dialogReturnTarget=null;
const dismissedAlarms=new Set();let alarmEpoch=0,activeAlarmKey=null;
function closeImpact(){ if(activeAlarmKey)dismissedAlarms.add(activeAlarmKey);$('#impact-modal').close(); const target=dialogReturnTarget?.isConnected&&dialogReturnTarget!==document.body?dialogReturnTarget:$('#reset-button'); if(!target.disabled)target.focus(); }
function acceptStatus(d){
  const previous=state.data;
  const newAlarm=d.alarmaActiva&&(!previous||!previous.alarmaActiva||previous.deviceId!==d.deviceId||previous.bootId!==d.bootId);
  state.data=d; state.online=true;state.receivedAt=Date.now();state.error='';ingestEvents(d);renderStatus();
  if(newAlarm){const event=d.events.find(e=>e.type==='impact');activeAlarmKey=JSON.stringify([d.deviceId,d.bootId,event?.id??'latch-'+(++alarmEpoch)]);if(!dismissedAlarms.has(activeAlarmKey)){dialogReturnTarget=document.activeElement;$('#impact-modal').showModal();$('#dismiss-alarm').focus();}}
  if(!d.alarmaActiva&&!state.pending&&$('#impact-modal').open)closeImpact();
}
$('#dismiss-alarm').addEventListener('click',closeImpact);
$('#impact-modal').addEventListener('cancel',event=>{event.preventDefault();closeImpact();});

function toast(message){text('#toast',message);$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function post(path,body,token){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),2500);
  try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-HeadSafe-Token':token},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    if(!response.ok){const error=new Error('Error HTTP '+response.status+(response.status===429?' · límite de comandos por arranque agotado. Usa el botón físico.':response.status===403?' · autorización rechazada. Recarga el panel.':''));error.status=response.status;throw error;}
    return await response.json();
  }finally{clearTimeout(timer);}
}
function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function requireFreshReading(){
 const age=Date.now()-state.receivedAt;
 if(!document.hidden&&age>=0&&age<=2500)return true;
 state.online=false;state.error='La lectura ha caducado. Espera una nueva respuesta antes de restablecer.';renderStatus();toast(state.error);poll();return false;
}
async function resetAlarm(){
  const d=state.data;if(!state.online||!d||state.pending?.phase==='sending'||!requireFreshReading())return;
  if(!d.alarmaActiva&&!state.pending)return;
  if(!confirm('¿Restablecer la alarma de la ESP32? Revisa primero la situación. Esta acción no confirma que una persona esté a salvo.'))return;
  if(!requireFreshReading())return;
  if(state.pending&&(state.pending.deviceId!==d.deviceId||state.pending.bootId!==d.bootId)){toast('El módulo cambió o se reinició. El comando anterior no se puede repetir. Recarga y revisa el dispositivo.');return;}
  state.pending ||= {commandId:uuid(),deviceId:d.deviceId,bootId:d.bootId};state.pending.phase='sending';state.generation++;renderStatus();text('#reset-feedback','Comando enviado. Esperando confirmación de la ESP32…');
  try{
    const response=validateStatus(await post('/api/reset',{commandId:state.pending.commandId},d.resetToken));
    if(response.deviceId!==state.pending.deviceId||response.bootId!==state.pending.bootId)throw new Error('La respuesta corresponde a otro dispositivo o arranque. Revisa la conexión.');
    state.generation++;state.pending=null;acceptStatus(response);
    const message=response.alarmaActiva?'La ESP32 respondió, pero la alarma sigue activa. Revisa el sensor y la situación antes de enviar otro comando.':'Restablecimiento confirmado por la ESP32.';
    text('#reset-feedback',message);toast(message);
  }catch(error){
    if(error.status>=400&&error.status<500){state.pending=null;}else{state.pending.phase='uncertain';}
    const message=error.name==='AbortError'?'Tiempo de espera agotado. Resultado del comando sin confirmar.':error.message;
    text('#reset-feedback',message);toast(message);renderStatus();
  }
}
$('#reset-button').addEventListener('click',resetAlarm);$('#modal-reset-button').addEventListener('click',resetAlarm);

async function simulate(action){
 if(!state.online||state.data?.mode!=='simulation'||state.simBusy||state.pending)return;
 state.simBusy=true;renderStatus();
 try{await post('/api/simulate',action==='impact'?{action,value:65001}:{action},state.data.resetToken);toast('Comando de demostración aceptado. Esperando telemetría.');}
 catch(error){toast(error.name==='AbortError'?'Tiempo de espera agotado. Resultado de la simulación sin confirmar.':error.message);}
 finally{state.simBusy=false;renderStatus();}
}
$('#simulate-button').addEventListener('click',()=>simulate('impact'));$('#sensor-fail-button').addEventListener('click',()=>simulate('sensor-fail'));$('#sensor-recover-button').addEventListener('click',()=>simulate('sensor-recover'));

function switchView(name){
 const titles={inicio:'Panel de control',actividad:'Actividad',dispositivo:'Dispositivo'};
 if(!Object.hasOwn(titles,name))return;
 for(const view of $$('.view')){const active=view.id==='view-'+name;view.hidden=!active;view.classList.toggle('active',active);}
 for(const button of $$('[data-view]')){const active=button.dataset.view===name;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 text('#page-title',titles[name]);window.scrollTo({top:0,behavior:'instant'});
}
for(const button of $$('[data-view]'))button.addEventListener('click',()=>switchView(button.dataset.view));
for(const button of $$('[data-go]'))button.addEventListener('click',event=>{event.preventDefault();switchView(button.dataset.go);});
$('#modal-device-button').addEventListener('click',()=>{closeImpact();switchView('dispositivo');$('#device-address').focus();});

const STORAGE_KEY='headsafe-esp32-original-v1';
function readLocal(){try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?{archive:value.archive,seen:value.seen}:{};}catch{$('#storage-warning').hidden=false;return {};}}
const local=readLocal();
function saveLocal(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(local));return true;}catch{$('#storage-warning').hidden=false;return false;}}
function element(tag,content,className){const node=document.createElement(tag);if(content!==undefined)node.textContent=String(content);if(className)node.className=className;return node;}
function validEvent(e){return e&&['string','number'].includes(typeof e.id)&&(typeof e.id!=='number'||Number.isFinite(e.id))&&Number.isFinite(e.uptimeMs)&&e.uptimeMs>=0&&Number.isFinite(e.value)&&['impact','reset'].includes(e.type)&&['sensor','physical','remote'].includes(e.source);}
const archive=Array.isArray(local.archive)?local.archive.filter(e=>validEvent(e)&&typeof e.deviceId==='string'&&typeof e.bootId==='string'&&['hardware','simulation'].includes(e.mode)&&typeof e.receivedAt==='string'&&Number.isFinite(Date.parse(e.receivedAt))).slice(0,1000):[];
const eventKey=(deviceId,bootId,id)=>JSON.stringify([deviceId,bootId,id]);
const seen=new Set(Array.isArray(local.seen)?local.seen.filter(v=>typeof v==='string').slice(-10000):[]);
for(const e of archive)seen.add(eventKey(e.deviceId,e.bootId,e.id));
function saveArchive(){local.archive=archive;local.seen=[...seen].slice(-10000);return saveLocal();}
function ingestEvents(d){
 text('#ring-count',d.events.length+' / 32');let changed=false;
 const fresh=[];
 for(const event of d.events){const key=eventKey(d.deviceId,d.bootId,event.id);if(seen.has(key))continue;seen.add(key);fresh.push({...event,deviceId:d.deviceId,bootId:d.bootId,mode:d.mode,receivedAt:new Date(state.receivedAt).toISOString()});changed=true;}
 if(changed){archive.unshift(...fresh);archive.splice(1000);saveArchive();renderEvents();}
}
function eventNode(e){
 const row=element('div',undefined,'event-row');row.dataset.type=e.type;row.append(element('span',e.type==='impact'?'!':'↺','event-symbol'));
 const body=element('div');body.append(element('b',e.type==='impact'?'Impacto registrado':'Alarma restablecida'));
 const source={sensor:'Sensor',physical:'Botón físico',remote:'Comando remoto'}[e.source];
 body.append(element('small',source+' · '+number(e.value)+' raw · '+(e.mode==='simulation'?'Simulación PC':'Hardware')));
 body.append(element('small','Desde el arranque: '+number(e.uptimeMs)+' ms · Evento '+e.id));
 body.append(element('small',e.deviceId+' · Arranque '+e.bootId));
 const received=element('time','Recibido: '+new Date(e.receivedAt).toLocaleString('es-CL'));received.dateTime=e.receivedAt;body.append(received);row.append(body);return row;
}
function renderEvents(){
 text('#event-count',archive.length);text('#impact-count',archive.filter(e=>e.type==='impact').length);
 for(const [selector,items] of [['#recent-events',archive.slice(0,3)],['#full-events',archive]]){const container=$(selector);container.replaceChildren();if(!items.length)container.append(element('p','No hay eventos en el archivo local. Los próximos eventos del dispositivo aparecerán aquí.','empty'));else container.append(...items.map(eventNode));}
}
function csvCell(value){const valueString=String(value);const safe=/^[\s]*[=+\-@\t\r\n]/.test(valueString)?"'"+valueString:valueString;return '"'+safe.replaceAll('"','""')+'"';}
$('#export-history').addEventListener('click',()=>{
 if(!archive.length){toast('No hay eventos en el archivo local para exportar.');return;}
 const columns=['deviceId','bootId','id','mode','type','source','uptimeMs','value','receivedAt'];const rows=[columns,...archive.map(e=>columns.map(k=>e[k]))];const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=element('a');link.href=url;link.download='headsafe-archivo-local.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('CSV preparado con tiempos del dispositivo y fechas de recepción separadas.');
});
$('#clear-history').addEventListener('click',()=>{if(!confirm('¿Borrar el archivo local de eventos de este navegador? No se borra la memoria de la ESP32.'))return;archive.length=0;const saved=saveArchive();renderEvents();toast(saved?'Archivo local borrado. Los eventos ya vistos no se volverán a importar.':'Archivo borrado solo en esta sesión; el almacenamiento local no está disponible.');});
renderEvents();

function localPanelAddress(value){
 let url;try{url=new URL(value);}catch{throw new Error('Escribe una dirección local válida, por ejemplo http://192.168.4.1');}
 const host=url.hostname.toLowerCase();const parts=host.split('.').map(Number);
 const privateIPv4=parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(parts[0]===10||parts[0]===127||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===169&&parts[1]===254);
 const localHost=host==='localhost'||/^[a-z0-9.-]+\.local$/.test(host)||host==='[::1]'||/^\[(?:fc|fd|fe80:)[a-f0-9:]+\]$/.test(host);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||(!privateIPv4&&!localHost))throw new Error('Usa solo la dirección local HTTP/HTTPS de la ESP32, sin credenciales, rutas ni parámetros.');
 return url.origin+'/';
}
$('#device-form').addEventListener('submit',event=>{event.preventDefault();try{const address=localPanelAddress($('#device-address').value.trim());text('#device-error','');window.location.assign(address);}catch(error){text('#device-error',error.message);}});
