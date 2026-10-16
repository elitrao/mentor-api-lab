const $=id=>document.getElementById(id);
let hooks,timer=null,watchEpoch=0;
const split=value=>[...new Set(value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
export const reportActions=['reportGenerate','reportList','reportGet'];
export function reportAction(){return $('reportOperation').value;}
export function reportBody(){
 const body={authorAccountId:$('authorAccountId').value.trim(),periodStart:$('periodStart').value,periodEnd:$('periodEnd').value};
 for(const k of ['categoryIds','accountIds']){const values=split($(k).value);if(values.length)body[k]=values;}
 for(const k of ['minDurationMilliseconds','maxDurationMilliseconds'])if($(k).value!=='')body[k]=Number($(k).value);
 return body;
}
export function reportDescriptor(action){
 const query=new URLSearchParams();let path='/api/external/category-report',method='GET',body;
 if(action==='reportGenerate'){path+='/generate';method='POST';body=reportBody();}
 else{
  if(action==='reportList'){path+='/list';for(const [k,id] of [['start','reportStart'],['end','reportEnd'],['mode','reportMode']])if($(id).value)query.set(k,$(id).value);}
  else{query.set('reportId',$('reportId').value.trim());path+='/'+encodeURIComponent($('reportId').value.trim()||'{reportId}');}
  for(const k of ['page','pageSize'])if($(k).value)query.set(k,$(k).value);
  for(const k of ['categoryIds','accountIds'])for(const value of split($(k).value))query.append(k,value);
  const sortBy=action==='reportList'?$('listSortBy').value:$('valueSortBy').value;
  if(sortBy)query.set('sortBy',sortBy);if($('sortOrder').value)query.set('sortOrder',$('sortOrder').value);
  const upstream=new URLSearchParams(query);upstream.delete('reportId');if(upstream.size)path+='?'+upstream;
 }
 return {path,method,query,body};
}
export function validateReport(action){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(action==='reportGenerate'){
  const b=reportBody();if(!uuid.test(b.authorAccountId))return 'Укажите UUID автора отчёта — менеджера этой интеграции.';
  if(!b.periodStart||!b.periodEnd||b.periodStart>b.periodEnd)return 'Укажите период звонков: начало не позже конца.';
  for(const k of ['minDurationMilliseconds','maxDurationMilliseconds'])if(!$(k).checkValidity()||(b[k]!==undefined&&(!Number.isFinite(b[k])||b[k]<0)))return 'Длительность должна быть неотрицательным числом миллисекунд.';
  if(b.minDurationMilliseconds!==undefined&&b.maxDurationMilliseconds!==undefined&&b.minDurationMilliseconds>b.maxDurationMilliseconds)return 'Минимальная длительность больше максимальной.';
 }else{
  if(action==='reportGet'&&!uuid.test($('reportId').value.trim()))return 'Укажите UUID отчёта.';
  if(action==='reportList'&&$('reportStart').value&&$('reportEnd').value&&$('reportStart').value>$('reportEnd').value)return 'Проверьте период создания отчётов.';
  if(!['page','pageSize'].every(k=>/^\d+$/.test($(k).value)&&Number($(k).value)>=1))return 'Страница и размер страницы должны быть положительными целыми числами.';
 }
 return '';
}
function view(){
 const action=reportAction();
 for(const [id,visible] of [['generateFields',action==='reportGenerate'],['reportListFields',action==='reportList'],['reportGetFields',action==='reportGet'],['reportPagination',action!=='reportGenerate'],['listSortField',action==='reportList'],['valueSortField',action==='reportGet']])$(id).hidden=!visible;
 $('runReport').textContent=action==='reportGenerate'?'Создать отчёт ↗':action==='reportList'?'Найти отчёты ↗':'Получить отчёт ↗';
 $('reportMethod').textContent=action==='reportGenerate'?'POST':'GET';$('reportMethod').className='method '+(action==='reportGenerate'?'post':'get');
}
export function stopReportWatch(message='Автообновление остановлено'){
 clearTimeout(timer);timer=null;watchEpoch++;
 if($('watchStatus'))$('watchStatus').textContent=message;
 if($('stopReportWatch'))$('stopReportWatch').hidden=true;
}
function schedule(id){
 if(!$('autoReport').checked)return;
 clearTimeout(timer);const epoch=watchEpoch,context=hooks.context();
 $('watchStatus').textContent='Следующая проверка через 15 секунд.';$('stopReportWatch').hidden=false;
 timer=setTimeout(async()=>{
  timer=null;if(epoch!==watchEpoch)return;
  const current=hooks.context();if(current.environment!==context.environment||current.key!==context.key||$('reportId').value.trim()!==id||!$('autoReport').checked){stopReportWatch();return;}
  if(hooks.busy()){schedule(id);return;}
  $('watchStatus').textContent='Проверяем готовность…';await hooks.send('reportGet',true);
 },15000);
}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function displayReport(report){
 $('reportSummary').replaceChildren();
 const status=report.status||'неизвестен';
 $('reportSummary').append(element('strong',report.name||'Отчёт по категориям'),element('span',status,'badge '+(status==='success'?'success':status==='failed'?'failure':'')),element('small',report.id||''));
 $('reportResult').hidden=false;
}
export function handleReportResponse(action,data){
 if(!reportActions.includes(action))return;
 let result;try{result=JSON.parse(data.body);}catch{}
 if(!data.upstream||data.status<200||data.status>=300||!result){stopReportWatch('Проверка остановлена: смотрите ответ API.');return;}
 if(action==='reportList'){
  const list=$('reportList');list.replaceChildren();$('reportResult').hidden=false;$('reportSummary').textContent='Найдено отчётов: '+(result.total??result.reports?.length??0);$('reportValues').replaceChildren();
  if(!Array.isArray(result.reports)){list.textContent='Неожиданный формат. Полный ответ показан справа.';return;}
  if(!result.reports.length)list.textContent='По этим фильтрам отчётов нет.';
  for(const r of result.reports){const row=element('div',undefined,'employee'),info=element('div'),button=element('button','Открыть ↗','textButton');info.append(element('strong',r.name||r.id),element('small',[r.status,r.mode,r.createdAt].filter(Boolean).join(' · ')),element('small',r.id));button.onclick=()=>{stopReportWatch('');$('reportId').value=r.id;$('page').value='1';$('reportOperation').value='reportGet';view();hooks.preview();hooks.send('reportGet');};row.append(info,button);list.append(row);}return;
 }
 if(!result.report?.id){stopReportWatch('В ответе отсутствует report.id.');return;}
 const report=result.report;$('reportId').value=report.id;$('reportList').replaceChildren();displayReport(report);
 const target=$('reportValues');target.replaceChildren();
 if(action==='reportGenerate'){$('reportOperation').value='reportGet';$('page').value='1';view();}
 if(Array.isArray(result.values)&&result.values.length){
  target.append(element('p',`Категорий: ${result.total??result.values.length} · страница ${$('page').value}`,'hint'));
  const table=element('table'),head=element('tr');for(const label of ['Категория','Результат','Пояснение и рекомендации'])head.append(element('th',label));const thead=element('thead');thead.append(head);table.append(thead);const tbody=element('tbody');
  for(const v of result.values){const row=element('tr'),name=element('td'),percent=element('td',v.generalPercentage===null||v.generalPercentage===undefined?'—':v.generalPercentage+'%'),details=element('td');name.append(element('strong',v.categoryName||v.categoryId),element('small',v.categoryType||''));
   if(v.generalExplanation)details.append(element('p',v.generalExplanation));if(v.generalRecommendation)details.append(element('p',v.generalRecommendation));
   for(const a of v.accounts||[]){const person=result.accounts?.find(p=>p.id===a.accountId);details.append(element('small',`${person?.name||a.accountId}: ${a.percentage===null||a.percentage===undefined?'—':a.percentage+'%'}${person?.callsCount!==undefined?' · звонков: '+person.callsCount:''}`));}
   row.append(name,percent,details);tbody.append(row);
  }table.append(tbody);target.append(table);
 }else if(report.status==='success')target.textContent='Отчёт готов. На этой странице с текущими фильтрами значений нет. Полный ответ — справа.';
 if(report.status==='success')stopReportWatch('Отчёт готов — success.');
 else if(report.status==='failed'){stopReportWatch('Не удалось построить отчёт — failed. Проверьте наличие проверенных звонков за выбранный период и фильтры.');}
 else if(report.status==='pending'){
  if($('autoReport').checked)schedule(report.id);else stopReportWatch('Отчёт строится. Нажмите «Получить отчёт» для проверки.');
 }else stopReportWatch('Статус: '+report.status+'. Проверить можно вручную.');
}
export function initReports(callbacks){
 hooks=callbacks;
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Samara',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 $('periodStart').value=localDate;$('periodEnd').value=localDate;
 $('authorAccountId').value=$('accountId').value;
 $('reportOperation').onchange=()=>{stopReportWatch('');view();hooks.preview();};
 $('runReport').onclick=()=>hooks.send(reportAction());
 $('reportLoadAccounts').onclick=()=>hooks.send('list');
 $('useSelectedAuthor').onclick=()=>{$('authorAccountId').value=$('accountId').value;hooks.preview();};
 $('stopReportWatch').onclick=()=>stopReportWatch();
 $('autoReport').onchange=()=>{if(!$('autoReport').checked)stopReportWatch();};
 $('reportsPanel').querySelectorAll('input,select').forEach(el=>{if(['reportOperation','autoReport'].includes(el.id))return;el.addEventListener('input',()=>{stopReportWatch('');hooks.preview();});});
 view();
}
