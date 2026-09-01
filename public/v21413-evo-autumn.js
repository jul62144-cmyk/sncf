// v2.14.13 - EVO RLT ADC 31/08/2026 -> 12/12/2026
(function(){
  const base=typeof loadRosterTechnicalTrains==='function'?loadRosterTechnicalTrains:null;
  if(!base)return;
  let cache=null;
  const expand=row=>{
    const [trainNumber,js,page,y,departureMinute,arrivalMinute,days,validUntil,validFrom,exceptDates]=row;
    const even=Number(trainNumber)%2===0;
    const six=String(trainNumber).startsWith('6');
    const originCode=six?(even?'LE':'LE-RT'):(even?'LE':'LSA');
    const destinationCode=six?(even?'LE-RT':'LE'):(even?'LSA':'LE');
    return {trainNumber,js,page,y,pagePath:`/roster-pages/autumn/page-${String(page).padStart(2,'0')}.webp`,setId:'autumn',setLabel:'RLT ADC 31/08-12/12',validFromSet:'2026-08-31',validToSet:'2026-12-12',originCode,destinationCode,departureMinute,arrivalMinute,days,exceptDays:[],validUntil,validFrom,exceptDates:exceptDates||[],isRosterTechnical:true,isRosterEvo:true,timeEstimatedFromGraph:false};
  };
  async function autumn(){
    if(cache)return cache;
    const parts=await Promise.all([1,2,3,4].map(i=>fetch(`/roster-evo-autumn-${i}.json`,{cache:'no-store'}).then(r=>r.ok?r.json():{rows:[]}).catch(()=>({rows:[]}))));
    cache=parts.flatMap(p=>(p.rows||[]).map(expand));
    return cache;
  }
  loadRosterTechnicalTrains=async function(){
    const [old,extra]=await Promise.all([base(),autumn()]);
    const all=[...(old?.technicalTrains||[]),...extra];
    const seen=new Set();
    return {...(old||{}),technicalTrains:all.filter(r=>{const k=[r.trainNumber,r.js,r.page,r.y,r.validFromSet].join('|');if(seen.has(k))return false;seen.add(k);return true;})};
  };
})();
