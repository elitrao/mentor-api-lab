import { reportRequest } from './report-api.mjs';

const HOSTS=new Map([['test','https://test.mentor.iqgroup.ai'],['production','https://mentor.iqgroup.ai']]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX=100*1024*1024+1024*1024;
const SECURITY={
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(status,data){return new Response(JSON.stringify(data),{status,headers:{...SECURITY,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
async function smallJson(request){
 if(!request.body)throw new Error('Ожидается JSON');
 const reader=request.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('Слишком большой JSON');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}

export async function proxyRequest(request,fetchImpl=fetch){
 const url=new URL(request.url);
 if(request.method!=='POST'||url.pathname!=='/api/request')return json(404,{error:'Маршрут не найден'});
 if(request.headers.get('Origin')!==url.origin)return json(403,{error:'Запрос разрешён только со страницы этого приложения'});
 const base=HOSTS.get(url.searchParams.get('environment')),action=url.searchParams.get('action'),key=request.headers.get('x-api-key');
 if(!base)return json(400,{error:'Неизвестное окружение'});
 if(!key||!/^iqm_[a-f0-9]{64}$/i.test(key))return json(400,{error:'Ключ должен иметь формат iqm_ и 64 шестнадцатеричных символа'});
 let path,method='GET',body;const headers={'x-api-key':key};
 try{
  if(action==='verify')path='/api/external/key/verify';
  else if(action==='list')path='/api/external/account/list';
  else if(['reportGenerate','reportList','reportGet'].includes(action)){
   ({path,method,body}=reportRequest(action,url.searchParams,action==='reportGenerate'?await smallJson(request):undefined));
   if(body)headers['Content-Type']='application/json; charset=utf-8';
  }else if(action==='create'){
   const data=await smallJson(request);
   if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Ожидается JSON-объект');
   if(!['firstName','lastName'].every(k=>typeof data[k]==='string'&&data[k].trim()))throw new Error('Укажите имя и фамилию');
   if(Object.keys(data).some(k=>!['firstName','lastName','middleName','email','phoneNumber'].includes(k)||typeof data[k]!=='string'))throw new Error('Недопустимое поле сотрудника');
   path='/api/external/account';method='POST';body=JSON.stringify(data);headers['Content-Type']='application/json; charset=utf-8';
  }else if(action==='upload'){
   const accountId=url.searchParams.get('accountId')||'';if(!UUID.test(accountId))throw new Error('accountId должен быть UUID');
   const query=new URLSearchParams({accountId});
   if(url.searchParams.get('callName'))query.set('callName',url.searchParams.get('callName'));
   const speaker=url.searchParams.get('stereoLeftSpeaker');if(speaker){if(!['manager','client','unknown'].includes(speaker))throw new Error('Недопустимый stereoLeftSpeaker');query.set('stereoLeftSpeaker',speaker);}
   const ct=request.headers.get('Content-Type')||'';if(!/^multipart\/form-data;\s*boundary=/.test(ct)||!request.body)throw new Error('Ожидается multipart/form-data с файлом и boundary');
   if(Number(request.headers.get('Content-Length'))>MAX)return json(413,{error:'Файл превышает 100 МБ'});
   let bytes=0;
   body=request.body.pipeThrough(new TransformStream({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX)throw new Error('Файл превышает 100 МБ');controller.enqueue(chunk);}}));
   path='/api/external/call?'+query;method='POST';headers['Content-Type']=ct;
  }else throw new Error('Неизвестная операция');
 }catch(error){return json(400,{error:error.message});}
 const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
 try{
  const response=await fetchImpl(base+path,{method,headers,body,redirect:'manual',signal:controller.signal});
  const raw=await response.text();
  return json(200,{upstream:true,status:response.status,statusText:response.statusText,elapsedMs:Date.now()-started,url:base+path,headers:Object.fromEntries([...response.headers].filter(([k])=>['content-type','date','x-request-id','x-correlation-id','retry-after'].includes(k))),body:raw});
 }catch(error){return json(502,{upstream:false,error:'Не удалось получить ответ от Mentor. Для POST результат неизвестен; проверьте кабинет перед повтором.',detail:error.name,elapsedMs:Date.now()-started});}
 finally{clearTimeout(timer);}
}

export default {
 async fetch(request,env){
  if(new URL(request.url).pathname.startsWith('/api/'))return proxyRequest(request);
  const asset=await env.ASSETS.fetch(request);
  const response=new Response(asset.body,asset);
  for(const [key,value] of Object.entries(SECURITY))response.headers.set(key,value);
  return response;
 }
};
