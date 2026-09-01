// v2.14.12 - taxis + RLT W/EVO boards (31/08-12/12)
(function(){
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const taxiKind=r=>String(r?.setId||"").toLowerCase()==="asct"?"ASCT":"ADC";
  const taxiKey=r=>[String(r?.setId||""),String(r?.js||""),String(r?.page||""),norm(r?.originName||r?.originRaw),norm(r?.destinationName||r?.destinationRaw),String(r?.departureMinute||""),String(r?.arrivalMinute||""),(r?.days||[]).slice().sort().join(",")].join("|");
  const rosterNo=r=>(String(r?.trainNumber||r?.label||"").toUpperCase().match(/(\d{6})/)||[])[1]||"";
  const isW=r=>r?.isW===true || /^7\d{5}$/.test(rosterNo(r));
  const isEvo=r=>r?.isRosterEvo===true || (r?.isRosterTechnical===true && /^[69]\d{5}$/.test(rosterNo(r)));
  const stationNames={
    "LE":"Lille Flandres","LSA":"Lille Saint-Sauveur","LE-RT":"Garages TER","LERT":"Garages TER",
    "LNS":"Lens","LNS-DT":"Lens Dépôt","LNS-TR":"Lens Triage","ARR":"Arras","SPT":"Saint-Pol-sur-Ternoise",
    "BET":"Béthune","HZK":"Hazebrouck","DO":"Douai","DON":"Don-Sainghin","HBE":"Haubourdin",
    "AON":"Aulnoye-Aymeries","AS":"Amiens","ETA":"Étaples - Le Touquet","CS":"Calais Ville","DKQ":"Dunkerque",
    "STO":"Saint-Omer","SQ":"Saint-Quentin","CAM":"Cambrai","VS":"Valenciennes","LEQ":"Le Quesnoy"
  };
  const codeName=c=>stationNames[String(c||"").toUpperCase()]||String(c||"");
  const stationMatchesCode=(stationName,code)=>{
    const n=norm(stationName),c=String(code||"").toUpperCase(),cn=norm(codeName(c));
    if(!n||!c)return false;
    if(n===norm(c)||n===cn)return true;
    if(c==="LE"&&n.includes("lille flandres"))return true;
    if(c==="LSA"&&(n.includes("lille saint sauveur")||n.includes("lille st sauveur")))return true;
    if((c==="LE-RT"||c==="LERT")&&(n.includes("garages ter")||n==="le rt"||n==="lert"))return true;
    if(c==="LNS"&&(n==="lens"||n.includes("lens gare")))return true;
    if(c==="ARR"&&n==="arras")return true;
    if(c==="BET"&&(n==="bethune"||n.includes("bethune")))return true;
    if(c==="HZK"&&n==="hazebrouck")return true;
    if(c==="DO"&&n==="douai")return true;
    return false;
  };
  function dedupeTaxis(rows){const seen=new Set();return (rows||[]).filter(r=>{const k=taxiKey(r);if(seen.has(k))return false;seen.add(k);return true;});}
  function taxiBoardItems(payload,stationName,dateStr,timeStr){const station=norm(stationName),[hh,mm]=String(timeStr||"00:00").split(":").map(Number),minStart=(Number.isFinite(hh)?hh:0)*60+(Number.isFinite(mm)?mm:0);return dedupeTaxis(payload?.taxis||[]).filter(r=>norm(r.originName)===station).filter(r=>rosterDateRuleApplies(r,dateStr)).filter(r=>Number(r.departureMinute)>=minStart).sort((a,b)=>Number(a.departureMinute)-Number(b.departureMinute)).map(r=>({type:"departure",source:"roster-taxi",transportType:"taxi",datetime:minuteToSncf(dateStr,r.departureMinute),baseDatetime:minuteToSncf(dateStr,r.departureMinute),stop:r.originName||stationName,origin:r.originName||stationName,direction:r.destinationName||"",headsign:r.destinationName||"",label:`JS ${r.js||""}`.trim(),trainNumber:"",commercialMode:`Taxi ${taxiKind(r)}`,network:"Roulement",status:null,platform:null,rosterTaxi:true,rosterSetId:String(r.setId||""),rosterTaxiKind:taxiKind(r),rosterJS:r.js||"",rosterPage:r.page,rosterY:r.y,rosterPagePath:r.pagePath||"",rosterSetLabel:r.setLabel||"",arrival:minuteToSncf(dateStr,r.arrivalMinute)}));}
  async function loadRosterWAutumn(dateStr){
    if(String(dateStr||"")<"2026-08-31"||String(dateStr||"")>"2026-12-12")return {technicalTrains:[]};
    const parts=await Promise.all([1,2,3,4].map(i=>fetch(`/roster-w-autumn-${i}.json`,{cache:"no-store"}).then(r=>r.ok?r.json():{technicalTrains:[]}).catch(()=>({technicalTrains:[]}))));
    return {technicalTrains:parts.flatMap(p=>Array.isArray(p?.technicalTrains)?p.technicalTrains:[])};
  }
  function technicalBoardItems(payload,stationName,dateStr,timeStr){
    const [hh,mm]=String(timeStr||"00:00").split(":").map(Number),minStart=(Number.isFinite(hh)?hh:0)*60+(Number.isFinite(mm)?mm:0),seen=new Set();
    return (payload?.technicalTrains||[]).filter(r=>rosterDateRuleApplies(r,dateStr)).filter(r=>Number(r.departureMinute)>=minStart).filter(r=>{
      const n=rosterNo(r),o=String(r.originCode||"").toUpperCase(),d=String(r.destinationCode||"").toUpperCase();
      const validW=/^7\d{5}$/.test(n);
      const valid900=/^9\d{5}$/.test(n)&&((o==="LE"&&d==="LSA")||(o==="LSA"&&d==="LE"));
      const valid600=/^6\d{5}$/.test(n)&&((o==="LE"&&(d==="LE-RT"||d==="LERT"))||((o==="LE-RT"||o==="LERT")&&d==="LE"));
      return (validW||valid900||valid600)&&stationMatchesCode(stationName,o);
    }).filter(r=>{const k=[rosterNo(r),r.originCode,r.destinationCode,r.departureMinute,r.arrivalMinute,r.js].join("|");if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>Number(a.departureMinute)-Number(b.departureMinute)).map(r=>{
      const n=rosterNo(r),w=/^7\d{5}$/.test(n);
      return {type:"departure",source:w?"rlt-w":"roster-technical",transportType:"train",datetime:minuteToSncf(dateStr,r.departureMinute),baseDatetime:minuteToSncf(dateStr,r.departureMinute),stop:codeName(r.originCode),origin:codeName(r.originCode),direction:codeName(r.destinationCode),headsign:codeName(r.destinationCode),label:n,trainNumber:n,commercialMode:w?"W":"EVO",network:"Roulement",status:null,platform:null,isW:w,isRosterTechnical:true,isRosterEvo:!w,rosterJS:r.js||"",rosterPage:r.page,rosterY:r.y,rosterPagePath:r.pagePath||"",arrival:minuteToSncf(dateStr,r.arrivalMinute)};
    });
  }
  const dtMinute=x=>{const m=String(x?.datetime||x?.baseDatetime||"").match(/T(\d{2})(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;};
  function preferRltW(apiRows,rltRows){
    const rw=(rltRows||[]).filter(isW).map(x=>({n:rosterNo(x),m:dtMinute(x)}));
    if(!rw.length)return apiRows||[];
    return (apiRows||[]).filter(x=>{if(!isW(x))return true;const n=rosterNo(x),m=dtMinute(x);return !rw.some(r=>r.n===n&&(m==null||r.m==null||Math.abs(r.m-m)<=20));});
  }
  if(typeof openRosterDirect==="function"){const before=openRosterDirect;openRosterDirect=function(page,y,js,pagePath){if(String(pagePath||"").includes("/roster-pages/asct/"))return;return before(page,y,js,pagePath);};}
  const filters=document.querySelector(".filters");
  function addFilter(type,label,countId){if(!filters||document.querySelector(`[data-filter="${type}"]`))return;const b=document.createElement("button");b.className="filter";b.dataset.filter=type;b.innerHTML=`${label} <span id="${countId}">0</span>`;filters.appendChild(b);b.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=type;renderBoard();});}
  addFilter("w","W","count-w");addFilter("evo","EVO","count-evo");addFilter("taxi","Taxis","count-taxi");
  const originalRenderBoard=renderBoard;
  renderBoard=function(){
    const all=state.boardData,filter=state.filter;
    if(filter==="w"||filter==="evo"){state.boardData=all.filter(filter==="w"?isW:isEvo);state.filter="all";originalRenderBoard();state.boardData=all;state.filter=filter;}else originalRenderBoard();
    const cw=document.getElementById("count-w");if(cw)cw.textContent=all.filter(isW).length;
    const ce=document.getElementById("count-evo");if(ce)ce.textContent=all.filter(isEvo).length;
    const ct=document.getElementById("count-taxi");if(ct)ct.textContent=all.filter(x=>x.transportType==="taxi").length;
    const displayed=filter==="w"?all.filter(isW):filter==="evo"?all.filter(isEvo):all.filter(x=>filter==="all"||x.transportType===filter);
    const rows=document.querySelectorAll("#board-results tr");rows.forEach((tr,i)=>{const item=displayed[i];if(!item?.rosterTaxi)return;const cell=tr.children?.[2];if(!cell)return;const js=String(item.rosterJS||"");const isAsct=String(item.rosterSetId||"").toLowerCase()==="asct"||String(item.rosterPagePath||"").includes("/roster-pages/asct/");if(!isAsct&&item.rosterPage){cell.innerHTML=`<button type="button" class="train-number roster-train-link" data-roster-direct-page="${escapeHtml(String(item.rosterPage))}" data-roster-direct-y="${escapeHtml(String(item.rosterY??0))}" data-roster-direct-js="${escapeHtml(js)}" data-roster-direct-path="${escapeHtml(item.rosterPagePath||"")}" title="Voir le graphique du roulement">JS ${escapeHtml(js)}</button> <span class="mode-tag">${escapeHtml(item.commercialMode||"Taxi ADC")}</span>`;tr.classList.add("roster-click-row");tr.dataset.rosterDirectPage=String(item.rosterPage);tr.dataset.rosterDirectY=String(item.rosterY??0);tr.dataset.rosterDirectJs=js;tr.dataset.rosterDirectPath=item.rosterPagePath||"";}else{cell.innerHTML=`<span class="train-number">JS ${escapeHtml(js)}</span> <span class="mode-tag">${escapeHtml(item.commercialMode||"Taxi ASCT")}</span>`;tr.classList.remove("roster-click-row");delete tr.dataset.rosterDirectPage;delete tr.dataset.rosterDirectY;delete tr.dataset.rosterDirectJs;delete tr.dataset.rosterDirectPath;}});
  };
  const patchedLoadBoard=async function(){if(!state.boardStation){setStatus($("board-status"),"Choisis une gare dans les propositions.",true);return;}setStatus($("board-status"),"Chargement…");$("board-results").innerHTML="";$("board-subtitle").textContent=`${state.boardMode==="departures"?"Départs":"Arrivées"} – ${state.boardStation.name}`;try{
    const date=$("board-date").value,time=$("board-time").value;
    const trainQs=new URLSearchParams({stopArea:state.boardStation.id,datetime:apiDatetime("board-date","board-time")});const busQs=new URLSearchParams({stationName:state.boardStation.name,date,time,mode:state.boardMode});
    const taxiPromise=state.boardMode==="departures"?loadRosterTaxis().catch(()=>({taxis:[]})):Promise.resolve({taxis:[]});
    const techPromise=state.boardMode==="departures"?loadRosterTechnicalTrains().catch(()=>({technicalTrains:[]})):Promise.resolve({technicalTrains:[]});
    const wPromise=state.boardMode==="departures"?loadRosterWAutumn(date):Promise.resolve({technicalTrains:[]});
    const [tr,busr,taxiPayload,techPayload,wPayload]=await Promise.all([fetch(`/api/${state.boardMode}?${trainQs}`),fetch(`/api/bus-board?${busQs}`),taxiPromise,techPromise,wPromise]);
    const trains=await tr.json(),buses=await busr.json();if(!tr.ok)throw new Error(trains.error||"Erreur SNCF");
    const taxis=state.boardMode==="departures"?taxiBoardItems(taxiPayload,state.boardStation.name,date,time):[];
    const mergedTech={technicalTrains:[...(techPayload?.technicalTrains||[]),...(wPayload?.technicalTrains||[])]};
    const technical=state.boardMode==="departures"?technicalBoardItems(mergedTech,state.boardStation.name,date,time):[];
    const apiTrains=preferRltW(Array.isArray(trains)?trains:[],technical);
    state.boardData=[...apiTrains,...(Array.isArray(buses)?buses:[]),...technical,...taxis].sort((a,b)=>(a.datetime||"").localeCompare(b.datetime||""));
    const rw=technical.filter(isW).length,re=technical.filter(isEvo).length;setStatus($("board-status"),`${state.boardData.length} circulation(s) affichée(s)${rw?` • ${rw} W RLT`:""}${re?` • ${re} EVO RLT`:""}${taxis.length?` • ${taxis.length} taxi(s)`:""}.`);renderBoard();
  }catch(e){setStatus($("board-status"),e.message,true);}};
  loadBoard=patchedLoadBoard;$("board-search-btn")?.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();patchedLoadBoard();},true);
})();
