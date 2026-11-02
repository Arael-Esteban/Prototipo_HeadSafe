/* HeadSafe educational impact telemetry, NOT medical or protective equipment.
 * Original raw threshold retained; no force (N) or injury inference.
 * Sensor/outputs run in loop; HTTP in a separate task, so slow clients cannot
 * stop sampling, button debounce or tones. No polling delay()/waiting loops.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Preferences.h>
#include <esp_system.h>
#include "alarm_core.h"
#include "config.h"
#include "web_assets.h"

constexpr uint8_t SDA_PIN=26,SCL_PIN=27,RED_PIN=12,GREEN_PIN=14,BUZZER_PIN=33,BUTTON_PIN=25,MPU_ADDR=0x68;
headsafe::AlarmCore alarmCore;

headsafe::ButtonDebounce button;
headsafe::ResetCommands resetCommands;
portMUX_TYPE stateMux=portMUX_INITIALIZER_UNLOCKED;
WebServer server(80);
String deviceId,bootId,resetToken,apSsid,apPassword;
bool apStarted=false,staPending=false,sensorConfigured=false;
uint32_t staStarted=0,lastSample=0,lastRetry=0,sensorReadyAt=0,lastHealth=0;
headsafe::TonePattern tones;
unsigned lastFrequency=0;

String randomHex(size_t bytes) {
  String result; result.reserve(bytes*2);
  for(size_t i=0;i<bytes;++i) { char value[3]; snprintf(value,sizeof(value),"%02x",uint8_t(esp_random())); result+=value; }
  return result;
}
void startAccessPoint() {
  if(apStarted) return;
  WiFi.mode(strlen(WIFI_SSID)>0?WIFI_AP_STA:WIFI_AP);
  apStarted=WiFi.softAP(apSsid.c_str(),apPassword.c_str());
  if(apStarted) { Serial.print("HeadSafe AP: "); Serial.println(apSsid); Serial.print("URL: http://"); Serial.println(WiFi.softAPIP()); }
  else Serial.println("ERROR: access point could not start; physical alarm remains active.");
}
void setupNetwork() {
  const uint64_t mac=ESP.getEfuseMac();
  char id[22]; snprintf(id,sizeof(id),"HeadSafe-%04x%08x",unsigned((mac>>32)&0xffff),unsigned(mac&0xffffffff)); deviceId=id;
  apSsid=deviceId; // Full efuse MAC suffix avoids short-suffix SSID collisions.
  WiFi.mode(strlen(WIFI_SSID)>0?WIFI_AP_STA:WIFI_AP); // RF is enabled before random bytes.
  bootId=randomHex(8); resetToken=randomHex(16);
  Preferences preferences;
  if(preferences.begin("headsafe",false)) {
    apPassword=preferences.getString("apPassword","");
    if(apPassword.length()!=32) {
      apPassword=randomHex(16);
      if(preferences.putString("apPassword",apPassword)==0) Serial.println("WARNING: password persistence failed.");
    }
    preferences.end();
  } else { apPassword=randomHex(16); Serial.println("WARNING: NVS unavailable; AP password is temporary."); }
  // Printed once at boot. Credentials are not sent in API responses.
  Serial.print("HeadSafe WPA2 AP password: "); Serial.println(apPassword);
  if(strlen(WIFI_SSID)>0) { WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID,WIFI_PASSWORD); staStarted=millis(); staPending=true; }
  else startAccessPoint();
}

bool readRegisters(uint8_t reg,uint8_t* data,size_t count) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(reg);
  if(Wire.endTransmission(false)!=0) return false;
  if(Wire.requestFrom(MPU_ADDR,uint8_t(count),true)!=count) return false;
  for(size_t i=0;i<count;++i) data[i]=Wire.read();
  return true;
}
bool writeRegister(uint8_t reg,uint8_t value) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(reg); Wire.write(value); return Wire.endTransmission()==0;
}
bool configureSensor() {
  uint8_t identity=0,config=0;
  if(!readRegisters(0x75,&identity,1) || identity!=0x68) return false;
  // PLL clock, awake, all axes enabled, DLPF 44 Hz, 200 Hz sample rate,
  // ACCEL_CONFIG AFS_SEL=0 explicitly chooses +/-2g (16384 counts/g).
  if(!writeRegister(0x6B,0x01)||!writeRegister(0x6C,0x00)||!writeRegister(0x1A,0x03)||!writeRegister(0x19,0x04)||!writeRegister(0x1C,0x00)) return false;
  return readRegisters(0x1C,&config,1) && config==0;
}
void sensorFailed(uint32_t now) {
  sensorConfigured=false; lastRetry=now;
  portENTER_CRITICAL(&stateMux); alarmCore.sample(0,0,0,false,now); portEXIT_CRITICAL(&stateMux);
}
void serviceSensor(uint32_t now) {
  if(!sensorConfigured) {
    if(uint32_t(now-lastRetry)<1000) return;
    lastRetry=now;
    if(configureSensor()) { sensorConfigured=true; sensorReadyAt=now; lastHealth=now; }
    return;
  }
  if(uint32_t(now-sensorReadyAt)<100 || uint32_t(now-lastSample)<5) return;
  lastSample=now;
  if(uint32_t(now-lastHealth)>=1000) {
    lastHealth=now; uint8_t config=0,power=0;
    if(!readRegisters(0x1C,&config,1)||config!=0||!readRegisters(0x6B,&power,1)||(power&0x60)) { sensorFailed(now); return; }
  }
  uint8_t raw[6];
  if(!readRegisters(0x3B,raw,sizeof(raw))) { sensorFailed(now); return; }
  headsafe::AccelerationSample motion;
  if(!headsafe::parseAcceleration(raw,sizeof(raw),motion)) { sensorFailed(now); return; }
  portENTER_CRITICAL(&stateMux);

  alarmCore.sample(motion.ax,motion.ay,motion.az,true,now);
  portEXIT_CRITICAL(&stateMux);
}
void serviceOutputs(uint32_t now) {
  bool active=false,green=false,ok=false;
  portENTER_CRITICAL(&stateMux); active=alarmCore.alarm; green=alarmCore.green(); ok=alarmCore.sensorOk; portEXIT_CRITICAL(&stateMux);
  digitalWrite(RED_PIN,active || (!ok && (now/300)%2)); digitalWrite(GREEN_PIN,green);
  const unsigned frequency=tones.update(active,now);
  if(frequency!=lastFrequency) {
    if(frequency) tone(BUZZER_PIN,frequency); else noTone(BUZZER_PIN);
    lastFrequency=frequency;
  }
}

void securityHeaders() {
  server.sendHeader("Cache-Control","no-store");
  server.sendHeader("X-Content-Type-Options","nosniff");
  server.sendHeader("X-Frame-Options","DENY");
  server.sendHeader("Content-Security-Policy","default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}
bool allowedHost() {
  // Exact active numeric interface IPs only: no DNS lookup or rebinding names.
  const String apIP=WiFi.softAPIP().toString();
  const String staIP=WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():String("");
  if(headsafe::allowedHost(server.hostHeader().c_str(),apIP.c_str(),staIP.c_str())) return true;
  securityHeaders(); server.send(403,"application/json","{\"error\":\"invalid_host\"}"); return false;
}
bool allowedOrigin() {
  if(!allowedHost()) return false;
  if(headsafe::sameOrigin(server.header("Origin").c_str(),server.hostHeader().c_str())) return true;
  securityHeaders(); server.send(403,"application/json","{\"error\":\"cross_origin_forbidden\"}"); return false;
}
String statusJson() {
  headsafe::AlarmCore snapshot;
  portENTER_CRITICAL(&stateMux); snapshot=alarmCore; portEXIT_CRITICAL(&stateMux);
  String json; json.reserve(4800);
  json="{\"deviceId\":\""+deviceId+"\",\"bootId\":\""+bootId+"\",\"mode\":\"hardware\",\"alarmaActiva\":";
  json+=(snapshot.alarm?"true":"false"); json+=",\"sensorOk\":"; json+=(snapshot.sensorOk?"true":"false");
  json+=",\"ax\":"+String(snapshot.ax)+",\"ay\":"+String(snapshot.ay)+",\"az\":"+String(snapshot.az);

  json+=",\"sampleRateHz\":200,\"resetCommandsRemaining\":"+String(128-resetCommands.count);
  json+=",\"fuerzaImpactoHorizontal\":"+String(snapshot.horizontal)+",\"peak\":"+String(snapshot.peak)+",\"threshold\":65000";
  json+=",\"uptimeMs\":"+String(millis())+",\"sequence\":"+String(snapshot.sequence)+",\"events\":[";
  for(size_t i=0;i<snapshot.eventCount;++i) {
    const auto& e=snapshot.event(i); if(i) json+=',';
    json+="{\"id\":"+String(e.id)+",\"uptimeMs\":"+String(e.uptimeMs)+",\"value\":"+String(e.value);
    json+=",\"type\":\""; json+=(e.impact?"impact":"reset"); json+="\",\"source\":\"";
    json+=(e.source==headsafe::Source::Sensor?"sensor":e.source==headsafe::Source::Physical?"physical":"remote"); json+="\"}";
  }
  json+="],\"resetToken\":\""+resetToken+"\"}";
  return json;
}
void handleReset() {
  if(!allowedOrigin()) return;
  securityHeaders();
  if(server.header("X-HeadSafe-Token")!=resetToken) { server.send(403,"application/json","{\"error\":\"invalid_token\"}"); return; }
  const String contentType=server.header("Content-Type");
  if(contentType!="application/json" && !contentType.startsWith("application/json;")) { server.send(415,"application/json","{\"error\":\"json_required\"}"); return; }
  const String body=server.arg("plain"); char commandId[65];
  if(body.length()>128 || body.length()!=strlen(body.c_str()) || !headsafe::parseCommand(body.c_str(),commandId)) { server.send(400,"application/json","{\"error\":\"invalid_commandId\"}"); return; }
  const auto result=resetCommands.accept(commandId);
  if(result==headsafe::CommandResult::Full) { server.send(429,"application/json","{\"error\":\"reset_limit_per_boot\"}"); return; }
  if(result==headsafe::CommandResult::Invalid) { server.send(400,"application/json","{\"error\":\"invalid_commandId\"}"); return; }
  if(result==headsafe::CommandResult::New) {
    portENTER_CRITICAL(&stateMux); alarmCore.reset(millis(),headsafe::Source::Remote); portEXIT_CRITICAL(&stateMux);
  }
  // A retry acknowledges CURRENT state without clearing any newer impact.
  server.send(200,"application/json",statusJson());
}
void httpTask(void*) {
  const char* headers[]={"Origin","X-HeadSafe-Token","Content-Type"}; server.collectHeaders(headers,3);
  for(size_t i=0;i<WEB_ASSET_COUNT;++i) {
    const WebAsset asset=WEB_ASSETS[i];
    server.on(asset.path,HTTP_GET,[asset](){
      if(!allowedHost()) return;
      securityHeaders(); server.sendHeader("Content-Encoding","gzip");
      server.send_P(200,asset.mime,reinterpret_cast<const char*>(asset.data),asset.size);
    });
  }
  server.on("/api/status",HTTP_GET,[](){if(allowedOrigin()){securityHeaders();server.send(200,"application/json",statusJson());}});
  server.on("/api/reset",HTTP_POST,handleReset);
  server.onNotFound([](){securityHeaders();server.send(404,"application/json","{\"error\":\"not_found\"}");});
  server.begin();
  for(;;) { server.handleClient(); vTaskDelay(pdMS_TO_TICKS(1)); }
}
void setup() {
  Serial.begin(115200);
  pinMode(RED_PIN,OUTPUT); pinMode(GREEN_PIN,OUTPUT); pinMode(BUZZER_PIN,OUTPUT); pinMode(BUTTON_PIN,INPUT_PULLUP);
  digitalWrite(RED_PIN,HIGH); digitalWrite(GREEN_PIN,LOW); digitalWrite(BUZZER_PIN,LOW);
  Wire.begin(SDA_PIN,SCL_PIN); Wire.setClock(400000); Wire.setTimeOut(5);
  lastRetry=millis()-1000; // First attempt on the first loop, not a blocking setup wait.
  setupNetwork();
  if(xTaskCreatePinnedToCore(httpTask,"headsafe-http",8192,nullptr,1,nullptr,0)!=pdPASS) Serial.println("ERROR: HTTP task failed; physical alarm remains operational.");
}
void loop() {
  const uint32_t now=millis();
  serviceSensor(now); // Always sample, including while latched or button held.
  if(button.update(digitalRead(BUTTON_PIN)==HIGH,now)) {
    portENTER_CRITICAL(&stateMux); alarmCore.reset(now,headsafe::Source::Physical); portEXIT_CRITICAL(&stateMux);
  }
  serviceOutputs(now);
  if(staPending) {
    if(WiFi.status()==WL_CONNECTED) { staPending=false; Serial.print("HeadSafe LAN URL: http://"); Serial.println(WiFi.localIP()); }
    else if(uint32_t(now-staStarted)>=15000) { staPending=false; startAccessPoint(); }
  }
  if(!staPending && !apStarted && WiFi.status()!=WL_CONNECTED) startAccessPoint();
  yield();
}
