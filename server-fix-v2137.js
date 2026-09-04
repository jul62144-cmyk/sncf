// v2.14.5 - SNCF-only station boards. Carto Tchoo disabled.
// Applied after server.js is loaded. It replaces only /api/departures and /api/arrivals.

function basicHeaders(){
  const token=process.env.SNCF_API_TOKEN;
  return token ? {Authorization:`Basic ${Buffer.from(`${token}:`).toString("base64")}`} : {};
}
function secsToEnd(v){const m=String(v||"").match(/^\d{8}T(\d{2})(\d{2})(\d{2})/);if(!m)return 86400;return Math.max(60,86400-(+m[1]*3600+ +m[2]*60+ +m[3]));}
function uicFromStopArea(v){const m=String(v||"").match(/(\d{8})/);return m?m[1]:null;}
function trainNo(v){const m=String(v||"").match(/\b(\d{4,6})\b/);return m?m[1]:String(v||"").trim();}
function looksLikeMode(v){return /^(TER|TGV|TGV INOUI|TRAIN|CAR|BUS|COACH|INTERCITES|OUIGO)$/i.test(String(v||"").trim());}
function normPlace(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();}

function vehicleJourneyIdFromDeparture(x){
  const links=[...(Array.isArray(x?.links)?x.links:[]),...(Array.isArray(x?.stop_date_time?.links)?x.stop_date_time.links:[])];
  const link=links.find(l=>String(l?.type||l?.rel||"").toLowerCase().includes("vehicle_journey"));
  if(link?.id)return String(link.id);
  if(link?.href){const m=String(link.href).match(/\/vehicle_journeys\/([^/?#]+)/i);if(m)return decodeURIComponent(m[1]);}
  return String(x?.stop_date_time?.properties?.vehicle_journey_id||x?.vehicle_journey?.id||"").trim();
}

async function vehicleJourneyEnds(vehicleJourneyId){
  if(!vehicleJourneyId)return null;
  try{
    const url=`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys/${encodeURIComponent(vehicleJourneyId)}?depth=3`;
    const r=await fetch(url,{headers:basicHeaders()});
    if(!r.ok)return null;
    const data=await r.json();
    const vj=(data.vehicle_journeys||[])[0];
    if(!vj)return null;
    const stops=(vj.stop_times||[]).map(st=>{const sp=st.stop_point||{},sa=sp.stop_area||{};return String(sa.name||sp.name||"").trim();}).filter(Boolean);
    return stops.length?{origin:stops[0],destination:stops[stops.length-1]}:null;
  }catch(e){return null;}
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
        return {type:board==="arrivals"?"arrival":"departure",source:"api-sncf",transportType:"train",datetime:board==="arrivals"?sdt.arrival_date_time:sdt.departure_date_time,baseDatetime:board==="arrivals"?sdt.base_arrival_date_time:sdt.base_departure_date_time,stop:x.stop_point?.name||"",origin:"",direction:info.direction||"",headsign:info.headsign||"",label:info.label||"",trainNumber:trainNo(info.headsign||info.code||info.label),vehicleJourneyId:vehicleJourneyIdFromDeparture(x),commercialMode:info.commercial_mode||"",network:info.network||"",status:sdt.data_freshness||null,platform:platform?String(platform):null,platformEstimated:false,platformConfidence:platform?100:null,platformSource:platform?"sncf-official":null};
      });
    }catch(e){lastErr=e;}
  }
  if(lastErr)console.warn("SNCF board:",lastErr.message);
  return [];
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
        const sncf=await sncfBoard(stopArea,datetime,board);
        const endsByVj=new Map();
        const ids=[...new Set(sncf.map(r=>r.vehicleJourneyId).filter(Boolean))];
        for(let i=0;i<ids.length;i+=8){const batch=ids.slice(i,i+8);const vals=await Promise.all(batch.map(id=>vehicleJourneyEnds(id)));batch.forEach((id,j)=>endsByVj.set(id,vals[j]));}
        const rows=sncf.map(r=>{
          const out={...r};const ends=endsByVj.get(r.vehicleJourneyId);
          if(ends?.origin&&!looksLikeMode(ends.origin))out.origin=ends.origin;
          if(ends?.destination)out.direction=ends.destination;
          if(normPlace(out.origin)&&normPlace(out.origin)===normPlace(out.direction))out.origin="";
          return out;
        });
        res.json(dedupe(rows));
      }catch(e){res.status(500).json({error:e.message});}
    };
    layer.route.stack.forEach(s=>{s.handle=handler;});
  }
};
