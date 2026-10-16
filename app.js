import { reportActions, reportAction, reportBody, reportDescriptor, validateReport, initReports, stopReportWatch, handleReportResponse } from './reports.js';
const $=id=>document.getElementById(id);
if(!['127.0.0.1','localhost'].includes(location.hostname)){
 document.querySelector('.local').lastChild.textContent=' Cloudflare Workers';
 document.querySelector('.version span').textContent='Веб-инструмент';
 document.querySelector('footer span').textContent='Mentor API Lab · Cloudflare';
 document.querySelectorAll('footer span')[1].textContent='Ключ и файлы передаются в Mentor через сервер этого сайта. Ключ не сохраняется в приложении.';
}
const hosts={test:'https://test.mentor.iqgroup.ai',production:'https://mentor.iqgroup.ai'};
let active='upload',busy=false,history=[],lastResponse=null,lastPreview='',accounts=[];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names={verify:'Проверка ключа',list:'Список сотрудников',create:'Создание сотрудника',upload:'Загрузка звонка',reportGenerate:'Создание отчёта',reportList:'Список отчётов',reportGet:'Получение отчёта'};
function employeeBody(){const body={}; for(const field of ['firstName','lastName','middleName','email','phoneNumber']) {const v=$(field).value.trim();if(v)body[field]=v;}return body;}
function uploadFilename(){const f=$('audio').files[0];if(!f)return 'audio.mp3';return $('asciiName').checked?'call.'+f.name.split('.').pop().toLowerCase():f.name;}
function build(action,contentType){
  if(action==='reports')action=reportAction();
  if(reportActions.includes(action)){
    const d=reportDescriptor(action),url=hosts[$('environment').value]+d.path;
    return {...d,url,preview:`${d.method} ${url}\nx-api-key: <скрыт>${d.body?'\nContent-Type: application/json; charset=utf-8':''}\n\n${d.body?JSON.stringify(d.body,null,2):'(body отсутствует)'}`};
  }
  const query=new URLSearchParams(),method=['verify','list'].includes(action)?'GET':'POST';
  let path=action==='verify'?'/api/external/key/verify':action==='list'?'/api/external/account/list':action==='create'?'/api/external/account':'/api/external/call';
  if(action==='upload'){query.set('accountId',$('accountId').value.trim());if($('callName').value.trim())query.set('callName',$('callName').value.trim());if($('speaker').value)query.set('stereoLeftSpeaker',$('speaker').value);path+='?'+query;}
  const url=hosts[$('environment').value]+path;
  let body='',headers='x-api-key: <скрыт>';
  if(action==='create'){headers+='\nContent-Type: application/json; charset=utf-8';body=JSON.stringify(employeeBody(),null,2);}
  if(action==='upload'){
    const f=$('audio').files[0],boundary=contentType?.match(/boundary=(.+)$/)?.[1] || '<boundary создаётся браузером>';
    headers+='\nContent-Type: '+(contentType||'multipart/form-data; boundary='+boundary);
    const filename=uploadFilename().replace(/[\r\n]/g,' ').replace(/"/g,'%22');
    body=`--${boundary}\nContent-Disposition: form-data; name="file"; filename="${filename}"\nContent-Type: ${f?.type||'application/octet-stream'}\n\n[${f?'Бинарное содержимое: '+f.size.toLocaleString('ru-RU')+' байт':'Файл ещё не выбран'}]\n--${boundary}--`;
  }
  return {url,method,query,preview:`${method} ${url}\n${headers}\n\n${body||'(body отсутствует)'}`};
}
function preview(action=active){lastPreview=build(action).preview;$('requestPreview').textContent=lastPreview;$('requestMode').textContent='Предпросмотр · ключ скрыт';}
function selectTab(tab){if(tab!=='reports')stopReportWatch();active=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));for(const t of ['upload','create','list','reports'])$(t+'Panel').hidden=t!==tab;$('formError').textContent='';preview();}
function showResponse(data){
 lastResponse=data;$('responseBadge').textContent=data.upstream?'HTTP '+data.status:'Локальная ошибка';$('responseBadge').className='badge '+(data.upstream&&data.status>=200&&data.status<300?'success':'failure');
 $('responseMeta').textContent=[data.elapsedMs!==undefined?data.elapsedMs+' мс':'',data.url||'',data.headers?.['x-request-id']?'Request ID: '+data.headers['x-request-id']:''].filter(Boolean).join(' · ');
 let body=data.body;try{body=JSON.stringify(JSON.parse(body),null,2);}catch{}$('responseBody').textContent=body!==undefined?(body||'(пустой ответ)'):JSON.stringify(data,null,2);
}
function renderAccounts(){
 $('accounts').replaceChildren();$('employeeList').replaceChildren();
 if(!accounts.length){$('employeeList').textContent='В этой интеграции пока нет сотрудников.';return;}
 accounts.forEach(a=>{const name=[a.lastName,a.firstName,a.middleName].filter(Boolean).join(' ')||'Без имени';const option=document.createElement('option');option.value=a.id;option.label=name;$('accounts').append(option);
 const row=document.createElement('div');row.className='employee';const info=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small'),button=document.createElement('button');strong.textContent=name;small.textContent=a.id;info.append(strong,small);button.className='textButton';button.textContent='Выбрать ↗';button.onclick=()=>{$('accountId').value=a.id;updateSelected();selectTab('upload');};row.append(info,button);$('employeeList').append(row);});updateSelected();
}
function updateSelected(){const a=accounts.find(a=>a.id===$('accountId').value.trim());$('selectedAccount').textContent=a?[a.lastName,a.firstName].filter(Boolean).join(' '):'ID менеджера, созданного этой интеграцией';}
function renderHistory(){
 $('historyList').replaceChildren();if(!history.length){$('historyList').textContent='Запросов пока нет.';return;}
 history.forEach(entry=>{const b=document.createElement('button');b.className='historyRow';const time=document.createElement('small'),title=document.createElement('span'),status=document.createElement('span'),env=document.createElement('small');time.textContent=entry.time;title.textContent=names[entry.action];status.textContent=entry.data.upstream?entry.data.status:'Ошибка';env.textContent=entry.environment==='test'?'TEST':'PROD';b.append(time,title,env,status);b.onclick=()=>{lastPreview=entry.preview;$('requestPreview').textContent=entry.preview;$('requestMode').textContent='Отправлено в '+entry.time+' · ключ скрыт';showResponse(entry.data);};$('historyList').append(b);});
}
function lock(value){busy=value;document.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);}
async function send(action,automatic=false){
 if(busy)return;$('formError').textContent='';
 const key=$('apiKey').value.trim();if(!/^iqm_[a-f0-9]{64}$/i.test(key)){$('formError').textContent='Введите API-ключ: iqm_ и 64 шестнадцатеричных символа.';$('apiKey').focus();return;}
 const environment=$('environment').value,file=$('audio').files[0];
 if(action==='upload'){
  if(!uuid.test($('accountId').value.trim())){$('formError').textContent='Укажите корректный UUID сотрудника.';return;}
  if(!file){$('formError').textContent='Выберите аудиофайл.';return;}
  if(!/\.(mp3|wav|flac|aac|ogg|opus|amr)$/i.test(file.name)||!file.size||file.size>100*1024*1024){$('formError').textContent='Нужен непустой аудиофайл поддерживаемого формата размером до 100 МБ.';return;}
 }
 const employee=employeeBody();
 if(action==='create'&&(!employee.firstName||!employee.lastName)){$('formError').textContent='Заполните имя и фамилию.';return;}
 if(action==='create'&&!$('email').checkValidity()){$('formError').textContent='Проверьте email.';return;}
 if(reportActions.includes(action)){const error=validateReport(action);if(error){$('formError').textContent=error;stopReportWatch('Проверьте параметры отчёта.');return;}}
 if(!automatic)stopReportWatch('');
 const descriptor=build(action),q=new URLSearchParams({environment,action});descriptor.query.forEach((v,k)=>q.append(k,v));
 const headers={'x-api-key':key};let body;
 if(action==='create'){headers['Content-Type']='application/json; charset=utf-8';body=JSON.stringify(employee);}
 if(action==='reportGenerate'){headers['Content-Type']='application/json; charset=utf-8';body=JSON.stringify(reportBody());}
 if(action==='upload'){body=new FormData();body.append('file',file,uploadFilename());}
 const request=new Request(location.origin+'/api/request?'+q,{method:'POST',headers,body});
 const sentPreview=build(action,request.headers.get('content-type')).preview;
 lastPreview=sentPreview;$('requestPreview').textContent=sentPreview;$('requestMode').textContent='Отправляемый запрос · ключ скрыт';
 lock(true);$('responseBadge').textContent='Отправка…';$('responseBadge').className='badge';$('responseBody').textContent='Ожидаем ответ Mentor…';$('responseMeta').textContent='Один запрос. Без автоматических повторов.';
 let data;
 try{const response=await fetch(request);data=await response.json();}catch(error){data={upstream:false,error:'Связь с сервером приложения прервана. Для POST результат неизвестен; проверьте кабинет перед повтором.',detail:error.name};}
 showResponse(data);$('requestMode').textContent='Отправленный запрос · ключ скрыт';
 history.unshift({action,environment,preview:sentPreview,data,time:new Date().toLocaleTimeString('ru-RU')});history=history.slice(0,20);renderHistory();
 if(data.upstream&&data.status>=200&&data.status<300){
  let result;try{result=JSON.parse(data.body);}catch{}
  if(action==='verify'){$('connectionStatus').textContent='Ключ действителен · '+environment+' · интеграция '+(result?.integrationId||'подтверждена');$('connectionStatus').className='connectionStatus ok';}
  if(action==='list'&&Array.isArray(result?.accounts)){accounts=result.accounts;renderAccounts();}
  if(action==='create'&&result?.account){accounts.push(result.account);$('accountId').value=result.account.id;renderAccounts();}
 }else if(action==='verify'){$('connectionStatus').textContent='Проверка ключа не пройдена — смотрите ответ сервера';$('connectionStatus').className='connectionStatus error';}
 lock(false);
 handleReportResponse(action,data);
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
for(const action of ['verify','list','create','upload'])$(action).onclick=()=>send(action);
$('loadAccounts').onclick=()=>send('list');
for(const id of ['accountId','callName','speaker','asciiName','firstName','lastName','middleName','email','phoneNumber'])$(id).addEventListener('input',()=>{if(id==='accountId')updateSelected();preview();});
$('audio').onchange=()=>{const f=$('audio').files[0];$('fileTitle').textContent=f?.name||'Выберите аудиозапись';$('fileInfo').textContent=f?(f.size/1024/1024).toFixed(2)+' МБ · '+(f.type||'тип определит сервер'):'MP3, WAV, FLAC, AAC, OGG, Opus, AMR · до 100 МБ';preview();};
$('environment').onchange=()=>{stopReportWatch('');$('authorAccountId').value='';$('reportId').value='';$('reportResult').hidden=true;accounts=[];renderAccounts();$('accountId').value='';updateSelected();$('connectionStatus').textContent='Окружение изменено. Проверьте ключ для выбранного сервера.';$('connectionStatus').className='connectionStatus';$('docsLink').href=hosts[$('environment').value]+'/api/integration/docs';preview();};
$('apiKey').oninput=()=>{stopReportWatch('');$('connectionStatus').textContent='Ключ не проверен';$('connectionStatus').className='connectionStatus';accounts=[];$('accounts').replaceChildren();$('employeeList').textContent='Список ещё не загружен.';};
async function copy(text,button){try{await navigator.clipboard.writeText(text);const previous=button.textContent;button.textContent='Скопировано';setTimeout(()=>button.textContent=previous,1500);}catch{$('formError').textContent='Копирование недоступно. Выделите текст запроса или ответа вручную.';}}
$('copyRequest').onclick=()=>copy(lastPreview,$('copyRequest'));
$('copyResponse').onclick=()=>copy($('responseBody').textContent,$('copyResponse'));
$('downloadResponse').onclick=()=>{if(!lastResponse)return;const blob=new Blob([JSON.stringify(lastResponse,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mentor-response.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('clearHistory').onclick=()=>{history=[];renderHistory();};
initReports({send,preview:()=>preview('reports'),context:()=>({environment:$('environment').value,key:$('apiKey').value.trim()}),busy:()=>busy});
preview();
