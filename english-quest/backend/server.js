import express from "express";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(x=>x.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb){
    if(!origin || allowedOrigins.length===0 || allowedOrigins.includes(origin)) return cb(null,true);
    return cb(new Error("Origin not allowed"));
  }
}));
app.use(express.json({limit:"64kb"}));

const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY});

app.get("/health",(req,res)=>res.json({ok:true}));

app.post("/api/chat", async (req,res)=>{
  try{
    const {message,mode="general",level="A1",history=[]}=req.body||{};
    if(typeof message!=="string" || !message.trim()) return res.status(400).json({error:"message required"});

    const railway = mode==="railway";
    const explain = mode==="explain_fr";

    const instructions = explain
      ? `Tu es un professeur d'anglais pour un francophone de niveau ${level}. Réponds en français, simplement et pédagogiquement.`
      : railway
        ? `You are an English teacher specializing in railway vocabulary for a French train driver.
The purpose is language learning, not operational authority. Never present your reply as an official railway procedure or safety instruction.
Keep the conversation mainly in English at CEFR ${level}. Correct the learner's English briefly, explain one useful improvement, then continue the railway scenario with one question.
Use clear railway vocabulary and distinguish general English from company-specific terminology.`
        : `You are a friendly English teacher for a French-speaking learner at CEFR ${level}.
Answer mainly in English. Correct important mistakes briefly, give one natural alternative, and continue the conversation with one short question.
If the learner struggles, add a short French explanation.`;

    const input = [
      ...history.filter(x=>x && ["user","assistant"].includes(x.role) && typeof x.content==="string").slice(-8),
      {role:"user",content:message}
    ];

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      instructions,
      input
    });

    res.json({reply:response.output_text});
  }catch(err){
    console.error(err);
    res.status(500).json({error:"AI request failed"});
  }
});

app.listen(PORT,()=>console.log(`English Quest AI backend on port ${PORT}`));
