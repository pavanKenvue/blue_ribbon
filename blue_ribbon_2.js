let fields=[];
const FIELDS_JSON_URL='https://<your-bucket>.s3.<region>.amazonaws.com/blue_ribbon_2_fields.json';

const ignored=new Set(['','ALL','[ALL]','ALL_VALUE','ALL_VALUES','SELECT ALL','NULL','UNDEFINED']);
const count=document.getElementById('count');
const box=document.getElementById('filters');
const ribbonEl=document.querySelector('.ribbon');
const LAMBDA_URL='https://bep7q0n4nk.execute-api.us-east-1.amazonaws.com/default/argus-cpd-lambda';
const TRUSTED_REPLY_ORIGINS=['https://filtersparam.s3.us-east-1.amazonaws.com','https://dq8qzubrypnsg.cloudfront.net',location.origin,'null'];

let dynamicParamNamesBySource={};
let _lastLiveParamMap=null;
let _reqSeq=0;
let _gotLiveResponseOnce=false;

function normalizeValues(raw){
 return [...new Set(
   [].concat(raw||[])
     .flatMap(function(v){ return String(v).split(/[|,]/); })
     .map(function(v){ return v.trim(); })
     .filter(function(v){ return !ignored.has(v.toUpperCase())&&!v.includes('<<'); })
 )];
}

async function loadDynamicParamNames(){
 try{
  const res=await fetch(`${LAMBDA_URL}/columns`);
  const data=await res.json();
  const full=data.paramMapFull||{};
  const next={};
  (data.columns||[]).forEach(function(col){
   const params=full[col]||(data.paramMap&&data.paramMap[col]?[data.paramMap[col]]:[]);
   if(params.length) next[col]=params;
  });
  dynamicParamNamesBySource=next;
  console.log('[blue_ribbon] loaded',Object.keys(dynamicParamNamesBySource).length,'real column→parameter mapping(s) from',`${LAMBDA_URL}/columns`,'— overriding the hardcoded `param` names in `fields` for those columns:',dynamicParamNamesBySource);
  if(_lastLiveParamMap) render(_lastLiveParamMap);
 }catch(e){
  console.warn('[blue_ribbon] failed to load column→parameter mapping from Lambda — falling back to the hardcoded `param` names in `fields` only:',e.message);
 }
}

const LOCAL_FIELDS_JSON_URL='./blue_ribbon_2_fields.json';

async function fetchFieldsList(url){
 const res=await fetch(url);
 const data=await res.json();
 if(!Array.isArray(data)||!data.length) throw new Error('fields list was empty or not an array');
 return data;
}

async function loadFieldsFromS3(){
 try{
  fields=await fetchFieldsList(FIELDS_JSON_URL);
  console.log('[blue_ribbon] loaded',fields.length,'field definition(s) from S3:',FIELDS_JSON_URL);
 }catch(e){
  console.warn('[blue_ribbon] failed to load fields list from S3 — falling back to the local JSON file:',e.message);
  try{
   fields=await fetchFieldsList(LOCAL_FIELDS_JSON_URL);
   console.log('[blue_ribbon] loaded',fields.length,'field definition(s) from local file:',LOCAL_FIELDS_JSON_URL);
  }catch(e2){
   console.warn('[blue_ribbon] failed to load fields list from the local JSON file too — no fields are defined, so no filters can be shown:',e2.message);
  }
 }
 if(_lastRenderedParamMap) render(_lastRenderedParamMap);
}

function buildValueEl(f){
 const extra=f.values.length-1;
 const value=document.createElement('div');value.className='chip-value';
 const valueText=document.createElement('span');valueText.className='chip-value-text';valueText.textContent=f.values[0];
 value.append(valueText);
 if(extra>0){
  const more=document.createElement('span');more.className='chip-value-more';more.textContent=`+${extra}`;
  value.append(more);
  value.dataset.tooltip=f.values.slice(1).join(', ');
 }
 return value;
}

function buildChip(f){
 const chip=document.createElement('div');chip.className='chip';

 const head=document.createElement('div');head.className='chip-head';
 const label=document.createElement('b');label.className='chip-label';label.textContent=f.label;
 head.append(label);

 chip.append(head,buildValueEl(f));
 return chip;
}

let _lastRenderedParamMap=null;
let showAllColumns=false;

function render(paramMap){
 _lastRenderedParamMap=paramMap;
 const out=[];
 for(const [source,param,label] of fields){
  const dynamicNames=dynamicParamNamesBySource[source]||[];
  const raw=[...(paramMap[source]||[]),...(paramMap[param]||[]),...dynamicNames.flatMap(function(p){ return paramMap[p]||[]; })];
  const values=normalizeValues(raw);
  if(values.length) out.push({label,values});
 }
 count.innerHTML=`<span class="count-text"><b class="count-number">${out.length}</b> applied filter(s)</span>`;
 box.replaceChildren();
 box.classList.toggle('expanded',showAllColumns);
 if(!out.length){box.innerHTML='<div class="empty">No filters applied.</div>';return}

 const chipEls=out.map(buildChip);
 chipEls.forEach(function(el){ box.append(el); });

 if(showAllColumns){
  appendMoreBox(null);
 }else{
  trimOverflow(chipEls,out);
 }
}

function trimOverflow(chipEls,filtersData){
 const available=ribbonEl.clientWidth;
 let usedWidth=0;
 let visibleCount=chipEls.length;
 for(let i=0;i<chipEls.length;i++){
  usedWidth+=chipEls[i].getBoundingClientRect().width;
  if(usedWidth>available){ visibleCount=i; break; }
 }
 visibleCount=Math.max(visibleCount,1);
 if(visibleCount>=chipEls.length) return;

 for(let i=visibleCount;i<chipEls.length;i++) chipEls[i].remove();
 appendMoreBox(filtersData.length-visibleCount);
}

let moreBoxEl=null;

const EYE_ICON_SVG='<svg class="more-box-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

function appendMoreBox(hiddenCount){
 moreBoxEl=document.createElement('div');
 moreBoxEl.className='more-box';

 const btn=document.createElement('button');
 btn.type='button';
 btn.className='more-box-toggle';
 btn.setAttribute('aria-label',showAllColumns?'Collapse columns':'View all columns');
 const countLabel=hiddenCount!=null?`<span>+${hiddenCount} Column${hiddenCount===1?'':'s'}</span>`:'';
 btn.innerHTML=EYE_ICON_SVG+countLabel;
 btn.addEventListener('click',function(e){
  e.stopPropagation();
  showAllColumns=!showAllColumns;
  if(_lastRenderedParamMap) render(_lastRenderedParamMap);
 });

 moreBoxEl.append(btn);
 count.append(moreBoxEl);
}

function paramMapFromUrl(){
 const q=new URLSearchParams(location.search);
 const map={};
 fields.forEach(function([source,param]){
  map[source]=q.getAll(source);
  map[param]=q.getAll(param);
 });
 return map;
}

function requestParamsFromHost(){
 const reqId='br_'+(++_reqSeq)+'_'+Date.now();
 console.log('[blue_ribbon] sending request to window.top, reqId=',reqId);
 try{ window.top.postMessage({type:'BLUE_RIBBON_REQUEST_PARAMS',reqId},'*'); }
 catch(e){ console.error('[blue_ribbon] postMessage to top failed:',e); }
}

function qsParamsToMap(params){
 const map={};
 (params||[]).forEach(function(p){
  if(!p||!p.Name) return;
  const raw=p.Value ?? p.Values ?? p.value ?? '';
  map[p.Name]=Array.isArray(raw)?raw:String(raw).split(',').map(function(v){ return v.trim(); }).filter(Boolean);
 });
 return map;
}

function handleParamsMessage(event){
 const msg=event.data;
 if(!msg||msg.type!=='BLUE_RIBBON_PARAMS_RESULT') return;
 if(!TRUSTED_REPLY_ORIGINS.includes(event.origin)){
  console.warn('[blue_ribbon] rejected a BLUE_RIBBON_PARAMS_RESULT from untrusted origin:',event.origin);
  return;
 }
 _gotLiveResponseOnce=true;
 if(msg.error){ console.warn('[blue_ribbon] host reported error fetching QS parameters:',msg.error); return; }
 console.log('[blue_ribbon] received',(msg.params||[]).length,'parameter(s) from index_v6.html, reqId=',msg.reqId);
 _lastLiveParamMap=qsParamsToMap(msg.params);
 render(_lastLiveParamMap);
}

let tooltipEl=null;

function ensureTooltipEl(){
 if(!tooltipEl){
  tooltipEl=document.createElement('div');
  tooltipEl.className='chip-tooltip';
  document.body.append(tooltipEl);
 }
 return tooltipEl;
}

function showTooltip(target){
 const text=target.dataset.tooltip;
 if(!text) return;
 const tip=ensureTooltipEl();
 tip.textContent=text;
 const rect=target.getBoundingClientRect();
 const tipWidth=tip.getBoundingClientRect().width;
 const tipHeight=tip.getBoundingClientRect().height;
 const margin=8;

 const left=Math.min(rect.left,window.innerWidth-tipWidth-margin);
 tip.style.left=Math.max(margin,left)+'px';

 const fitsBelow=rect.bottom+8+tipHeight<=window.innerHeight-margin;
 if(!fitsBelow&&rect.top-8-tipHeight>=margin){
  tip.style.top=(rect.top-8-tipHeight)+'px';
  tip.classList.add('flip-up');
 }else{
  tip.style.top=(rect.bottom+8)+'px';
  tip.classList.remove('flip-up');
 }
 tip.classList.add('visible');
}

function hideTooltip(){
 if(tooltipEl) tooltipEl.classList.remove('visible');
}

function initTooltipEvents(){
 box.addEventListener('mouseover',function(e){
  const target=e.target.closest('.chip-value');
  if(target) showTooltip(target);
 });
 box.addEventListener('mouseout',function(e){
  const target=e.target.closest('.chip-value');
  if(target) hideTooltip();
 });
 box.addEventListener('scroll',hideTooltip);
}

function init(){
 initTooltipEvents();
 window.addEventListener('resize',function(){ if(_lastRenderedParamMap) render(_lastRenderedParamMap); });
 loadFieldsFromS3();

 window.addEventListener('message',handleParamsMessage);

 loadDynamicParamNames();
 requestParamsFromHost();
 setInterval(requestParamsFromHost,3000);
 setInterval(loadDynamicParamNames,60000);

 setTimeout(function(){ if(!_gotLiveResponseOnce) render(paramMapFromUrl()); },2500);
}

init();
