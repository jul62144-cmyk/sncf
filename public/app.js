
const $ = id => document.getElementById(id);
const state = { from:null, to:null, boardStation:null, boardMode:"departures", boardData:[], filter:"all" };
const pad = n => String(n).padStart(2,"0");

function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function debounce(fn,ms=250){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function fmt(dt){if(!dt)return"";const m=dt.match(/T(\d{2})(\d{2})/);return m?`${m[1]}:${m[2]}`:dt;}
function duration(sec){const h=Math.floor(sec/3600),m=Math.round((sec%3600)/60);return h?`${h} h ${pad(m)}`:`${m} min`;}
function apiDatetime(dateId="date",timeId="time"){return `${$(dateId).value.replaceAll("-","")}T${$(timeId).value.replaceAll(":","")}00`;}
function setStatus(el,msg,error=false){el.textContent=msg||"";el.className="status"+(error?" error":"");}

function initDates(){
  const d=new Date();
  const date=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const time=`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("date").value=date;$("time").value=time;$("board-date").value=date;$("board-time").value=time;
}
initDates();

function updateClock(){
  const d=new Date();
  $("clock").textContent=d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  $("clock-date").textContent=d.toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"long",year:"numeric"});
}
updateClock();setInterval(updateClock,30000);

function setupAutocomplete(inputId,listId,onSelect){
  const input=$(inputId),list=$(listId);
  const run=debounce(async()=>{
    const q=input.value.trim();if(q.length<2){list.innerHTML="";return;}
    try{
      const r=await fetch(`/api/stations?q=${encodeURIComponent(q)}`),data=await r.json();
      if(!r.ok)throw new Error(data.error||"Erreur");
      list.innerHTML=data.map(s=>`<div class="suggestion" data-id="${s.id}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.label)}</div>`).join("");
    }catch{list.innerHTML="";}
  });
  input.addEventListener("input",run);
  list.addEventListener("click",e=>{
    const item=e.target.closest(".suggestion");if(!item)return;
    const station={id:item.dataset.id,name:item.dataset.name};
    input.value=station.name;list.innerHTML="";onSelect(station);
  });
}
setupAutocomplete("from","from-list",s=>state.from=s);
setupAutocomplete("to","to-list",s=>state.to=s);
setupAutocomplete("board-station","board-station-list",s=>{
  state.boardStation=s;$("side-station").textContent=s.name;
});

document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
    const view=btn.dataset.view;
    if(view==="route"){$("board-view").classList.add("hidden");$("route-view").classList.remove("hidden");return;}
    $("route-view").classList.add("hidden");$("board-view").classList.remove("hidden");
    state.boardMode=view;
    $("board-title").textContent=view==="departures"?"Départs":"Arrivées";
    $("target-heading").textContent=view==="departures"?"Destination":"Origine";
    $("other-heading").textContent=view==="departures"?"Origine":"Destination";
    $("board-search-btn").textContent=view==="departures"?"Afficher les départs":"Afficher les arrivées";
    if(state.boardStation) loadBoard();
  });
});

function boardStatus(item){
  const actual=item.datetime,base=item.baseDatetime;
  let delay=0;
  if(actual&&base){
    const p=x=>{const m=x.match(/T(\d{2})(\d{2})/);return m?Number(m[1])*60+Number(m[2]):0;};
    delay=p(actual)-p(base);if(delay< -720)delay+=1440;
  }
  const raw=String(item.status||"").toLowerCase();
  if(raw.includes("cancel")||raw.includes("supprim"))return {text:"Supprimé",cls:"status-delay"};
  if(delay>0)return {text:`Retard ${delay} min`,cls:"status-delay"};
  return {text:"À l'heure",cls:"status-ok"};
}

function renderBoard(){
  const filtered=state.boardData.filter(x=>state.filter==="all"||x.transportType===state.filter);
  $("count-all").textContent=state.boardData.length;
  $("count-train").textContent=state.boardData.filter(x=>x.transportType==="train").length;
  $("count-bus").textContent=state.boardData.filter(x=>x.transportType==="bus").length;

  $("board-results").innerHTML=filtered.map(item=>{
    const st=boardStatus(item);
    const trainNo=item.trainNumber||item.label||"—";
    const isBus=item.transportType==="bus";
    const target=state.boardMode==="departures"
      ? (item.direction||item.headsign||"—")
      : (item.origin||item.headsign||item.direction||"—");
    const other=state.boardMode==="departures"
      ? (item.origin||"—")
      : (item.direction||"—");
    const mode=item.commercialMode||item.network||(isBus?"Car TER":"Train");
    const platform=item.platform
      ? `<span class="platform ${isBus?"bus":""}">${escapeHtml(item.platform)}</span>${item.platformActive?'<span class="track-ok">✓</span>':""}`
      : `<span class="subtle">—</span>`;
    return `<tr>
      <td class="time-cell">${fmt(item.datetime)}</td>
      <td><span class="${st.cls}">${escapeHtml(st.text)}</span></td>
      <td><span class="train-number">${escapeHtml(trainNo)}</span><span class="mode-tag ${isBus?"bus":""}">${escapeHtml(mode)}</span></td>
      <td><div class="destination">${escapeHtml(target)}</div></td>
      <td>${platform}</td>
      <td>${isBus?"CAR":escapeHtml((mode||"TRAIN").replace("TER HDF","TER"))}</td>
      <td>${escapeHtml(other)}</td>
    </tr>`;
  }).join("");

  if(!filtered.length){
    $("board-results").innerHTML=`<tr><td colspan="7" class="subtle">Aucune circulation à afficher.</td></tr>`;
  }
}

async function loadBoard(){
  if(!state.boardStation){setStatus($("board-status"),"Choisis une gare dans les propositions.",true);return;}
  setStatus($("board-status"),"Chargement…");$("board-results").innerHTML="";
  $("board-subtitle").textContent=`${state.boardMode==="departures"?"Départs":"Arrivées"} – ${state.boardStation.name}`;
  try{
    const trainQs=new URLSearchParams({stopArea:state.boardStation.id,datetime:apiDatetime("board-date","board-time")});
    const busQs=new URLSearchParams({stationName:state.boardStation.name,date:$("board-date").value,time:$("board-time").value,mode:state.boardMode});
    const [tr,busr]=await Promise.all([fetch(`/api/${state.boardMode}?${trainQs}`),fetch(`/api/bus-board?${busQs}`)]);
    const trains=await tr.json(),buses=await busr.json();
    if(!tr.ok)throw new Error(trains.error||"Erreur SNCF");
    state.boardData=[...(Array.isArray(trains)?trains:[]),...(Array.isArray(buses)?buses:[])]
      .sort((a,b)=>(a.datetime||"").localeCompare(b.datetime||""));
    setStatus($("board-status"),`${state.boardData.length} circulation(s) affichée(s).`);
    renderBoard();
  }catch(e){setStatus($("board-status"),e.message,true);}
}
$("board-search-btn").addEventListener("click",loadBoard);
$("refresh-board").addEventListener("click",()=>{if(!$("board-view").classList.contains("hidden"))loadBoard();});
document.querySelectorAll(".filter").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.filter=btn.dataset.filter;renderBoard();
}));

$("swap").addEventListener("click",()=>{
  [state.from,state.to]=[state.to,state.from];const v=$("from").value;$("from").value=$("to").value;$("to").value=v;
});

function getFavorites(){try{return JSON.parse(localStorage.getItem("hdfFavorites")||"[]")}catch{return[]}}
function saveFavorites(x){localStorage.setItem("hdfFavorites",JSON.stringify(x));renderFavorites()}
function addFavorite(s){if(!s)return;const a=getFavorites();if(!a.some(x=>x.id===s.id)){a.push(s);saveFavorites(a)}}
function renderFavorites(){
  $("favorites").innerHTML=getFavorites().map(x=>`<button class="favorite-chip" data-id="${x.id}" data-name="${escapeHtml(x.name)}">${escapeHtml(x.name)}</button>`).join("");
}
$("fav-from").addEventListener("click",()=>addFavorite(state.from));
$("fav-to").addEventListener("click",()=>addFavorite(state.to));
$("favorites").addEventListener("click",e=>{
  const b=e.target.closest(".favorite-chip");if(!b)return;const s={id:b.dataset.id,name:b.dataset.name};
  if(!state.from){state.from=s;$("from").value=s.name}else{state.to=s;$("to").value=s.name}
});
renderFavorites();

$("search").addEventListener("click",async()=>{
  if(!state.from||!state.to){setStatus($("status"),"Choisis les deux gares dans les propositions.",true);return;}
  setStatus($("status"),"Recherche…");$("results").innerHTML="";
  try{
    const trainQs=new URLSearchParams({from:state.from.id,to:state.to.id,datetime:apiDatetime()});
    const busQs=new URLSearchParams({fromName:state.from.name,toName:state.to.name,date:$("date").value,time:$("time").value});
    const [tr,br]=await Promise.all([fetch(`/api/journeys?${trainQs}`),fetch(`/api/bus-journeys?${busQs}`)]);
    const trains=await tr.json(),buses=await br.json();
    if(!tr.ok)throw new Error(trains.error||"Erreur SNCF");
    const data=[...(Array.isArray(trains)?trains:[]),...(Array.isArray(buses)?buses:[])]
      .sort((a,b)=>(a.departure||"").localeCompare(b.departure||""));
    setStatus($("status"),`${data.length} trajet(s) trouvé(s).`);
    renderJourneys(data);
  }catch(e){setStatus($("status"),e.message,true);}
});

function renderJourneys(items){
  $("results").innerHTML=items.map((j,i)=>{
    const sections=(j.sections||[]).filter(s=>s.type==="public_transport");
    const details=sections.map(s=>{
      const d=s.display||{};
      const no=d.train_number||d.headsign||d.label||"";
      const name=j.transportType==="bus"?"Car TER":([d.commercial_mode,no].filter(Boolean).join(" "));
      const depTrack=s.departure_platform?`Départ voie ${escapeHtml(s.departure_platform)}${s.departure_platform_active?" ✓":""}`:"";
      const arrTrack=s.arrival_platform?`Arrivée voie ${escapeHtml(s.arrival_platform)}${s.arrival_platform_active?" ✓":""}`:"";
      return `<div class="section">
        <div class="train">${escapeHtml(name)}</div>
        <div>${escapeHtml(s.from||"")} ${fmt(s.departure)} → ${escapeHtml(s.to||"")} ${fmt(s.arrival)}</div>
        ${(depTrack||arrTrack)?`<div class="section-platform">${[depTrack,arrTrack].filter(Boolean).join(" • ")}</div>`:""}
      </div>`;
    }).join("");
    return `<article class="journey" data-i="${i}">
      <div class="journey-head">
        <div class="journey-time">${fmt(j.departure)}</div>
        <div><div class="journey-route">${escapeHtml(state.from?.name||"")} → ${escapeHtml(state.to?.name||"")}</div>
          <div class="journey-meta">${duration(j.duration)} • ${j.transfers===0?"Direct":`${j.transfers} correspondance(s)`}</div></div>
        <div class="journey-badge">${j.transportType==="bus"?"🚌 Car TER":"🚆 Train"}</div>
      </div>
      <div class="details">${details||"Détails non disponibles."}</div>
    </article>`;
  }).join("");
  document.querySelectorAll(".journey").forEach(x=>x.addEventListener("click",()=>x.classList.toggle("open")));
}

fetch("/api/status").then(r=>r.json()).then(s=>{if(!s.tokenConfigured)setStatus($("status"),"Ajoute ton token SNCF dans .env.",true);});
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}));
