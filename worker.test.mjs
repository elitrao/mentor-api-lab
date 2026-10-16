import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import worker,{proxyRequest} from './worker.mjs';
import {assets} from './scripts/build.mjs';

const origin='https://mentor-api-lab.example';
const key='iqm_'+'b'.repeat(64);
function request(action,body,extra=''){
 const headers={Origin:origin,'x-api-key':key};
 if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
 return new Request(origin+'/api/request?environment=test&action='+action+extra,{method:'POST',headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
}
test('Cloudflare asset directory contains only browser files, not node_modules or server sources',async()=>{
 const config=JSON.parse(await readFile(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.assets.directory,'./dist');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.main,'worker.mjs');
 assert.equal(config.build.command,'node scripts/build.mjs');
 assert.deepEqual((await readdir(new URL('./dist/',import.meta.url))).sort(),[...assets].sort());
 for(const name of assets)assert.ok((await stat(new URL('./dist/'+name,import.meta.url))).size<25*1024*1024);
});
test('Worker serves browser assets with security headers',async()=>{
 let fetched=false;const res=await worker.fetch(new Request(origin+'/'),{ASSETS:{fetch:async()=>{fetched=true;return new Response('interface');}}});
 assert.equal(await res.text(),'interface');assert.equal(fetched,true);assert.match(res.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
test('Worker forwards valid key check and preserves upstream HTTP errors',async()=>{
 const res=await proxyRequest(request('verify'),async(url,options)=>{assert.equal(url,'https://test.mentor.iqgroup.ai/api/external/key/verify');assert.equal(options.headers['x-api-key'],key);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return new Response('{"message":"test"}',{status:401});});
 const data=await res.json();assert.equal(data.status,401);assert.equal(data.upstream,true);assert.ok(!JSON.stringify(data).includes(key));assert.equal(res.headers.get('Cache-Control'),'no-store');
});
test('Worker blocks foreign origin, unknown destination and API fallback to static assets',async()=>{
 let calls=0;const noFetch=()=>{calls++;throw new Error('Must not fetch');};
 const req=request('verify');req.headers.set('Origin','https://elsewhere.example');assert.equal((await proxyRequest(req,noFetch)).status,403);
 const unknown=new Request(origin+'/api/request?environment=__proto__&action=verify',{method:'POST',headers:{Origin:origin,'x-api-key':key}});assert.equal((await proxyRequest(unknown,noFetch)).status,400);
 const missing=await worker.fetch(new Request(origin+'/api/unknown'),{ASSETS:{fetch:noFetch}});assert.equal(missing.status,404);assert.equal(calls,0);
});
test('Worker streams binary multipart without replacing the boundary or filename',async()=>{
 const form=new FormData();const bytes=new Uint8Array([0,255,128,65,0]);form.append('file',new Blob([bytes],{type:'audio/mpeg'}),'Звонок.mp3');
 const req=request('upload',form,'&accountId=11111111-1111-4111-8111-111111111111');
 const ct=req.headers.get('Content-Type');
 const response=await proxyRequest(req,async(url,options)=>{
  assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],ct);assert.ok(options.body instanceof ReadableStream);
  const parsed=await new Response(options.body,{headers:{'Content-Type':ct}}).formData();const file=parsed.get('file');assert.equal(file.name,'Звонок.mp3');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
  return new Response('{"call":{"id":"test"}}',{status:201});
 });assert.equal((await response.json()).status,201);
});
test('Worker sends JSON employee and report creation, and repeated report filters',async()=>{
 const bodies=[['create',{firstName:'Иван',lastName:'Тестовый'},'/api/external/account'],['reportGenerate',{authorAccountId:'11111111-1111-4111-8111-111111111111',periodStart:'2026-10-01',periodEnd:'2026-10-16'},'/api/external/category-report/generate']];
 for(const [action,body,path] of bodies){const res=await proxyRequest(request(action,body),async(url,options)=>{assert.equal(new URL(url).pathname,path);assert.deepEqual(JSON.parse(options.body),body);return new Response('{}',{status:201});});assert.equal((await res.json()).status,201);}
 await proxyRequest(request('reportList',undefined,'&categoryIds=a&categoryIds=b&page=1&pageSize=10'),async(url,options)=>{assert.deepEqual(new URL(url).searchParams.getAll('categoryIds'),['a','b']);assert.equal(options.body,undefined);return new Response('{"reports":[]}');});
});
test('Worker rejects oversized JSON and returns actionable network errors',async()=>{
 let calls=0;const tooBig=await proxyRequest(request('create',{firstName:'a'.repeat(17000),lastName:'test'}),()=>{calls++;});assert.equal(tooBig.status,400);assert.equal(calls,0);
 const response=await proxyRequest(request('verify'),async()=>{throw new TypeError('Sensitive details must not be echoed');});const data=await response.json();assert.equal(response.status,502);assert.equal(data.upstream,false);assert.ok(!JSON.stringify(data).includes('Sensitive details'));
});
