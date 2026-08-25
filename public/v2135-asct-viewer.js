/* Trajets HDF v2.13.5 — visualiseur ASCT reconstitué.
   Le dépôt ne contient pas les images originales /roster-pages/asct/*.webp.
   Cette vue reconstruit la page ASCT à partir des données intégrées. */
(() => {
  let asctCompactPromise = null;

  function loadAsctCompact(){
    if(!asctCompactPromise){
      asctCompactPromise = fetch('/asct-compact.json',{cache:'no-store'}).then(r=>{
        if(!r.ok) throw new Error('Données du roulement ASCT indisponibles');
        return r.json();
      });
    }
    return asctCompactPromise;
  }

  function esc(s){
    return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function hhmm(min){
    min = Number(min||0);
    const h = Math.floor((min%1440)/60);
    const m = min%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function expandRows(payload){
    const keys = payload?.keys || [];
    return (payload?.rows || []).map(row=>{
      const r={}; keys.forEach((k,i)=>r[k]=row[i]); return r;
    });
  }

  function buildAsctSvg(payload,page,targetJs){
    const names = payload?.names || {};
    const rows = expandRows(payload).filter(r=>Number(r.page)===Number(page));
    const uniq = [];
    const seen = new Set();
    for(const r of rows){
      const k = `${r.js}|${r.y}|${r.originCode}|${r.destinationCode}|${r.departureMinute}|${r.arrivalMinute}`;
      if(!seen.has(k)){seen.add(k);uniq.push(r);}
    }

    const W=1600,H=1000,left=180,right=45,top=105,bottom=70;
    const gridW=W-left-right;
    const xFor=m=>left+(Math.max(0,Math.min(1440,Number(m||0)))/1440)*gridW;
    const yFor=r=>top+Math.max(0,Math.min(1,Number(r.y||0)))*(H-top-bottom);

    let grid='';
    for(let h=0;h<=24;h++){
      const x=left+h/24*gridW;
      grid += `<line x1="${x}" y1="${top}" x2="${x}" y2="${H-bottom}" stroke="#d7deea" stroke-width="1"/>`;
      if(h<24) grid += `<text x="${x+3}" y="82" font-size="18" fill="#52627a">${String(h).padStart(2,'0')}</text>`;
    }

    let content='';
    for(const r of uniq){
      const y=yFor(r), x1=xFor(r.departureMinute), x2=xFor(r.arrivalMinute);
      const active=String(r.js)===String(targetJs);
      const o=names[r.originCode]||r.originCode||'';
      const d=names[r.destinationCode]||r.destinationCode||'';
      content += `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" stroke="${active?'#b9d4ff':'#eef2f7'}" stroke-width="${active?9:2}"/>`;
      content += `<text x="18" y="${y+7}" font-size="22" font-weight="${active?'700':'500'}" fill="#0b1f3a">${esc(r.js)}</text>`;
      content += `<line x1="${x1}" y1="${y}" x2="${Math.max(x1+8,x2)}" y2="${y}" stroke="#1f6feb" stroke-width="10" stroke-linecap="round"/>`;
      content += `<circle cx="${x1}" cy="${y}" r="6" fill="#0b1f3a"/><circle cx="${Math.max(x1+8,x2)}" cy="${y}" r="6" fill="#0b1f3a"/>`;
      content += `<text x="${Math.min(W-430,x1+8)}" y="${y-12}" font-size="16" fill="#0b1f3a">TAXI ${esc(o)} → ${esc(d)} · ${hhmm(r.departureMinute)}–${hhmm(r.arrivalMinute)}</text>`;
    }

    if(!uniq.length){
      content = `<text x="${left}" y="220" font-size="28" fill="#8b1e1e">Aucune donnée ASCT trouvée pour la page ${page}</text>`;
    }

    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="100%" height="100%" fill="white"/>
      <text x="18" y="42" font-size="30" font-weight="700" fill="#071a39">Roulement ASCT — page ${page}</text>
      <text x="18" y="70" font-size="17" fill="#61708a">Vue reconstituée à partir des données du roulement intégrées à l’application</text>
      ${grid}${content}
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }

  const previousOpenRosterDirect = openRosterDirect;
  openRosterDirect = async function(page,y,js,pagePath){
    const isAsct = String(pagePath||'').includes('/roster-pages/asct/');
    if(!isAsct) return previousOpenRosterDirect(page,y,js,pagePath);

    rosterCurrentMatches=[{page:Number(page),y:Number(y),js:String(js||''),pagePath:''}];
    rosterCurrentMatch=0;
    $('roster-modal').classList.remove('hidden');
    $('roster-modal-title').textContent=`JS ${js}`;
    $('roster-modal-subtitle').textContent='Chargement du roulement ASCT…';
    $('roster-match-tabs').innerHTML='';
    $('roster-match-info').textContent='';
    $('roster-page-image').removeAttribute('src');
    $('roster-highlight').style.display='none';

    try{
      const payload = await loadAsctCompact();
      rosterCurrentMatches=[{
        page:Number(page),
        y:Number(y),
        js:String(js||''),
        pagePath:buildAsctSvg(payload,page,js)
      }];
      $('roster-modal-subtitle').textContent='Roulement ASCT';
      renderRosterMatchTabs();
      showRosterMatch(0);
    }catch(e){
      $('roster-modal-subtitle').textContent=e.message;
    }
  };
})();
