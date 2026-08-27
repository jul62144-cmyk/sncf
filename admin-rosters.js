const { Redis } = require("@upstash/redis");

const ADMIN_PERIODS_KEY = "trajets-hdf:roster-periods:v1";

function redisClient(){
  const url=process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.KV_REST_API_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN;
  return url&&token ? new Redis({url,token}) : null;
}

function adminOk(req){
  const configured=String(process.env.ADMIN_PASSWORD||"");
  if(!configured) return false;
  return String(req.headers["x-admin-password"]||"")===configured;
}

function cleanPeriod(p){
  return {
    id:String(p.id||"").trim(),
    label:String(p.label||"").trim(),
    validFrom:String(p.validFrom||"").trim(),
    validTo:String(p.validTo||"").trim(),
    createdAt:p.createdAt||new Date().toISOString(),
    technicalTrains:Array.isArray(p.technicalTrains)?p.technicalTrains:[],
    taxis:Array.isArray(p.taxis)?p.taxis:[],
    rosterIndex:Array.isArray(p.rosterIndex)?p.rosterIndex:[],
    sourceFile:String(p.sourceFile||"").trim(),
    sourceSummary:p.sourceSummary&&typeof p.sourceSummary==="object"?p.sourceSummary:null
  };
}

module.exports=function patchAdminRosters(app){
  app.get("/api/admin/rosters",async(req,res)=>{
    if(!adminOk(req)) return res.status(401).json({error:"Mot de passe administrateur incorrect."});
    const redis=redisClient();
    if(!redis) return res.status(503).json({error:"Upstash Redis n'est pas configuré."});
    try{
      const raw=await redis.get(ADMIN_PERIODS_KEY);
      const periods=Array.isArray(raw)?raw:(typeof raw==="string"?JSON.parse(raw||"[]"):[]);
      res.json(periods.map(p=>({id:p.id,label:p.label,validFrom:p.validFrom,validTo:p.validTo,createdAt:p.createdAt,sourceFile:p.sourceFile,counts:{technicalTrains:p.technicalTrains?.length||0,taxis:p.taxis?.length||0,rosterIndex:p.rosterIndex?.length||0}})));
    }catch(e){res.status(500).json({error:e.message});}
  });

  app.post("/api/admin/rosters",require("express").json({limit:"8mb"}),async(req,res)=>{
    if(!adminOk(req)) return res.status(401).json({error:"Mot de passe administrateur incorrect."});
    const redis=redisClient();
    if(!redis) return res.status(503).json({error:"Upstash Redis n'est pas configuré."});
    try{
      const p=cleanPeriod(req.body||{});
      if(!p.id||!p.label||!/^\d{4}-\d{2}-\d{2}$/.test(p.validFrom)||!/^\d{4}-\d{2}-\d{2}$/.test(p.validTo)){
        return res.status(400).json({error:"Identifiant, nom et dates de validité obligatoires."});
      }
      const raw=await redis.get(ADMIN_PERIODS_KEY);
      let periods=Array.isArray(raw)?raw:(typeof raw==="string"?JSON.parse(raw||"[]"):[]);
      periods=periods.filter(x=>x.id!==p.id);
      periods.push(p);
      periods.sort((a,b)=>String(a.validFrom).localeCompare(String(b.validFrom)));
      await redis.set(ADMIN_PERIODS_KEY,JSON.stringify(periods));
      res.json({ok:true,id:p.id,counts:{technicalTrains:p.technicalTrains.length,taxis:p.taxis.length,rosterIndex:p.rosterIndex.length}});
    }catch(e){res.status(500).json({error:e.message});}
  });

  app.delete("/api/admin/rosters/:id",async(req,res)=>{
    if(!adminOk(req)) return res.status(401).json({error:"Mot de passe administrateur incorrect."});
    const redis=redisClient();
    if(!redis) return res.status(503).json({error:"Upstash Redis n'est pas configuré."});
    try{
      const raw=await redis.get(ADMIN_PERIODS_KEY);
      let periods=Array.isArray(raw)?raw:(typeof raw==="string"?JSON.parse(raw||"[]"):[]);
      const before=periods.length;
      periods=periods.filter(x=>x.id!==req.params.id);
      await redis.set(ADMIN_PERIODS_KEY,JSON.stringify(periods));
      res.json({ok:true,deleted:before-periods.length});
    }catch(e){res.status(500).json({error:e.message});}
  });

  app.get("/api/roster-period",async(req,res)=>{
    const date=String(req.query.date||"").trim();
    const redis=redisClient();
    if(!redis||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.json(null);
    try{
      const raw=await redis.get(ADMIN_PERIODS_KEY);
      const periods=Array.isArray(raw)?raw:(typeof raw==="string"?JSON.parse(raw||"[]"):[]);
      const p=periods.filter(x=>x.validFrom<=date&&date<=x.validTo).sort((a,b)=>String(b.validFrom).localeCompare(String(a.validFrom)))[0]||null;
      res.json(p);
    }catch(e){res.status(500).json({error:e.message});}
  });
};