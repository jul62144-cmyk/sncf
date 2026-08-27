const $=id=>document.getElementById(id);
let packageData={technicalTrains:[],taxis:[],rosterIndex:[]};
let pdfSummary=null;

function headers(){return {"Content-Type":"application/json","X-Admin-Password":$("pwd").value};}
function status(msg){$("status").textContent=msg;}
function counts(){
  $("jsCount").textContent=`JS : ${pdfSummary?.js?.length||0}`;
  $("trainCount").textContent=`Trains 6 chiffres : ${pdfSummary?.trains?.length||0}`;
  $("taxiCount").textContent=`TAXI : ${pdfSummary?.taxiCount||0}`;
}

async function loadPeriods(){
  status("Chargement…");
  const r=await fetch("/api/admin/rosters",{headers:{"X-Admin-Password":$("pwd").value}});
  const data=await r.json();
  if(!r.ok){status(data.error||"Erreur");return;}
  const host=$("periods"); host.innerHTML="";
  if(!data.length){host.textContent="Aucune période enregistrée.";status("Aucune période.");return;}
  for(const p of data){
    const d=document.createElement("div");d.className="period";
    d.innerHTML=`<strong>${p.label}</strong> <span class="muted">(${p.id})</span><br><span class="muted">${p.validFrom} → ${p.validTo}</span><div class="counts"><span class="pill">W : ${p.counts.technicalTrains}</span><span class="pill">Taxis : ${p.counts.taxis}</span><span class="pill">Index : ${p.counts.rosterIndex}</span></div><p><button class="danger" data-del="${p.id}">Supprimer</button></p>`;
    host.appendChild(d);
  }
  host.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(!confirm(`Supprimer ${b.dataset.del} ?`))return;
    const r=await fetch(`/api/admin/rosters/${encodeURIComponent(b.dataset.del)}`,{method:"DELETE",headers:{"X-Admin-Password":$("pwd").value}});
    const j=await r.json(); status(r.ok?"Période supprimée.":(j.error||"Erreur")); if(r.ok)loadPeriods();
  });
  status(`${data.length} période(s) chargée(s).`);
}

$("jsonfile").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const j=JSON.parse(await f.text());
    packageData={technicalTrains:Array.isArray(j.technicalTrains)?j.technicalTrains:[],taxis:Array.isArray(j.taxis)?j.taxis:[],rosterIndex:Array.isArray(j.rosterIndex)?j.rosterIndex:[]};
    $("preview").value=`Package ${f.name}\nTrains techniques/W : ${packageData.technicalTrains.length}\nTaxis : ${packageData.taxis.length}\nIndex roulement : ${packageData.rosterIndex.length}`;
    status("Package JSON chargé.");
  }catch(err){status("JSON invalide : "+err.message);}
});

$("analyze").onclick=async()=>{
  const f=$("pdffile").files[0]; if(!f){status("Choisis d'abord un PDF.");return;}
  status("Analyse du PDF dans le navigateur…");
  try{
    const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
    const doc=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
    const js=new Set(),trains=new Set();let taxiCount=0;const pageStats=[];
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n);const tc=await page.getTextContent();
      const text=tc.items.map(i=>i.str).join(" ");
      const jsm=text.match(/\b[A-Z]\d{3}\b/g)||[]; jsm.forEach(x=>js.add(x));
      const tm=text.match(/\b\d{6}\b/g)||[]; tm.forEach(x=>trains.add(x));
      const taxis=(text.match(/\bTAXI\b/gi)||[]).length; taxiCount+=taxis;
      if(jsm.length||tm.length||taxis) pageStats.push({page:n,js:[...new Set(jsm)],trains:[...new Set(tm)],taxis});
    }
    pdfSummary={file:f.name,pages:doc.numPages,js:[...js].sort(),trains:[...trains].sort(),taxiCount,pageStats};
    counts();
    $("preview").value=`${f.name} — ${doc.numPages} pages\nJS détectées : ${pdfSummary.js.length}\nTrains à 6 chiffres : ${pdfSummary.trains.length}\nMentions TAXI : ${taxiCount}\n\nPages utiles :\n`+pageStats.slice(0,80).map(p=>`p.${p.page}  JS ${p.js.join(", ")||"-"}  trains ${p.trains.length}  TAXI ${p.taxis}`).join("\n");
    status("Analyse terminée. Le PDF sert de contrôle; le package JSON contient les données réellement importées.");
  }catch(err){status("Analyse PDF impossible : "+err.message);}
};

$("save").onclick=async()=>{
  const body={id:$("id").value.trim(),label:$("label").value.trim(),validFrom:$("from").value,validTo:$("to").value,technicalTrains:packageData.technicalTrains,taxis:packageData.taxis,rosterIndex:packageData.rosterIndex,sourceFile:$("pdffile").files[0]?.name||$("jsonfile").files[0]?.name||"",sourceSummary:pdfSummary?{pages:pdfSummary.pages,jsCount:pdfSummary.js.length,trainCount:pdfSummary.trains.length,taxiCount:pdfSummary.taxiCount}:null};
  status("Enregistrement…");
  const r=await fetch("/api/admin/rosters",{method:"POST",headers:headers(),body:JSON.stringify(body)});const j=await r.json();
  if(!r.ok){status(j.error||"Erreur d'enregistrement");return;}
  status(`Période enregistrée : ${j.counts.technicalTrains} W, ${j.counts.taxis} taxis.`);loadPeriods();
};

$("load").onclick=loadPeriods;