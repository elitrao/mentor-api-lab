const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function reportRequest(action,params,data){
  const prefix='/api/external/category-report';
  if(action==='reportGenerate'){
    const allowed=['authorAccountId','periodStart','periodEnd','categoryIds','accountIds','minDurationMilliseconds','maxDurationMilliseconds'];
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))throw new Error('Недопустимый JSON отчёта');
    if(typeof data.authorAccountId!=='string'||!UUID.test(data.authorAccountId))throw new Error('authorAccountId должен быть UUID менеджера интеграции');
    if(!date(data.periodStart)||!date(data.periodEnd)||data.periodStart>data.periodEnd)throw new Error('Укажите корректный период звонков: начало не позже конца');
    for(const k of ['categoryIds','accountIds'])if(data[k]!==undefined&&(!Array.isArray(data[k])||data[k].some(v=>typeof v!=='string'||!v.trim())))throw new Error(k+': ожидается массив непустых строк');
    for(const k of ['minDurationMilliseconds','maxDurationMilliseconds'])if(data[k]!==undefined&&(typeof data[k]!=='number'||!Number.isFinite(data[k])||data[k]<0))throw new Error(k+': ожидается неотрицательное число');
    if(data.minDurationMilliseconds!==undefined&&data.maxDurationMilliseconds!==undefined&&data.minDurationMilliseconds>data.maxDurationMilliseconds)throw new Error('Минимальная длительность больше максимальной');
    return {path:prefix+'/generate',method:'POST',body:JSON.stringify(data)};
  }
  const query=new URLSearchParams();
  for(const k of ['page','pageSize'])if(params.has(k)){const n=params.get(k);if(!/^\d+$/.test(n)||!Number.isSafeInteger(Number(n))||Number(n)<1)throw new Error(k+': ожидается положительное целое число');query.set(k,n);}
  for(const k of ['categoryIds','accountIds'])for(const v of params.getAll(k)){if(!v.trim())throw new Error(k+': пустой идентификатор');query.append(k,v);}
  const sorts=action==='reportList'?['createdAt','name']:['category','percentage'];
  for(const [k,values] of [['sortBy',sorts],['sortOrder',['ASC','DESC']]])if(params.has(k)){if(!values.includes(params.get(k)))throw new Error('Недопустимый '+k);query.set(k,params.get(k));}
  let path=prefix;
  if(action==='reportList'){
    path+='/list';
    for(const k of ['start','end'])if(params.has(k)){if(!date(params.get(k)))throw new Error('Некорректная дата '+k);query.set(k,params.get(k));}
    if(query.has('start')&&query.has('end')&&query.get('start')>query.get('end'))throw new Error('Начало периода позже конца');
    if(params.has('mode')){if(!['auto','manual'].includes(params.get('mode')))throw new Error('Недопустимый mode');query.set('mode',params.get('mode'));}
  } else if(action==='reportGet'){
    if(!UUID.test(params.get('reportId')||''))throw new Error('reportId должен быть UUID');
    path+='/'+params.get('reportId');
  } else throw new Error('Неизвестная операция отчёта');
  return {path:path+(query.size?'?'+query:''),method:'GET'};
}
