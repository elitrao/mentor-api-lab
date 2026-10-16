import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Transform } from 'node:stream';
import { reportRequest } from './report-api.mjs';

const ROOT = new URL('./', import.meta.url);
const HOSTS = { test: 'https://test.mentor.iqgroup.ai', production: 'https://mentor.iqgroup.ai' };
const MAX = 100 * 1024 * 1024 + 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function json(res, status, body) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); }
async function readJson(req) { let body=''; for await (const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>16384) throw new Error('Слишком большой JSON'); } return JSON.parse(body); }

export function createServer(fetchImpl = fetch) {
  return http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host || '';
    if(!/^127\.0\.0\.1:\d+$/.test(host)) return json(res,403,{error:'Используйте адрес 127.0.0.1'});
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && ['/', '/app.js', '/reports.js', '/style.css', '/favicon.svg'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const type = file.endsWith('html')?'text/html':file.endsWith('js')?'text/javascript':file.endsWith('svg')?'image/svg+xml':'text/css';
      res.writeHead(200, {'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});
      return res.end(await readFile(new URL(file,ROOT)));
    }
    if(req.method !== 'POST' || url.pathname !== '/api/request') return json(res,404,{error:'Маршрут не найден'});
    if(req.headers.origin !== `http://${host}`) return json(res,403,{error:'Запрос разрешён только с локальной страницы'});
    const base = HOSTS[url.searchParams.get('environment')];
    const action = url.searchParams.get('action');
    const key = req.headers['x-api-key'];
    if(!base) return json(res,400,{error:'Неизвестное окружение'});
    if(typeof key!=='string' || !/^iqm_[a-f0-9]{64}$/i.test(key)) return json(res,400,{error:'Ключ должен иметь формат iqm_ и 64 шестнадцатеричных символа'});
    let path, method='GET', body;
    const headers={'x-api-key':key};
    try {
      if(action==='verify') path='/api/external/key/verify';
      else if(action==='list') path='/api/external/account/list';
      else if(['reportGenerate','reportList','reportGet'].includes(action)) {
        const report=reportRequest(action,url.searchParams,action==='reportGenerate'?await readJson(req):undefined);
        ({path,method,body}=report);
        if(body)headers['Content-Type']='application/json; charset=utf-8';
      }
      else if(action==='create') {
        path='/api/external/account'; method='POST';
        const data=await readJson(req);
        if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Ожидается JSON-объект');
        if(!['firstName','lastName'].every(k=>typeof data[k]==='string' && data[k].trim())) throw new Error('Укажите имя и фамилию');
        if(Object.keys(data).some(k=>!['firstName','lastName','middleName','email','phoneNumber'].includes(k) || typeof data[k]!=='string')) throw new Error('Недопустимое поле сотрудника');
        body=JSON.stringify(data); headers['Content-Type']='application/json; charset=utf-8';
      } else if(action==='upload') {
        method='POST';
        const accountId=url.searchParams.get('accountId') || '';
        if(!UUID.test(accountId)) throw new Error('accountId должен быть UUID');
        const query=new URLSearchParams({accountId});
        const callName=url.searchParams.get('callName');
        const speaker=url.searchParams.get('stereoLeftSpeaker');
        if(callName) query.set('callName',callName);
        if(speaker) { if(!['manager','client','unknown'].includes(speaker)) throw new Error('Недопустимое значение stereoLeftSpeaker'); query.set('stereoLeftSpeaker',speaker); }
        const ct=req.headers['content-type'] || '';
        if(!/^multipart\/form-data;\s*boundary=/.test(ct)) throw new Error('Ожидается multipart/form-data с boundary');
        if(Number(req.headers['content-length'])>MAX) return json(res,413,{error:'Файл превышает 100 МБ'});
        path='/api/external/call?'+query;
        headers['Content-Type']=ct;
        let bytes=0;
        const limiter=new Transform({transform(chunk,enc,callback){bytes+=chunk.length; callback(bytes>MAX?new Error('Файл превышает 100 МБ'):null,chunk);}});
        req.on('error',error=>limiter.destroy(error));
        body=req.pipe(limiter);
      } else throw new Error('Неизвестная операция');
    } catch(error) { return json(res,400,{error:error.message}); }
    const started=Date.now();
    try {
      const response=await fetchImpl(base+path,{method,headers,body,duplex:body?'half':undefined,redirect:'manual',signal:AbortSignal.timeout(180000)});
      const raw=await response.text();
      return json(res,200,{upstream:true,status:response.status,statusText:response.statusText,elapsedMs:Date.now()-started,url:base+path,headers:Object.fromEntries([...response.headers].filter(([k])=>['content-type','date','x-request-id','x-correlation-id','retry-after'].includes(k))),body:raw});
    } catch(error) {
      return json(res,502,{upstream:false,error:'Не удалось получить ответ от Mentor. Для POST результат неизвестен; проверьте кабинет перед повтором.',detail:error.name,elapsedMs:Date.now()-started});
    }
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.MENTOR_LAB_PORT || 4318);
  const server=createServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Порт ${port} занят. Откройте http://127.0.0.1:${port} или задайте MENTOR_LAB_PORT.`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Mentor API Lab: http://127.0.0.1:${port}`));
}
