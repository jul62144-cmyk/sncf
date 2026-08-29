// v2.14.4 - add roster taxis to station departure boards
(function(){
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const taxiKind=r=>String(r?.setId||"").toLowerCase()==="asct"?"ASCT":"ADC";

  function taxiBoardItems(payload,stationName,dateStr,timeStr){
    const station=norm(stationName);
    const [hh,mm]=String(timeStr||"00:00").split(":").map(Number);
    const minStart=(Number.isFinite(hh)?hh:0)*60+(Number.isFinite(mm)?mm:0);
    return (payload?.taxis||[])
      .filter(r=>norm(r.originName)===station)
      .filter(r=>rosterDateRuleApplies(r,dateStr))
      .filter(r=>Number(r.departureMinute)>=minStart)
      .sort((a,b)=>Number(a.departureMinute)-Number(b.departureMinute))
      .map(r=>({
        type:"departure",
        source:"roster-taxi",
        transportType:"taxi",
        datetime:minuteToSncf(dateStr,r.departureMinute),
        baseDatetime:minuteToSncf(dateStr,r.departureMinute),
        stop:r.originName||stationName,
        origin:r.originName||stationName,
        direction:r.destinationName||"",
        headsign:r.destinationName||"",
        label:`JS ${r.js||""}`.trim(),
        trainNumber:"",
        commercialMode:`Taxi ${taxiKind(r)}`,
        network:"Roulement",
        status:null,
        platform:null,
        rosterTaxi:true,
        rosterJS:r.js||"",
        rosterPage:r.page,
        rosterY:r.y,
        rosterPagePath:r.pagePath||"",
        rosterSetLabel:r.setLabel||"",
        arrival:minuteToSncf(dateStr,r.arrivalMinute)
      }));
  }

  // Add a dedicated Taxi filter beside Trains/Cars.
  const filters=document.querySelector(".filters");
  if(filters&&!document.querySelector('[data-filter="taxi"]')){
    const b=document.createElement("button");
    b.className="filter";
    b.dataset.filter="taxi";
    b.innerHTML='Taxis <span id="count-taxi">0</span>';
    filters.appendChild(b);
    b.addEventListener("click",()=>{
      document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      state.filter="taxi";
      renderBoard();
    });
  }

  const originalRenderBoard=renderBoard;
  renderBoard=function(){
    originalRenderBoard();
    const c=document.getElementById("count-taxi");
    if(c)c.textContent=state.boardData.filter(x=>x.transportType==="taxi").length;
  };

  const patchedLoadBoard=async function(){
    if(!state.boardStation){setStatus($("board-status"),"Choisis une gare dans les propositions.",true);return;}
    setStatus($("board-status"),"Chargement…");$("board-results").innerHTML="";
    $("board-subtitle").textContent=`${state.boardMode==="departures"?"Départs":"Arrivées"} – ${state.boardStation.name}`;
    try{
      const trainQs=new URLSearchParams({stopArea:state.boardStation.id,datetime:apiDatetime("board-date","board-time")});
      const busQs=new URLSearchParams({stationName:state.boardStation.name,date:$("board-date").value,time:$("board-time").value,mode:state.boardMode});
      const taxiPromise=state.boardMode==="departures"?loadRosterTaxis().catch(()=>({taxis:[]})):Promise.resolve({taxis:[]});
      const [tr,busr,taxiPayload]=await Promise.all([
        fetch(`/api/${state.boardMode}?${trainQs}`),
        fetch(`/api/bus-board?${busQs}`),
        taxiPromise
      ]);
      const trains=await tr.json(),buses=await busr.json();
      if(!tr.ok)throw new Error(trains.error||"Erreur SNCF");
      const taxis=state.boardMode==="departures"
        ? taxiBoardItems(taxiPayload,state.boardStation.name,$("board-date").value,$("board-time").value)
        : [];
      state.boardData=[...(Array.isArray(trains)?trains:[]),...(Array.isArray(buses)?buses:[]),...taxis]
        .sort((a,b)=>(a.datetime||"").localeCompare(b.datetime||""));
      setStatus($("board-status"),`${state.boardData.length} circulation(s) affichée(s)${taxis.length?` • ${taxis.length} taxi(s)`:""}.`);
      renderBoard();
    }catch(e){setStatus($("board-status"),e.message,true);}
  };

  // Rebind the global function used by favourites/nav/refresh.
  loadBoard=patchedLoadBoard;

  // The original search button listener captured the previous function reference.
  // Capture the click first so only the patched loader runs.
  $("board-search-btn")?.addEventListener("click",e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    patchedLoadBoard();
  },true);
})();
