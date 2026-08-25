/* Trajets HDF v2.13.6 — pages originales du roulement ASCT.
   Si la page PDF d'origine est intégrée, elle est utilisée à la place
   de la vue reconstituée de la v2.13.5. */
(() => {
  const fallbackOpenRosterDirect = openRosterDirect;

  openRosterDirect = function(page, y, js, pagePath){
    const p = Number(page);
    const isAsct = String(pagePath || '').includes('/roster-pages/asct/');
    const originalPage = window.ASCT_ORIGINAL_PAGES?.[p];

    if(!isAsct || !originalPage){
      return fallbackOpenRosterDirect(page, y, js, pagePath);
    }

    rosterCurrentMatches = [{
      page: p,
      y: Number(y),
      js: String(js || ''),
      pagePath: originalPage
    }];
    rosterCurrentMatch = 0;

    $('roster-modal').classList.remove('hidden');
    $('roster-modal-title').textContent = `JS ${js}`;
    $('roster-modal-subtitle').textContent = 'Roulement ASCT · page originale';
    renderRosterMatchTabs();
    showRosterMatch(0);
  };
})();
