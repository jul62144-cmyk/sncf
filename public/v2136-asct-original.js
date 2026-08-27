/* Trajets HDF v2.14.0 — pages originales ASCT + périodes de roulement administrables. */
(() => {
  const fallbackOpenRosterDirect = openRosterDirect;

  openRosterDirect = function(page, y, js, pagePath){
    const p = Number(page);
    const isAsct = String(pagePath || '').includes('/roster-pages/asct/');
    const originalPage = window.ASCT_ORIGINAL_PAGES?.[p];

    if(!isAsct || !originalPage){
      return fallbackOpenRosterDirect(page, y, js, pagePath);
    }

    rosterCurrentMatches = [{page:p,y:Number(y),js:String(js||''),pagePath:originalPage}];
    rosterCurrentMatch = 0;
    $('roster-modal').classList.remove('hidden');
    $('roster-modal-title').textContent = `JS ${js}`;
    $('roster-modal-subtitle').textContent = 'Roulement ASCT · page originale';
    renderRosterMatchTabs();
    showRosterMatch(0);
  };

  // Affiche la version réellement chargée sans devoir toucher au gabarit HTML.
  const badge=document.querySelector('.brand-title span');
  if(badge) badge.textContent='v2.14.0';

  // Les périodes importées depuis /admin.html sont fusionnées avec les données intégrées.
  const periodCache=new Map();
  async function activePeriod(){
    const date=($('date')?.value||$('board-date')?.value||'').trim();
    if(!date)return null;
    if(periodCache.has(date))return periodCache.get(date);
    const p=fetch(`/api/roster-period?date=${encodeURIComponent(date)}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    periodCache.set(date,p);return p;
  }

  if(typeof loadRosterTechnicalTrains==='function'){
    const baseTech=loadRosterTechnicalTrains;
    loadRosterTechnicalTrains=async function(){
      const [base,period]=await Promise.all([baseTech(),activePeriod()]);
      if(!period||!Array.isArray(period.technicalTrains)||!period.technicalTrains.length)return base;
      const extra=period.technicalTrains.map(r=>({...r,validFromSet:r.validFromSet||period.validFrom,validToSet:r.validToSet||period.validTo,setId:r.setId||period.id,setLabel:r.setLabel||period.label}));
      return {...base,technicalTrains:[...(base?.technicalTrains||[]),...extra]};
    };
  }

  if(typeof loadRosterTaxis==='function'){
    const baseTaxi=loadRosterTaxis;
    loadRosterTaxis=async function(){
      const [base,period]=await Promise.all([baseTaxi(),activePeriod()]);
      if(!period||!Array.isArray(period.taxis)||!period.taxis.length)return base;
      const extra=period.taxis.map(r=>({...r,validFromSet:r.validFromSet||period.validFrom,validToSet:r.validToSet||period.validTo,setId:r.setId||period.id,setLabel:r.setLabel||period.label}));
      return {...base,taxis:[...(base?.taxis||[]),...extra]};
    };
  }

  $('date')?.addEventListener('change',()=>periodCache.clear());
  $('board-date')?.addEventListener('change',()=>periodCache.clear());
})();
