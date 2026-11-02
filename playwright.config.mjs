import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const brave='C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
if(process.env.TMPDIR){process.env.TEMP=process.env.TMPDIR;process.env.TMP=process.env.TMPDIR;}
export default defineConfig({
 testDir:'./tests',testMatch:'browser.spec.mjs',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:8768',headless:true,acceptDownloads:true,launchOptions:existsSync(brave)?{executablePath:brave}:{},trace:'retain-on-failure'},
 webServer:{command:'node server.mjs',url:'http://127.0.0.1:8768/api/status',env:{PORT:'8768'},reuseExistingServer:false},
 reporter:[['list'],['json',{outputFile:'verification/browser-results.json'}]]
});
