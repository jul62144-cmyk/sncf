// v2.13.7 - robust Lille-Flandres board + W fallback
// Applied after server.js is loaded. It replaces only /api/departures and /api/arrivals.

const TCHOO = "https://api.tchoo.net";

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

async function sncfBoard(stopArea,datetime,board){
  const uic=uicFromStopArea(stopArea);
  const candidates=[stopArea];
  if(uic){
    candidates.push(`stop_area:SNCF:${uic}`,`stop_area:OCE:${uic}`,`stop_area:OCE${uic}`);
  }
  let lastErr=null;
  for(const id of [...new Set(candidates)]){
    try{
      const url=new URL(`https://api.sncf.com/v1/coverage/sncf/stop_areas/${encodeURIComponent(id)}/${board}`);
      url.searchParams.set("from_datetime",datetime);
      url.searchParams.set("duration",String(secsToEnd(datetime)));
      url.searchParams.set("count","250");
      url.searchParams.set("depth","3");
      const r=await fetch(url,{headers:basicHeaders()});
      if(!r.ok){lastErr=new Error(`SNCF ${r.status}`);continue;}
      const data=await r.json();
      const src=board==="arrivals"?(data.arrivals||[]):(data.departures||[]);
      return src.map(x=>{
        const info=x.display_informations||{};
        const sdt=x.stop_date_time||{};
        return {
          type:board==="arrivals"?"arrival":"departure",source:"api-sncf",transportType:"train",
          datetime:board==="arrivals"?sdt.arrival_date_time:sdt.departure_date_time,
          baseDatetime:board==="arrivals"?sdt.base_arrival_date_time:sdt.base_departure_date_time,
          stop:x.stop_point?.name||"",origin:board==="arrivals"?(info.direction||""):"",
          direction:info.direction||"",headsign:info.headsign||"",label:info.label||"",
          trainNumber:trainNo(info.headsign||info.code||info.label),commercialMode:info.commercial_mode||"",
          network:info.network||"",status:sdt.data_freshness||null,
          platform:x.stop_point?.platform_code||x.stop_point?.platform||null
        };
      });
    }catch(e){lastErr=e;}
  }
  if(lastErr) console.warn("SNCF board fallback:",lastErr.message);
  return [];
}

async function tchooBoard(stopArea,datetime,board){
  const uic=uicFromStopArea(stopArea);
  if(!uic)return [];
  try{
    const r=await fetch(`${TCHOO}/api/carto.php?action=deparr&uic=${encodeURIComponent(uic)}`,{headers:{Accept:"application/json, text/plain, */*","User-Agent":"Trajets-HDF/2.13.7",Referer:"https://carto.tchoo.net/"}});
    if(!r.ok)return [];
    const data=await r.json();
    const src=board==="arrivals"?(data.arrivals||[]):(data.departures||[]);
    return src.map(x=>{
      const n=trainNo(x.num);
      if(!n)return null;
      const steps=Array.isArray(x.etapes)?x.etapes:[];
      const origin=String(x.origine_localite||x.gare_origine||stepName(steps[0])||"").trim();
      const destination=String(stepName(steps.at(-1))||x.destination||x.localite||"").trim();
      const num=Number(n);
      const isW=(num>=600000&&num<=999999);
      return {
        type:board==="arrivals"?"arrival":"departure",source:"carto-tchoo",transportType:"train",
        datetime:combine(datetime,board==="arrivals"?(x.debut||x.fin):(x.fin||x.debut)),baseDatetime:null,
        stop:"",origin,direction:destination,headsign:destination,label:n,trainNumber:n,
        commercialMode:isW?"W":"Train",network:isW?"Acheminement":"",status:null,
        platform:x.platform?String(x.platform):null,isW
      };
    }).filter(Boolean);
  }catch(e){console.warn("Tchoo board fallback:",e.message);return [];}
}

function dedupe(rows){
  const seen=new Set();
  return rows.filter(r=>{const k=`${r.trainNumber}|${r.datetime}|${r.type}`;if(seen.has(k))return false;seen.add(k);return true;})
    .sort((a,b)=>String(a.datetime||"").localeCompare(String(b.datetime||"")));
}

module.exports=function patchBoards(app){
  const stack=app?._router?.stack||[];
  for(const layer of stack){
    const path=layer?.route?.path;
    if(path!=="/api/departures"&&path!=="/api/arrivals")continue;
    const board=path.endsWith("arrivals")?"arrivals":"departures";
    const handler=async(req,res)=>{
      try{
        const {stopArea,datetime}=req.query;
        if(!stopArea)return res.status(400).json({error:"Gare obligatoire."});
        const [sncf,tchoo]=await Promise.all([sncfBoard(stopArea,datetime,board),tchooBoard(stopArea,datetime,board)]);
        // Tchoo is also a safety net when SNCF cannot resolve Lille-Flandres.
        // Merge both, keeping W 600/700/900xxx visible in station boards.
        res.json(dedupe([...sncf,...tchoo]));
      }catch(e){res.status(500).json({error:e.message});}
    };
    layer.route.stack.forEach(s=>{s.handle=handler;});
  }
};
