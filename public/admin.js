const $=id=>document.getElementById(id);
let packageData={technicalTrains:[],taxis:[],rosterIndex:[]};
let pdfSummary=null;
let unresolved=[];

const DAY_RE=/^(LU|MA|ME|JE|VE|SA|DI)$/;
const JS_RE=/^[A-Z]\d{3}$/;
const TECH_RE=/^[679]\d{5}$/;
const STATIONS=new Set(['LE','LSA','LNS','ARR','SPT','BET','HZK','DO','DON','HBE','AON','AS','ETA','CS','DKQ','STO','SQ','CAM','VS','LEQ','EM','HAU','RDF','SCN']);

function headers(){return {"Content-Type":"application/json","X-Admin-Password":$("pwd").value};}
function status(msg){$("status").textContent=msg;}
function counts(){
  $("jsCount").textContent=`JS : ${pdfSummary?.js?.length||0}`;
  $("trainCount").textContent=`Trains 6 chiffres : ${pdfSummary?.trains?.length||0}`;
  $("techCount").textContent=`W/EVO importables : ${packageData.technicalTrains.length}`;
  $("taxiCount").textContent=`TAXI : ${packageData.taxis.length}`;
  $("unresolvedCount").textContent=`À vérifier : ${unresolved.length}`;
}
function frDateToIso(s){const m=String(s||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function uniq(a){return [...new Set(a)];}
function norm(s){return String(s||'').trim().replace(/\s+/g,' ');}
function yNorm(item,height){return Math.max(0,Math.min(1,1-(Number(item.y)||0)/height));}
function nearest(arr,target,scoreFn,max=Infinity){let best=null,score=max;for(const x of arr){const s=scoreFn(x,target);if(s<score){score=s;best=x;}}return best;}
function stationToken(s){
  const t=norm(s).toUpperCase().replace(/[.]/g,'');
  if(t==='LE RT'||t==='LERT'||t==='LE-RT')return 'LE-RT';
  if(t==='LNS DT'||t==='LNS-DT')return 'LNS-DT';
  if(t==='LNS TR'||t==='LNS-TR')return 'LNS-TR';
  if(t==='LNS BV'||t==='LNS-BV')return 'LNS';
  if(STATIONS.has(t))return t;
  return null;
}
function itemPoint(i){return {x:Number(i.transform?.[4]||0),y:Number(i.transform?.[5]||0),w:Number(i.width||0),h:Number(i.height||0),str:norm(i.str)};}
function localStationItems(items,train,dx=180,dy=75){
  const out=[];
  for(const i of items){const code=stationToken(i.str);if(!code)continue;if(Math.abs(i.y-train.y)<=dy&&Math.abs(i.x-train.x)<=dx)out.push({...i,code});}
  // Recompose LE + RT when PDF.js split the label into two nearby tokens.
  for(const le of items.filter(i=>norm(i.str).toUpperCase()==='LE')){
    const rt=nearest(items.filter(i=>norm(i.str).toUpperCase()==='RT'),le,(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),35);
    if(rt&&Math.abs(le.y-train.y)<=dy&&Math.abs(le.x-train.x)<=dx)out.push({...le,code:'LE-RT',y:(le.y+rt.y)/2});
  }
  return out;
}
function inferRoute(items,train,num){
  const local=localStationItems(items,train);
  const prefix=String(num)[0];
  if(prefix==='6'){
    const le=nearest(local.filter(x=>x.code==='LE'),train,(a,b)=>Math.abs(a.y-b.y)+Math.abs(a.x-b.x)*.25,120);
    const rt=nearest(local.filter(x=>x.code==='LE-RT'),train,(a,b)=>Math.abs(a.y-b.y)+Math.abs(a.x-b.x)*.25,120);
    if(le&&rt&&Math.abs(le.y-rt.y)>1){return le.y>rt.y?['LE','LE-RT']:['LE-RT','LE'];}
    return null;
  }
  if(prefix==='9'){
    const le=nearest(local.filter(x=>x.code==='LE'),train,(a,b)=>Math.abs(a.y-b.y)+Math.abs(a.x-b.x)*.25,120);
    const lsa=nearest(local.filter(x=>x.code==='LSA'),train,(a,b)=>Math.abs(a.y-b.y)+Math.abs(a.x-b.x)*.25,120);
    if(le&&lsa&&Math.abs(le.y-lsa.y)>1){return le.y>lsa.y?['LE','LSA']:['LSA','LE'];}
    return null;
  }
  // W : deux libellés de gare les plus proches autour de la circulation, lus haut -> bas.
  const plausible=local.filter(x=>!['LE-RT'].includes(x.code)||true).sort((a,b)=>{
    const da=Math.abs(a.y-train.y)+Math.abs(a.x-train.x)*.2,db=Math.abs(b.y-train.y)+Math.abs(b.x-train.x)*.2;return da-db;
  });
  const chosen=[];for(const p of plausible){if(!chosen.some(x=>x.code===p.code&&Math.abs(x.y-p.y)<5))chosen.push(p);if(chosen.length===2)break;}
  if(chosen.length<2)return null;
  chosen.sort((a,b)=>b.y-a.y);
  return [chosen[0].code,chosen[1].code];
}
function findHourCalibration(items,train){
  const nums=items.filter(i=>/^([0-9]|1[0-9]|2[0-3])$/.test(i.str)&&Math.abs(i.y-train.y)<85);
  const byBand=new Map();
  for(const i of nums){const k=Math.round(i.y/5)*5;if(!byBand.has(k))byBand.set(k,[]);byBand.get(k).push(i);}
  let best=null;
  for(const band of byBand.values()){
    const arr=band.map(i=>({...i,h:Number(i.str)})).sort((a,b)=>a.x-b.x);
    const clean=[];let last=-1;for(const a of arr){if(a.h>last){clean.push(a);last=a.h;}}
    if(clean.length<8)continue;
    const n=clean.length,sx=clean.reduce((s,a)=>s+a.x,0),sy=clean.reduce((s,a)=>s+a.h,0),sxx=clean.reduce((s,a)=>s+a.x*a.x,0),sxy=clean.reduce((s,a)=>s+a.x*a.h,0);
    const den=n*sxx-sx*sx;if(!den)continue;const slope=(n*sxy-sx*sy)/den,inter=(sy-slope*sx)/n;
    if(slope<=0)continue;
    const score=Math.abs(clean[0].y-train.y)-clean.length*3;
    if(!best||score<best.score)best={slope,inter,score};
  }
  return best;
}
function inferTimes(items,train){
  const cal=findHourCalibration(items,train);if(!cal)return null;
  const hourAt=x=>cal.slope*x+cal.inter;
  const center=Math.round(hourAt(train.x)*60);
  const mins=items.filter(i=>/^\d{1,2}$/.test(i.str)&&Number(i.str)<60&&Math.abs(i.y-train.y)<18&&Math.abs(i.x-train.x)<85);
  function absolute(i){const h=Math.floor(hourAt(i.x)+0.12);return h*60+Number(i.str);}
  const left=mins.filter(i=>i.x<train.x).sort((a,b)=>b.x-a.x)[0];
  const right=mins.filter(i=>i.x>train.x).sort((a,b)=>a.x-b.x)[0];
  let dep=left?absolute(left):center-5,arr=right?absolute(right):center+5;
  if(arr<dep)arr+=60;
  if(dep<0||dep>1500||arr<0||arr>1560||arr-dep>120)return null;
  return [Math.round(dep),Math.round(arr)];
}
function inferDays(items,train){
  const days=uniq(items.filter(i=>DAY_RE.test(i.str)&&Math.abs(i.y-train.y)<38).map(i=>i.str));
  return days.length?days:null;
}
function nearestJs(jsItems,train){return nearest(jsItems,train,(a,b)=>Math.abs(a.y-b.y)+Math.abs(a.x-b.x)*.05,160);}
function inferTaxiRoute(items,taxi){
  const local=localStationItems(items,taxi,220,85).sort((a,b)=>Math.abs(a.y-taxi.y)-Math.abs(b.y-taxi.y));
  const chosen=[];for(const p of local){if(!chosen.some(x=>x.code===p.code&&Math.abs(x.y-p.y)<5))chosen.push(p);if(chosen.length===2)break;}
  if(chosen.length<2)return null;chosen.sort((a,b)=>b.y-a.y);return [chosen[0].code,chosen[1].code];
}

async function loadPeriods(){
  status("Chargement…");
  const r=await fetch("/api/admin/rosters",{headers:{"X-Admin-Password":$("pwd").value}});const data=await r.json();
  if(!r.ok){status(data.error||"Erreur");return;}const host=$("periods");host.innerHTML="";
  if(!data.length){host.textContent="Aucune période enregistrée.";status("Aucune période.");return;}
  for(const p of data){const d=document.createElement("div");d.className="period";d.innerHTML=`<strong>${p.label}</strong> <span class="muted">(${p.id})</span><br><span class="muted">${p.validFrom} → ${p.validTo}</span><div class="counts"><span class="pill">W/EVO : ${p.counts.technicalTrains}</span><span class="pill">Taxis : ${p.counts.taxis}</span><span class="pill">Index : ${p.counts.rosterIndex}</span></div><p><button class="danger" data-del="${p.id}">Supprimer</button></p>`;host.appendChild(d);}
  host.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm(`Supprimer ${b.dataset.del} ?`))return;const r=await fetch(`/api/admin/rosters/${encodeURIComponent(b.dataset.del)}`,{method:"DELETE",headers:{"X-Admin-Password":$("pwd").value}});const j=await r.json();status(r.ok?"Période supprimée.":(j.error||"Erreur"));if(r.ok)loadPeriods();});
  status(`${data.length} période(s) chargée(s).`);
}

$("jsonfile").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());packageData={technicalTrains:Array.isArray(j.technicalTrains)?j.technicalTrains:[],taxis:Array.isArray(j.taxis)?j.taxis:[],rosterIndex:Array.isArray(j.rosterIndex)?j.rosterIndex:[]};unresolved=Array.isArray(j.unresolved)?j.unresolved:[];$("preview").value=JSON.stringify({...j,technicalTrains:packageData.technicalTrains,taxis:packageData.taxis,rosterIndex:packageData.rosterIndex},null,2);counts();status("Package JSON chargé.");}catch(err){status("JSON invalide : "+err.message);}});

$("analyze").onclick=async()=>{
  const f=$("pdffile").files[0];if(!f){status("Choisis d'abord un PDF.");return;}status("Analyse complète du PDF…");
  try{
    const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
    const doc=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
    const jsSet=new Set(),trainSet=new Set();const tech=[],taxis=[],index=[],bad=[];let allText='';
    for(let n=1;n<=doc.numPages;n++){
      status(`Analyse du PDF… page ${n}/${doc.numPages}`);
      const page=await doc.getPage(n),tc=await page.getTextContent(),items=tc.items.map(itemPoint).filter(i=>i.str),height=Number(page.view?.[3]||842);
      allText+=' '+items.map(i=>i.str).join(' ');
      const jsItems=items.filter(i=>JS_RE.test(i.str));jsItems.forEach(i=>jsSet.add(i.str));
      const trainItems=items.filter(i=>TECH_RE.test(i.str));trainItems.forEach(i=>trainSet.add(i.str));
      for(const tr of trainItems){
        const js=nearestJs(jsItems,tr),route=inferRoute(items,tr,tr.str),times=inferTimes(items,tr),days=inferDays(items,tr);
        if(!js||!route||!times){bad.push({page:n,trainNumber:tr.str,js:js?.str||null,reason:[!js&&'JS',!route&&'sens',!times&&'heure'].filter(Boolean).join('+')});continue;}
        const [originCode,destinationCode]=route,[departureMinute,arrivalMinute]=times,type=tr.str.startsWith('7')?'W':'EVO';
        const row={trainNumber:tr.str,js:js.str,page:n,y:yNorm(js,height),pagePath:'',originCode,destinationCode,departureMinute,arrivalMinute,days,exceptDays:[],validUntil:null,validFrom:null,exceptDates:[],isRosterTechnical:true,isRosterEvo:type==='EVO',isW:type==='W',timeEstimatedFromGraph:true,directionFromRosterGraph:true,autoImported:true};
        tech.push(row);index.push({trainNumber:tr.str,js:js.str,page:n,y:row.y});
      }
      for(const tx of items.filter(i=>/^TAXI$/i.test(i.str))){
        const js=nearestJs(jsItems,tx),route=inferTaxiRoute(items,tx),times=inferTimes(items,tx),days=inferDays(items,tx);
        if(!js||!route||!times){bad.push({page:n,type:'TAXI',js:js?.str||null,reason:[!js&&'JS',!route&&'trajet',!times&&'heure'].filter(Boolean).join('+')});continue;}
        const [originCode,destinationCode]=route,[departureMinute,arrivalMinute]=times;
        taxis.push({js:js.str,page:n,y:yNorm(js,height),pagePath:'',originCode,destinationCode,originRaw:originCode,destinationRaw:destinationCode,departureMinute,arrivalMinute,days,exceptDays:[],validUntil:null,validFrom:null,exceptDates:[],autoImported:true,timeEstimatedFromGraph:true});
      }
    }
    const validity=allText.match(/APPLICABLE\s+DU\s+(\d{2}\/\d{2}\/\d{4})\s+AU\s+(\d{2}\/\d{2}\/\d{4})/i)||allText.match(/DU\s+(\d{2}\/\d{2}\/\d{4})\s+AU\s+(\d{2}\/\d{2}\/\d{4})/i);
    if(validity){const from=frDateToIso(validity[1]),to=frDateToIso(validity[2]);$("from").value=from;$("to").value=to;if(!$("id").value)$("id").value=`rlt-${from}`;if(!$("label").value)$("label").value=`RLT ${from} → ${to}`;}
    // Déduplication par occurrence graphique.
    const dedupe=(rows,keyfn)=>{const s=new Set();return rows.filter(r=>{const k=keyfn(r);if(s.has(k))return false;s.add(k);return true;});};
    packageData={technicalTrains:dedupe(tech,r=>[r.trainNumber,r.js,r.page,r.departureMinute,r.originCode,r.destinationCode].join('|')),taxis:dedupe(taxis,r=>[r.js,r.page,r.departureMinute,r.originCode,r.destinationCode].join('|')),rosterIndex:dedupe(index,r=>[r.trainNumber,r.js,r.page].join('|'))};unresolved=bad;
    pdfSummary={file:f.name,pages:doc.numPages,js:[...jsSet].sort(),trains:[...trainSet].sort(),taxiCount:taxis.length,unresolved:bad.length};counts();
    const out={schemaVersion:2,sourceFile:f.name,generatedAt:new Date().toISOString(),validFrom:$("from").value||null,validTo:$("to").value||null,technicalTrains:packageData.technicalTrains,taxis:packageData.taxis,rosterIndex:packageData.rosterIndex,unresolved};
    $("preview").value=JSON.stringify(out,null,2);
    status(`Analyse terminée : ${packageData.technicalTrains.length} W/EVO et ${packageData.taxis.length} taxis prêts. ${unresolved.length} élément(s) non importé(s) car incertains.`);
  }catch(err){console.error(err);status("Analyse PDF impossible : "+err.message);}
};

$("applyjson").onclick=()=>{try{const j=JSON.parse($("preview").value);packageData={technicalTrains:Array.isArray(j.technicalTrains)?j.technicalTrains:[],taxis:Array.isArray(j.taxis)?j.taxis:[],rosterIndex:Array.isArray(j.rosterIndex)?j.rosterIndex:[]};unresolved=Array.isArray(j.unresolved)?j.unresolved:[];counts();status("JSON édité appliqué.");}catch(e){status("JSON invalide : "+e.message);}};
$("download").onclick=()=>{const blob=new Blob([JSON.stringify({...packageData,unresolved,sourceFile:$("pdffile").files[0]?.name||''},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${$("id").value||'rlt'}-package.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

$("save").onclick=async()=>{
  const body={id:$("id").value.trim(),label:$("label").value.trim(),validFrom:$("from").value,validTo:$("to").value,technicalTrains:packageData.technicalTrains,taxis:packageData.taxis,rosterIndex:packageData.rosterIndex,sourceFile:$("pdffile").files[0]?.name||$("jsonfile").files[0]?.name||"",sourceSummary:pdfSummary?{pages:pdfSummary.pages,jsCount:pdfSummary.js.length,trainCount:pdfSummary.trains.length,taxiCount:packageData.taxis.length,technicalCount:packageData.technicalTrains.length,unresolvedCount:unresolved.length,autoImported:true}:null};
  if(!body.technicalTrains.length&&!body.taxis.length){status("Aucune donnée importable. Analyse d'abord le PDF ou charge un package JSON.");return;}
  status("Enregistrement de la période…");const r=await fetch("/api/admin/rosters",{method:"POST",headers:headers(),body:JSON.stringify(body)}),j=await r.json();if(!r.ok){status(j.error||"Erreur d'enregistrement");return;}status(`Période enregistrée : ${j.counts.technicalTrains} W/EVO, ${j.counts.taxis} taxis. Elle sera sélectionnée automatiquement selon la date.`);loadPeriods();
};
$("load").onclick=loadPeriods;