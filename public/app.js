const $ = id => document.getElementById(id);
const state = { from: null, to: null, board: null };
const pad = n => String(n).padStart(2,"0");
function initDate(){const d=new Date();$("date").value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;$("time").value=`${pad(d.getHours())}:${pad(d.getMinutes())}`;} initDate();
function apiDatetime(){return `${$("date").value.replaceAll("-","")}T${$("time").value.replaceAll(":","")}00`;}
function nowApiDatetime(){const d=new Date();return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;}
function fmt(dt){if(!dt)return"";const m=dt.match(/T(\d{2})(\d{2})/);return m?`${m[1]}:${m[2]}`:dt;}
function duration(sec){const h=Math.floor(sec/3600),m=Math.round((sec%3600)/60);return h?`${h} h ${pad(m)}`:`${m} min`;}
function debounce(fn,ms=250){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setStatus(msg,error=false,id="status"){const el=$(id);el.textContent=msg||"";el.className="status"+(error?" error":"");}

function setupAutocomplete(inputId,listId,key){const input=$(inputId),list=$(listId);const search=debounce(async()=>{state[key]=null;const q=input.value.trim();if(q.length<2){list.innerHTML="";return;}try{const r=await fetch(`/api/stations?q=${encodeURIComponent(q)}`),data=await r.json();if(!r.ok)throw new Error(data.error||"Erreur de recherche");list.innerHTML=data.map(s=>`<div class="suggestion" data-id="${s.id}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.label)}</div>`).join("");}catch(e){list.innerHTML="";setStatus(e.message,true,key==="board"?"board-status":"status");}});input.addEventListener("input",search);list.addEventListener("click",e=>{const item=e.target.closest(".suggestion");if(!item)return;state[key]={id:item.dataset.id,name:item.dataset.name};input.value=item.dataset.name;list.innerHTML="";});}
setupAutocomplete("from","from-list","from"); setupAutocomplete("to","to-list","to"); setupAutocomplete("board-station","board-station-list","board");

$("swap").addEventListener("click",()=>{[state.from,state.to]=[state.to,state.from];const a=$("from").value;$("from").value=$("to").value;$("to").value=a;});
function getFavorites(){try{return JSON.parse(localStorage.getItem("hdfFavorites")||"[]");}catch{return[];}}
function saveFavorites(x){localStorage.setItem("hdfFavorites",JSON.stringify(x));renderFavorites();}
function addFavorite(s){if(!s?.id)return;const x=getFavorites();if(!x.some(v=>v.id===s.id)){x.push(s);saveFavorites(x);}}
function removeFavorite(id){saveFavorites(getFavorites().filter(x=>x.id!==id));}
function renderFavorites(){$("favorites").innerHTML=getFavorites().map(x=>`<span class="favorite-chip"><button data-use="${x.id}" data-name="${escapeHtml(x.name)}">${escapeHtml(x.name)}</button><button data-remove="${x.id}">×</button></span>`).join("");}
$("fav-from").addEventListener("click",()=>addFavorite(state.from));$("fav-to").addEventListener("click",()=>addFavorite(state.to));
$("favorites").addEventListener("click",e=>{if(e.target.dataset.remove)return removeFavorite(e.target.dataset.remove);if(e.target.dataset.use){const s={id:e.target.dataset.use,name:e.target.dataset.name};if(!state.from){state.from=s;$("from").value=s.name;}else{state.to=s;$("to").value=s.name;}}});renderFavorites();

$("search").addEventListener("click",async()=>{if(!state.from||!state.to)return setStatus("Choisis les deux gares dans les propositions affichées.",true);setStatus("Recherche des trajets…");$("results").innerHTML="";try{const qs=new URLSearchParams({from:state.from.id,to:state.to.id,datetime:apiDatetime()}),r=await fetch(`/api/journeys?${qs}`),data=await r.json();if(!r.ok)throw new Error(data.error||"Erreur API SNCF");render(data);setStatus(data.length?`${data.length} trajet(s) trouvé(s).`:"Aucun trajet trouvé.");}catch(e){setStatus(e.message,true);}});
function render(items){$("results").innerHTML=items.map(j=>{const details=j.sections.filter(s=>s.type==="public_transport").map(s=>{const d=s.display||{},train=[d.commercial_mode,d.label||d.headsign].filter(Boolean).join(" ");return `<div class="section"><div class="train">${escapeHtml(train||"Train")}</div><div>${escapeHtml(s.from||"")} ${fmt(s.departure)} → ${escapeHtml(s.to||"")} ${fmt(s.arrival)}</div>${d.direction?`<div class="meta">Direction : ${escapeHtml(d.direction)}</div>`:""}</div>`;}).join("");return `<article class="journey"><div class="times"><span class="time">${fmt(j.departure)}</span><span class="line"></span><span class="time">${fmt(j.arrival)}</span></div><div class="meta">${duration(j.duration)} • ${j.transfers===0?"Direct":`${j.transfers} correspondance(s)`}</div><div class="details">${details||"Détails non disponibles."}</div></article>`;}).join("");document.querySelectorAll(".journey").forEach(el=>el.addEventListener("click",()=>el.classList.toggle("open")));}

// Tableau des départs
$("board-search").addEventListener("click",loadBoard);
async function loadBoard(){if(!state.board)return setStatus("Choisis une gare dans les propositions affichées.",true,"board-status");setStatus("Chargement des départs en temps réel…",false,"board-status");$("board-results").innerHTML="";try{const qs=new URLSearchParams({station:state.board.id,datetime:nowApiDatetime()}),r=await fetch(`/api/departures?${qs}`),data=await r.json();if(!r.ok)throw new Error(data.error||"Erreur API SNCF");renderBoard(data);setStatus(data.length?`${data.length} prochain(s) départ(s) — ${state.board.name}`:"Aucun départ trouvé.",false,"board-status");}catch(e){setStatus(e.message,true,"board-status");}}
function renderBoard(items){$("board-results").innerHTML=items.map(d=>`<article class="departure-row"><div class="departure-time">${fmt(d.departure)}</div><div class="departure-main"><div class="departure-destination">${escapeHtml(d.direction||"Destination non indiquée")}</div><div class="meta">${escapeHtml(d.mode)} ${escapeHtml(d.trainNumber)}${d.delay?` • <span class="delay">+${d.delay} min</span>`:""}</div></div><div class="platform ${d.platform?"known":""}">${d.platform?`Voie ${escapeHtml(d.platform)}`:"Voie —"}</div></article>`).join("");}

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b===btn));const board=btn.dataset.tab==="board";$("trip-panel").hidden=board;$("board-panel").hidden=!board;}));
fetch("/api/status").then(r=>r.json()).then(s=>{if(!s.tokenConfigured)setStatus("Configuration requise : ajoute ton token API SNCF.",true);});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/service-worker.js").catch(()=>{}));
