// v2.14.1 - robust boards + strict W 700xxx + LE/LSA direction + platform restoration
// Applied after server.js is loaded. It replaces only /api/departures and /api/arrivals.

const TCHOO = "https://api.tchoo.net";
const PLATFORM_MIN_CONFIDENCE = 50;

function basicHeaders(){
  const token=process.env.SNCF_API_TOKEN;
  return token ? {Authorization:`Basic ${Buffer.from(`${token}:`).toString("base64")}`} : {};
}
function dtDate(v){const m=String(v||"").match(/^(\d{8})T/);return m?m[1]:"";}
function secsToEnd(v){const m=String(v||"").match(/^\d{8}T(\d{2})(\d{2})(\d{2})/);if(!m)return 86400;return Math.max(60,86400-(+m[1]*3600+ +m[2]*60+ +m[3]));}
function uicFromStopArea(v){const m=String(v||"").match(/(\d{8})/);return m?m[1]:null;}
function trainNo(v){const m=String(v||"").match(/\b(\d{4,6})\b/);return m?m[1]:String(v||"").trim();}
function combine(dateTime,clock){const d=dtDate(dateTime);const m=String(clock||"").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);return d&&m?`${d}T${String(m[1]).padStart(2,"0")}${m[2]}${m[3]||"00"}`:dateTime||null;}
function stepName(s){return String(s?.localite||s?.gare||s?.station||s?.name||s?.libelle||"").trim();}
function isBoardW(n){const num=Number(n);return Number.isInteger(num)&&num>=700000&&num<=799999;}
function normPlace(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();}
function isLSA(v){const n=normPlace(v);return n==="LSA"||n.startsWith("LSA ")||n==="LILLE SA"||n.startsWith("LILLE SA ")||n.includes("LILLE SAINT SAUVEUR")||n.includes("LILLE ST SAUVEUR")||n.includes("SAINT SAUVEUR");}

async function getJson(url,headers={}){
  const r=await fetch(url,{headers:{Accept:"application/json, text/plain, */*","User-Agent":"Trajets-HDF/2.14.1",Referer:"https://carto.tchoo.net/",...headers}});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function sncfBoard(stopArea,datetime,board){
  const uic=uicFromStopArea(stopArea);
  const candidates=[stopArea];
  if(uic)candidates.push(`stop_area:SNCF:${uic}`,`stop_area:OCE:${uic}`,`stop_area:OCE${uic}`);
  let lastErr=null;
  for(const id of [...new Set(candidates)]){
    try{
      const url=new URL(`https://api.sncf.com/v1/coverage/sncf/stop_areas/${encodeURIComponent(id)}/${board}`);
      url.searchParams.set("from_datetime",datetime);url.searchParams.set("duration",String(secsToEnd(datetime)));url.searchParams.set("count","250");url.searchParams.set("depth","3");
      const r=await fetch(url,{headers:basicHeaders()});
      if(!r.ok){lastErr=new Error(`SNCF ${r.status}`);continue;}
      const data=await r.json();
      const src=board==="arrivals"?(data.arrivals||[]):(data.departures||[]);
      return src.map(x=>{
        const info=x.display_informations||{},sdt=x.stop_date_time||{};
        const platform=x.stop_point?.platform_code||x.stop_point?.platform||x.stop_point?.codes?.find(c=>/platform|track|quai|voie/i.test(c.type||c.name||""))?.value||null;
        return {type:board==="arrivals"?"arrival":"departure",source:"api-sncf",transportType:"train",datetime:board==="arrivals"?sdt.arrival_date_time:sdt.departure_date_time,baseDatetime:board==="arrivals"?sdt.base_arrival_date_time:sdt.base_departure_date_time,stop:x.stop_point?.name||"",origin:board==="arrivals"?(info.direction||""):"",direction:info.direction||"",headsign:info.headsign||"",label:info.label||"",trainNumber:trainNo(info.headsign||info.code||info.label),commercialMode:info.commercial_mode||"",network:info.network||"",status:sdt.data_freshness||null,platform:platform?String(platform):null,platformEstimated:false,platformConfidence:platform?100:null,platformSource:platform?"sncf-official":null};
      });
    }catch(e){lastErr=e;}
  }
  if(lastErr)console.warn("SNCF board fallback:",lastErr.message);
  return [];
}

async function guessPlatform(uic,n){
  try{
    const data=await getJson(`${TCHOO}/api/guess_my_platform.php?uic=${encodeURIComponent(uic)}&num=${encodeURIComponent(n)}`);
    const first=Array.isArray(data)?data[0]:null;
    if(first?.platform&&Number(first.percentage)>=PLATFORM_MIN_CONFIDENCE)return {platform:String(first.platform),platformEstimated:true,platformConfidence:Number(first.percentage),platformSource:"tchoo-estimate"};
  }catch(e){}
  return null;
}

async function tchooBoard(stopArea,datetime,board){
  const uic=uicFromStopArea(stopArea);if(!uic)return [];
  try{
    const data=await getJson(`${TCHOO}/api/carto.php?action=deparr&uic=${encodeURIComponent(uic)}`);
    const src=board==="arrivals"?(data.arrivals||[]):(data.departures||[]);
    let rows=src.map(x=>{
      const n=trainNo(x.num);if(!n)return null;
      const steps=Array.isArray(x.etapes)?x.etapes:[];
      let origin=String(x.origine_localite||x.gare_origine||stepName(steps[0])||"").trim();
      let destination=String(stepName(steps.at(-1))||x.destination||x.localite||"").trim();
      const isW=isBoardW(n);
      if(isW&&uic==="87286005"&&[origin,destination,x.localite,x.origine_localite,x.gare_origine,x.destination,...steps.map(stepName)].some(isLSA)){
        if(board==="departures"){origin="Lille Flandres";destination="Lille Saint-Sauveur";}else{origin="Lille Saint-Sauveur";destination="Lille Flandres";}
      }
      const platform=x.platform?String(x.platform):null;
      return {type:board==="arrivals"?"arrival":"departure",source:"carto-tchoo",transportType:"train",datetime:combine(datetime,board==="arrivals"?(x.debut||x.fin):(x.fin||x.debut)),baseDatetime:null,stop:"",origin,direction:destination,headsign:destination,label:n,trainNumber:n,commercialMode:isW?"W":"Train",network:isW?"Acheminement":"",status:null,platform,platformEstimated:false,platformConfidence:platform?100:null,platformSource:platform?"tchoo-official":null,isW};
    }).filter(Boolean);

    // Si Carto ne publie pas encore de voie officielle, demander son estimation.
    // Limitation de concurrence pour ne pas surcharger l'API.
    const missing=rows.filter(x=>!x.platform).slice(0,80);
    for(let i=0;i<missing.length;i+=8){
      const batch=missing.slice(i,i+8);
      const guesses=await Promise.all(batch.map(x=>guessPlatform(uic,x.trainNumber)));
      batch.forEach((x,j)=>{if(guesses[j])Object.assign(x,guesses[j]);});
    }
    return rows;
  }catch(e){console.warn("Tchoo board fallback:",e.message);return [];}
}

function dedupe(rows){const seen=new Set();return rows.filter(r=>{const k=`${r.trainNumber}|${r.datetime}|${r.type}`;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>String(a.datetime||"").localeCompare(String(b.datetime||"")));}

module.exports=function patchBoards(app){
  const stack=app?._router?.stack||[];
  for(const layer of stack){
    const path=layer?.route?.path;if(path!=="/api/departures"&&path!=="/api/arrivals")continue;
    const board=path.endsWith("arrivals")?"arrivals":"departures";
    const handler=async(req,res)=>{
      try{
        const {stopArea,datetime}=req.query;if(!stopArea)return res.status(400).json({error:"Gare obligatoire."});
        const [sncf,tchoo]=await Promise.all([sncfBoard(stopArea,datetime,board),tchooBoard(stopArea,datetime,board)]);
        const byTrain=new Map(tchoo.map(r=>[r.trainNumber,r]));
        // SNCF reste la source du train commercial, mais on complète sa voie avec Carto Tchoo
        // (officielle en priorité, sinon estimée) lorsqu'elle manque dans la réponse SNCF.
        const enrichedSncf=sncf.map(r=>{
          if(r.platform)return r;
          const t=byTrain.get(r.trainNumber);if(!t?.platform)return r;
          return {...r,platform:t.platform,platformEstimated:Boolean(t.platformEstimated),platformConfidence:t.platformConfidence||null,platformSource:t.platformSource||null,tchoo:true};
        });
        const merged=enrichedSncf.length?[...enrichedSncf,...tchoo.filter(r=>r.isW&&!enrichedSncf.some(s=>s.trainNumber===r.trainNumber&&s.datetime===r.datetime))]:tchoo;
        res.json(dedupe(merged));
      }catch(e){res.status(500).json({error:e.message});}
    };
    layer.route.stack.forEach(s=>{s.handle=handler;});
  }
};
