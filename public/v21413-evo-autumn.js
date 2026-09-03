// v2.14.18 - EVO RLT ADC 31/08/2026 -> 12/12/2026, sens graphique + confirmations manuelles
(function(){
  const badge=document.querySelector('.brand-title span');if(badge)badge.textContent='v2.14.18';
  const base=typeof loadRosterTechnicalTrains==='function'?loadRosterTechnicalTrains:null;
  if(!base)return;
  let cache=null;
  const key=row=>`${row[0]}|${row[2]}|${row[1]}|${Number(row[3]).toFixed(5)}`;
  const expand=(row,directions,manual)=>{
    const [trainNumber,js,page,y,departureMinute,arrivalMinute,days,validUntil,validFrom,exceptDates]=row;
    const dir=manual[String(trainNumber)]||directions[key(row)];
    // Priorité absolue aux confirmations manuelles. Aucun calcul pair/impair.
    if(!dir)return null;
    const [originCode,destinationCode]=dir;
    return {trainNumber,js,page,y,pagePath:`/roster-pages/autumn/page-${String(page).padStart(2,'0')}.webp`,setId:'autumn',setLabel:'RLT ADC 31/08-12/12',validFromSet:'2026-08-31',validToSet:'2026-12-12',originCode,destinationCode,departureMinute,arrivalMinute,days,exceptDays:[],validUntil,validFrom,exceptDates:exceptDates||[],isRosterTechnical:true,isRosterEvo:true,timeEstimatedFromGraph:false,directionFromRosterGraph:true,directionManualConfirmed:Boolean(manual[String(trainNumber)])};
  };
  async function autumn(){
    if(cache)return cache;
    const [parts,dirData,manualData]=await Promise.all([
      Promise.all([1,2,3,4].map(i=>fetch(`/roster-evo-autumn-${i}.json`,{cache:'no-store'}).then(r=>r.ok?r.json():{rows:[]}).catch(()=>({rows:[]})))),
      fetch('/roster-evo-autumn-directions.json',{cache:'no-store'}).then(r=>r.ok?r.json():{directions:{}}).catch(()=>({directions:{}})),
      fetch('/roster-evo-autumn-manual-overrides.json',{cache:'no-store'}).then(r=>r.ok?r.json():{directionsByTrain:{}}).catch(()=>({directionsByTrain:{}}))
    ]);
    const directions=dirData?.directions||{};
    const manual=manualData?.directionsByTrain||{};
    cache=parts.flatMap(p=>(p.rows||[]).map(row=>expand(row,directions,manual)).filter(Boolean));
    return cache;
  }
  loadRosterTechnicalTrains=async function(){const [old,extra]=await Promise.all([base(),autumn()]);const all=[...(old?.technicalTrains||[]),...extra],seen=new Set();return {...(old||{}),technicalTrains:all.filter(r=>{const k=[r.trainNumber,r.js,r.page,r.y,r.validFromSet].join('|');if(seen.has(k))return false;seen.add(k);return true;})};};
})();
