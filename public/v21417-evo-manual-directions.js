// v2.14.17 - sens EVO confirmes manuellement depuis le graphique RLT
(function(){
  const badge=document.querySelector('.brand-title span');if(badge)badge.textContent='v2.14.17';
  const base=typeof loadRosterTechnicalTrains==='function'?loadRosterTechnicalTrains:null;
  if(!base)return;

  // Confirmations utilisateur sur lecture du graphique RLT.
  // Ces valeurs sont prioritaires sur toute lecture automatique precedente.
  const confirmed={
    '943265':['LE','LSA'],
    '642953':['LE-RT','LE'],
    '942251':['LSA','LE'],
    '642206':['LE','LE-RT'],
    '643219':['LE','LE-RT']
  };

  loadRosterTechnicalTrains=async function(){
    const data=await base();
    const rows=(data?.technicalTrains||[]).map(r=>{
      const dir=confirmed[String(r?.trainNumber||'')];
      if(!dir)return r;
      return {...r,originCode:dir[0],destinationCode:dir[1],directionConfirmedManually:true,directionFromRosterGraph:true};
    });
    return {...(data||{}),technicalTrains:rows};
  };
})();
