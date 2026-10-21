import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import pg from 'pg';
import srv from '../server.js';

async function withServer(fn, deps={}) {
  const server = srv.createApp(deps).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(r=>server.close(r)); }
}
const conn={host:'pg.test',port:5432,database:'db',user:'u',password:'p',ssl:'strict'};
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('KAMA: public assets work; source, docs, dependencies and secrets are not served',async()=>{
  await withServer(async base=>{
    for(const path of ['/','/index.html']){
      const r=await fetch(base+path,{redirect:'manual'});
      assert.equal(r.status,302,path);
      assert.equal(r.headers.get('location'),'/assets/kama.html',path);
      assert.equal((await fetch(base+path)).status,200,path);
    }
    for(const path of ['/assets/kama.html','/assets/runtime-config.js','/assets/inplan-pg.js','/assets/xlsx.full.min.js'])
      assert.equal((await fetch(base+path)).status,200,path);
    for(const path of ['/server.js','/package.json','/README.md','/tests/server.test.mjs','/.env','/node_modules/express/package.json','/assets/../server.js'])
      assert.equal((await fetch(base+path)).status,404,path);
    const r=await fetch(base+'/assets/runtime-config.js');
    assert.equal(r.headers.get('cache-control'),'no-store');
    const w={};new Function('window',await r.text())(w);
    assert.equal(w.KAMA_CONFIG.pg.ssl,'strict');
    assert.equal('password' in w.KAMA_CONFIG.pg,false);
  });
});

test('KAMA: ссылки в kama.html относительные и лежат рядом с файлом (GitHub Pages /<repo>/)',async()=>{
  const html=readFileSync(new URL('../assets/kama.html',import.meta.url),'utf8');
  // Корневой путь /assets/… на Pages разрешился бы в https://<user>.github.io/assets/… — 404.
  assert.equal(/(?:href|src)="\/[^/"]/.test(html),false,'в kama.html остались корневые ссылки вида /assets/…');
  const refs=[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1]).filter(r=>!r.startsWith('#')&&!r.startsWith('//')&&!/^[a-z]+:/i.test(r));
  assert.ok(refs.length>=5,`ожидали не менее 5 относительных ссылок, получили ${refs.length}`);
  for(const ref of refs) assert.ok(existsSync(new URL(`../assets/${ref}`,import.meta.url)),`рядом с kama.html нет файла для ссылки ${ref}`);
});

test('KAMA: same-origin API works, foreign origin and preflight are rejected',async()=>{
  await withServer(async base=>{
    assert.equal((await fetch(base+'/api/health',{headers:{Origin:base}})).status,200);
    for(const method of ['GET','OPTIONS']){
      const r=await fetch(base+'/api/health',{method,headers:{Origin:'https://foreign.example'}});
      assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
    }
  });
});

test('KAMA: configured external origin is allowed without wildcard',async()=>{
  const old=process.env.CORS_ORIGINS;process.env.CORS_ORIGINS='https://kama.example';
  try { await withServer(async base=>{
    const r=await fetch(base+'/api/health',{method:'OPTIONS',headers:{Origin:'https://kama.example'}});
    assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://kama.example');
  }); } finally { if(old===undefined)delete process.env.CORS_ORIGINS;else process.env.CORS_ORIGINS=old; }
});

test('KAMA: denied PostgreSQL target and insecure TLS never reach connection layer',async()=>{
  let calls=0;
  await withServer(async base=>{
    for(const overrides of [{host:'other.test'},{port:5433},{ssl:'off'},{ssl:'insecure'}]){
      const r=await post(base+'/api/pg/schemas',{...conn,...overrides});assert.equal(r.status,403);
    }
    assert.equal(calls,0);
    const r=await post(base+'/api/pg/schemas',conn);assert.equal(r.status,200);assert.equal(calls,1);
  },{allowedTargets:['pg.test:5432'],connect:async()=>{calls++;return {query:async()=>({rows:[]}),close:async()=>{}};}});
});

test('KAMA: legacy auto TLS verifies certificates and never retries without TLS',async()=>{
  const original=pg.Client.prototype.connect;const options=[];
  pg.Client.prototype.connect=async function(){options.push(this.connectionParameters.ssl);throw Error('SSL certificate rejected');};
  try{
    await assert.rejects(srv.defaultConnect({...conn,ssl:'auto'}),/SSL certificate rejected/);
    assert.deepEqual(options,[{rejectUnauthorized:true}]);
  }finally{pg.Client.prototype.connect=original;}
});

test('KAMA: PostgreSQL environment overrides defaults and metadata database',()=>{
  const out=execFileSync(process.execPath,['-e',"const s=require('./server'); console.log(JSON.stringify([s.PG_DEFAULTS,s.SCENARIO_DATABASE]))"],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,PGHOST:'kama-db',PGPORT:'6543',PGDATABASE:'kama_data',PG_METADATA_DATABASE:'kama_metadata'}});
  assert.deepEqual(JSON.parse(out),[{host:'kama-db',port:6543,database:'kama_data'},'kama_metadata']);
});

for(const [module,key,passwordField] of [['pg','PGX','password'],['ch','CHX','pass']]){
  test(`KAMA: ${module} credentials use tab storage, old persistent credentials are erased`,()=>{
    const dom=new JSDOM('<html></html>',{url:'http://localhost:8080',runScripts:'outside-only'});
    const w=dom.window,sessionKey=`inplan_${module}_session_v1`;
    try{
      w.localStorage.setItem(sessionKey,JSON.stringify({cfg:{password:'legacy'}}));
      w.KAMA_CONFIG={[module]:{host:'configured.example'}};
      w.bn=w.pc=w.nf=String;
      w.eval(readFileSync(new URL(`../assets/inplan-${module}.js`,import.meta.url),'utf8'));
      const api=w[key];assert.equal(api.cfg.host,'configured.example');
      assert.equal(w.localStorage.getItem(sessionKey),null);
      api.cfg[passwordField]='temporary-secret';api.session.save();
      assert.equal(JSON.parse(w.sessionStorage.getItem(sessionKey)).cfg[passwordField],'temporary-secret');
      assert.equal(w.localStorage.getItem(sessionKey),null);
      const record=JSON.parse(w.sessionStorage.getItem(sessionKey));record.expiresAt=Date.now()-1;
      w.sessionStorage.setItem(sessionKey,JSON.stringify(record));assert.equal(api.session.read(),null);
      api.session.save();api.session.clear();assert.equal(w.sessionStorage.getItem(sessionKey),null);
    }finally{w.close();}
  });
}
