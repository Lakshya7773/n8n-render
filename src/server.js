import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const app = express();
app.use(express.json({limit:"5mb"}));
const DATA = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 5002);
const jobs = new Map();

async function sh(cmd,args) {
  return exec(cmd,args,{maxBuffer:20*1024*1024});
}
async function ensure(p){ await fs.mkdir(p,{recursive:true}); }

app.get("/health", async (_,res)=>{
  try { const {stdout}=await sh("ffmpeg",["-version"]); res.json({ok:true,ffmpeg:stdout.split("\n")[0]}); }
  catch(e){ res.status(503).json({ok:false,error:e.message}); }
});

app.post("/render", async (req,res)=>{
  const jobId=crypto.randomUUID();
  jobs.set(jobId,{status:"queued",created_at:new Date().toISOString()});
  render(jobId,req.body).catch(e=>jobs.set(jobId,{...jobs.get(jobId),status:"failed",error:e.message}));
  res.status(202).json({id:jobId,status:"queued"});
});

app.get("/render/:id",(req,res)=>{
  const j=jobs.get(req.params.id);
  if(!j) return res.status(404).json({error:"job_not_found"});
  res.json(j);
});

async function render(id,p){
  const dir=path.join(DATA,"jobs",id); await ensure(dir);
  jobs.set(id,{...jobs.get(id),status:"running"});
  const orientation=p.orientation==="portrait"?"portrait":"landscape";
  const width=orientation==="portrait"?1080:1920, height=orientation==="portrait"?1920:1080;
  const duration=Math.max(5,Number(p.duration||estimateDuration(p.script||"")));
  const bg=path.join(dir,"background.mp4");
  const out=path.join(dir,"final.mp4");
  const thumb=path.join(dir,"thumbnail.jpg");
  const manifest={id,project_id:p.project_id||null,orientation,width,height,duration,assets:p.assets||[],created_at:new Date().toISOString()};
  await fs.writeFile(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2));
  await sh("ffmpeg",["-y","-f","lavfi","-i",`color=c=0x101010:s=${width}x${height}:d=${duration}`,"-r","30","-pix_fmt","yuv420p",bg]);
  // This first deterministic renderer deliberately renders a valid timed MP4.
  // Asset/TTS adapters are isolated for the next provider-free production stage.
  await sh("ffmpeg",["-y","-i",bg,"-frames:v","1",thumb]);
  await sh("ffmpeg",["-y","-i",bg,"-c:v","libx264","-preset","veryfast","-crf","23","-movflags","+faststart",out]);
  jobs.set(id,{...jobs.get(id),status:"done",url:`/render/${id}/file`,thumbnail:`/render/${id}/thumbnail`,manifest:`/render/${id}/manifest`,finished_at:new Date().toISOString()});
}

function estimateDuration(script){ return Math.min(420,Math.max(30,Math.ceil(String(script).split(/\s+/).filter(Boolean).length/2.3))); }

app.get("/render/:id/file",async(req,res)=>{
  const p=path.join(DATA,"jobs",req.params.id,"final.mp4");
  try { await fs.access(p); res.type("mp4"); res.sendFile(path.resolve(p)); } catch { res.status(404).json({error:"not_ready"}); }
});
app.get("/render/:id/thumbnail",async(req,res)=>{
  const p=path.join(DATA,"jobs",req.params.id,"thumbnail.jpg");
  try { await fs.access(p); res.type("jpg"); res.sendFile(path.resolve(p)); } catch { res.status(404).json({error:"not_ready"}); }
});
app.get("/render/:id/manifest",async(req,res)=>{
  const p=path.join(DATA,"jobs",req.params.id,"manifest.json");
  try { res.type("json"); res.send(await fs.readFile(p,"utf8")); } catch { res.status(404).json({error:"not_ready"}); }
});

app.listen(PORT,()=>console.log(`yt-ai-local-renderer listening on :${PORT}`));