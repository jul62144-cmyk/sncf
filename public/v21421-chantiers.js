// v2.14.21 - distingue les chantiers operationnels (ex. LNS, LNS DT, LNS TR)
(function(){
  const badge=document.querySelector('.brand-title span');if(badge)badge.textContent='v2.14.21';

  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const canonical=v=>{
    const s=norm(v);
    if(s==='LNS DT'||s==='LNS DP'||s==='LNS DEPOT')return 'LNS-DT';
    if(s==='LNS TR'||s==='LNS TRIAGE')return 'LNS-TR';
    if(s==='LNS BV'||s==='LNS GARE')return 'LNS-BV';
    if(s==='LNS')return 'LNS';
    if(s==='LE RT'||s==='LERT'||s==='GARAGES TER')return 'LE-RT';
    if(s==='LE')return 'LE';
    if(s==='LSA')return 'LSA';
    return String(v||'').toUpperCase();
  };
  const label=code=>({
    'LNS':'Lens (LNS)',
    'LNS-BV':'Lens gare (LNS BV)',
    'LNS-DT':'Lens Dépôt (LNS DT)',
    'LNS-TR':'Lens Triage (LNS TR)',
    'LE':'Lille Flandres (LE)',
    'LE-RT':'Garages TER (LE RT)',
    'LSA':'Lille Saint-Sauveur (LSA)'
  })[canonical(code)]||String(code||'');
  const baseStationName=code=>{
    const c=canonical(code);
    if(c.startsWith('LNS'))return 'Lens';
    if(c==='LE')return 'Lille Flandres';
    if(c==='LE-RT')return 'Garages TER';
    if(c==='LSA')return 'Lille Saint-Sauveur';
    return '';
  };
  const codeFromRow=(r,side)=>canonical(r?.[side+'Code']||r?.[side+'Raw']||r?.[side+'Name']||'');
  const minuteFromSncf=v=>{const m=String(v||'').match(/T(\d{2})(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;};

  let lastTaxis=[];
  let lastTech=[];

  if(typeof loadRosterTaxis==='function'){
    const base=loadRosterTaxis;
    loadRosterTaxis=async function(){
      const data=await base();
      const taxis=(data?.taxis||[]).map(r=>{
        const o=codeFromRow(r,'origin'),d=codeFromRow(r,'destination');
        return {...r,
          originCode:o||r.originCode,destinationCode:d||r.destinationCode,
          originRaw:r.originRaw||o,destinationRaw:r.destinationRaw||d,
          // On garde le nom de gare principal pour que le tableau Lens regroupe tous les chantiers.
          originName:baseStationName(o)||r.originName,
          destinationName:label(d)||r.destinationName,
          originChantier:o,destinationChantier:d,
          originChantierLabel:label(o),destinationChantierLabel:label(d)
        };
      });
      lastTaxis=taxis;
      return {...(data||{}),taxis};
    };
  }

  if(typeof loadRosterTechnicalTrains==='function'){
    const base=loadRosterTechnicalTrains;
    loadRosterTechnicalTrains=async function(){
      const data=await base();
      const technicalTrains=(data?.technicalTrains||[]).map(r=>{
        const o=codeFromRow(r,'origin'),d=codeFromRow(r,'destination');
        return {...r,originCode:o||r.originCode,destinationCode:d||r.destinationCode,originChantier:o,destinationChantier:d,originChantierLabel:label(o),destinationChantierLabel:label(d)};
      });
      lastTech=technicalTrains;
      return {...(data||{}),technicalTrains};
    };
  }

  // Après le chargement du tableau, réinjecte le chantier exact dans les libellés affichés.
  if(typeof loadBoard==='function'){
    const baseLoadBoard=loadBoard;
    loadBoard=async function(){
      const out=await baseLoadBoard();
      try{
        for(const item of (state?.boardData||[])){
          const dep=minuteFromSncf(item.datetime||item.baseDatetime);
          if(item?.rosterTaxi){
            const row=lastTaxis.find(r=>String(r.js||'')===String(item.rosterJS||'')&&Number(r.departureMinute)===dep);
            if(row){
              item.origin=row.originChantierLabel||item.origin;item.stop=item.origin;
              item.direction=row.destinationChantierLabel||item.direction;item.headsign=item.direction;
              item.chantierOrigin=row.originChantier;item.chantierDestination=row.destinationChantier;
            }
          }else if(item?.isRosterEvo||item?.commercialMode==='EVO'){
            const row=lastTech.find(r=>String(r.trainNumber||'')===String(item.trainNumber||item.label||'')&&Number(r.departureMinute)===dep&&(!item.rosterJS||String(r.js||'')===String(item.rosterJS||'')));
            if(row){
              item.origin=row.originChantierLabel||item.origin;item.stop=item.origin;
              item.direction=row.destinationChantierLabel||item.direction;item.headsign=item.direction;
              item.chantierOrigin=row.originChantier;item.chantierDestination=row.destinationChantier;
            }
          }
        }
        if(typeof renderBoard==='function')renderBoard();
      }catch(e){console.warn('chantier labels',e);}
      return out;
    };
    const btn=document.getElementById('board-search-btn');
    if(btn)btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();loadBoard();},true);
  }
})();
