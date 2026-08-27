// v2.14.0 - merge admin-imported roster periods with the built-in roster data.
(function(){
  const periodCache=new Map();
  async function activePeriod(){
    const date=(document.getElementById("date")?.value||document.getElementById("board-date")?.value||"").trim();
    if(!date)return null;
    if(periodCache.has(date))return periodCache.get(date);
    const p=fetch(`/api/roster-period?date=${encodeURIComponent(date)}`,{cache:"no-store"})
      .then(r=>r.ok?r.json():null).catch(()=>null);
    periodCache.set(date,p);return p;
  }

  const originalTech=window.loadRosterTechnicalTrains;
  if(typeof originalTech==="function"){
    window.loadRosterTechnicalTrains=async function(){
      const [base,period]=await Promise.all([originalTech(),activePeriod()]);
      if(!period||!Array.isArray(period.technicalTrains)||!period.technicalTrains.length)return base;
      return {...base,technicalTrains:[...(base?.technicalTrains||[]),...period.technicalTrains.map(r=>({...r,validFromSet:r.validFromSet||period.validFrom,validToSet:r.validToSet||period.validTo,setId:r.setId||period.id,setLabel:r.setLabel||period.label}))]};
    };
  }

  const originalTaxis=window.loadRosterTaxis;
  if(typeof originalTaxis==="function"){
    window.loadRosterTaxis=async function(){
      const [base,period]=await Promise.all([originalTaxis(),activePeriod()]);
      if(!period||!Array.isArray(period.taxis)||!period.taxis.length)return base;
      return {...base,taxis:[...(base?.taxis||[]),...period.taxis.map(r=>({...r,validFromSet:r.validFromSet||period.validFrom,validToSet:r.validToSet||period.validTo,setId:r.setId||period.id,setLabel:r.setLabel||period.label}))]};
    };
  }

  // Clear the date-specific period cache when the date changes.
  document.getElementById("date")?.addEventListener("change",()=>periodCache.clear());
  document.getElementById("board-date")?.addEventListener("change",()=>periodCache.clear());
})();