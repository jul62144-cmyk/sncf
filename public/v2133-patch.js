/* Trajets HDF v2.13.3 - correctif de synchronisation GitHub.
   Ajoute les taxis ASCT au fichier ADC historique sans remplacer les gros fichiers existants. */
(() => {
  let patchedRosterPromise = null;

  function expandAsctCompact(payload){
    const keys = payload?.keys || [];
    const names = payload?.names || {};
    return (payload?.rows || []).map(row => {
      const r = {};
      keys.forEach((k,i) => r[k] = row[i]);
      return {
        ...r,
        setId: "asct",
        setLabel: "Roulement ASCT",
        validFromSet: "2025-12-14",
        validToSet: "2026-12-12",
        pagePath: `/roster-pages/asct/page-${String(r.page).padStart(2,"0")}.webp`,
        originName: names[r.originCode] || r.originCode,
        destinationName: names[r.destinationCode] || r.destinationCode,
        originRaw: r.originCode,
        destinationRaw: r.destinationCode
      };
    });
  }

  loadRosterTaxis = function(){
    if(!patchedRosterPromise){
      patchedRosterPromise = Promise.all([
        fetch("/roster-taxis.json", {cache:"no-store"}).then(r => {
          if(!r.ok) throw new Error("Taxis ADC indisponibles");
          return r.json();
        }),
        fetch("/asct-compact.json", {cache:"no-store"}).then(r => {
          if(!r.ok) throw new Error("Taxis ASCT indisponibles");
          return r.json();
        })
      ]).then(([adc,asct]) => {
        const asctRows = expandAsctCompact(asct);
        return {
          ...adc,
          source: "Roulements intégrés",
          taxis: [...(adc?.taxis || []).filter(x => x?.setId !== "asct"), ...asctRows]
        };
      });
    }
    return patchedRosterPromise;
  };

  rosterDateRuleApplies = function(r,dateStr){
    if(!dateStr) return false;
    const d = new Date(`${dateStr}T12:00:00Z`);
    if(Number.isNaN(d.getTime())) return false;
    const setFrom = r.validFromSet || "2026-07-04";
    const setTo = r.validToSet || "2026-12-12";
    if(dateStr < setFrom || dateStr > setTo) return false;

    const day = ["DI","LU","MA","ME","JE","VE","SA"][d.getUTCDay()];
    const md = `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    const explicit = Array.isArray(r.explicitDates) && r.explicitDates.includes(md);
    if(Array.isArray(r.exceptDates) && r.exceptDates.includes(md)) return false;
    if(!explicit){
      if(Array.isArray(r.days) && r.days.length && !r.days.includes(day)) return false;
      if(Array.isArray(r.exceptDays) && r.exceptDays.includes(day)) return false;
    }

    const mdNum = x => {
      const m = String(x || "").match(/^(\d{1,2})\/(\d{1,2})$/);
      return m ? Number(m[2])*100 + Number(m[1]) : null;
    };
    const cur = (d.getUTCMonth()+1)*100 + d.getUTCDate();
    const inRange = (a,b) => {
      a=mdNum(a); b=mdNum(b);
      if(a==null || b==null) return false;
      return a<=b ? cur>=a && cur<=b : cur>=a || cur<=b;
    };
    if(explicit) return true;
    if(Array.isArray(r.dateRanges) && r.dateRanges.length && !r.dateRanges.some(x => Array.isArray(x) && inRange(x[0],x[1]))) return false;

    const until=mdNum(r.validUntil), from=mdNum(r.validFrom);
    if(until!=null && from!=null){ if(!(cur<=until || cur>=from)) return false; }
    else {
      if(until!=null && cur>until) return false;
      if(from!=null && cur<from) return false;
    }
    return true;
  };

  rosterTaxiJourneys = function(payload,fromName,toName,dateStr,timeStr){
    const [hh,mm] = String(timeStr || "00:00").split(":").map(Number);
    const minStart = (Number.isFinite(hh)?hh:0)*60 + (Number.isFinite(mm)?mm:0);
    const matches = (wantedName,rName,rCode) => {
      const wanted = normalizePlace(wantedName);
      const actual = normalizePlace(rName);
      if(wanted === actual) return true;
      const code = stationKey(rCode || "");
      const wantedKey = stationKey(wantedName);
      if(wantedKey.includes("LENS") && code === "LNS") return true;
      if(wantedKey.includes("LILLE FLANDRES") && code === "LE") return true;
      if(wantedKey.includes("SAINT POL") && code === "SPT") return true;
      if(wantedKey.includes("ARRAS") && code === "ARR") return true;
      if(wantedKey.includes("BETHUNE") && code === "BET") return true;
      if(wantedKey.includes("DOUAI") && code === "DO") return true;
      if(wantedKey.includes("HAZEBROUCK") && code === "HZK") return true;
      if(wantedKey.includes("DUNKERQUE") && code === "DKQ") return true;
      if(wantedKey.includes("CALAIS") && code === "CS") return true;
      return false;
    };

    return (payload?.taxis || [])
      .filter(r => matches(fromName,r.originName,r.originCode) && matches(toName,r.destinationName,r.destinationCode))
      .filter(r => rosterDateRuleApplies(r,dateStr))
      .filter(r => Number(r.departureMinute) >= minStart && Number(r.departureMinute) < 1440)
      .sort((a,b) => Number(a.departureMinute)-Number(b.departureMinute))
      .map(r => ({
        source:"roster",
        transportType:"taxi",
        rosterTaxi:true,
        taxiAgentType:r.setId === "asct" ? "ASCT" : "ADC",
        rosterJS:r.js,
        rosterPage:r.page,
        rosterY:r.y,
        rosterPagePath:r.pagePath || "",
        rosterSetLabel:r.setLabel || (r.setId === "asct" ? "Roulement ASCT" : "Roulement ADC"),
        departure:minuteToSncf(dateStr,r.departureMinute),
        arrival:minuteToSncf(dateStr,r.arrivalMinute),
        duration:Math.max(0,(Number(r.arrivalMinute)-Number(r.departureMinute))*60),
        transfers:0,
        status:null,
        sections:[{
          type:"public_transport",
          mode:"taxi",
          from:r.originName || r.originCode,
          to:r.destinationName || r.destinationCode,
          departure:minuteToSncf(dateStr,r.departureMinute),
          arrival:minuteToSncf(dateStr,r.arrivalMinute),
          display:{commercial_mode:`Taxi ${r.setId === "asct" ? "ASCT" : "ADC"}`,network:"Roulement",label:r.js,direction:r.destinationName,headsign:r.js,train_number:""}
        }]
      }));
  };

  openRosterDirect = function(page,y,js,pagePath){
    rosterCurrentMatches=[{page:Number(page),y:Number(y),js:String(js||""),pagePath:String(pagePath||"")}];
    rosterCurrentMatch=0;
    $("roster-modal").classList.remove("hidden");
    $("roster-modal-title").textContent=`JS ${js}`;
    $("roster-modal-subtitle").textContent="Roulement";
    renderRosterMatchTabs();
    showRosterMatch(0);
  };

  const originalRenderJourneys = renderJourneys;
  renderJourneys = function(items){
    originalRenderJourneys(items);
    document.querySelectorAll(".journey").forEach(card => {
      const j = items[Number(card.dataset.i)];
      if(!j || j.transportType !== "taxi") return;
      const agent = j.taxiAgentType || "ADC";
      const badge = card.querySelector(".journey-badge");
      if(badge) badge.textContent = `🚕 Taxi ${agent}`;
      const meta = card.querySelector(".journey-meta");
      if(meta && !meta.textContent.includes(`Taxi ${agent}`)) meta.textContent += ` • Taxi ${agent}`;
      card.querySelectorAll(".section .train").forEach(el => {
        el.textContent = `Taxi ${agent} · JS ${j.rosterJS || ""}`;
      });
    });
    const asct = items.filter(x => x?.transportType === "taxi" && x?.taxiAgentType === "ASCT").length;
    const adc = items.filter(x => x?.transportType === "taxi" && x?.taxiAgentType === "ADC").length;
    const status = document.getElementById("status");
    if(status && (asct || adc) && !status.textContent.includes("taxi ASCT")) status.textContent += ` • ${adc} taxi ADC • ${asct} taxi ASCT`;
  };

  const originalShowRosterMatch = showRosterMatch;
  showRosterMatch = function(i){
    originalShowRosterMatch(i);
    const img = document.getElementById("roster-page-image");
    if(img) img.alt = img.alt.replace(/Orcades/gi,"roulement");
  };
})();
