import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec=promisify(execFile), app=express(), DATA=process.env.DATA_DIR||"/data", PORT=Number(process.env.PORT||5002);
const jobs=new Map(); app.use(express.json({limit:"10mb"}));
const sh=(cmd,args)=>exec(cmd,args,{maxBuffer:20*1024*1024});
const ensure=p=>fs.mkdir(p,{recursive:true});
app.get("/health",async(_,res)=>{try{const {stdout}=await sh("ffmpeg",["-version"]);res.json({ok:true,ffmpeg:stdout.split("\n")[0]})}catch(e){res.status(503).json({ok:false,error:e.message})}});
app.post("/render",async(req,res)=>{const id=crypto.randomUUID();jobs.set(id,{id,status:"queued",created_at:new Date().toISOString()});render(id,req.body).catch(e=>jobs.set(id,{...jobs.get(id),status:"failed",error:e.message,finished_at:new Date().toISOString()}));res.status(202).json({id,status:"queued"})});
app.get("/render/:id",(req,res)=>{const j=jobs.get(req.params.id);j?res.json(j):res.status(404).json({error:"job_not_found"})});
async function render(id,p){
 const work=path.join(DATA,"jobs",id); await ensure(work); jobs.set(id,{...jobs.get(id),status:"running"});
 const script=typeof p.script==="string"?p.script:(p.script?.full_text||p.script?.text||Object.values(p.script||{}).join(" "));
 const job={work,orientation:p.orientation==="portrait"?"portrait":"landscape",script_text:script||"",visual_plan:Array.isArray(p.visual_plan)?p.visual_plan:[],subtitle_segments:Array.isArray(p.subtitle_segments)?p.subtitle_segments:[],duration:p.duration||null};
 const r=await sh("python3",["/app/src/render.py"],{input:JSON.stringify(job),maxBuffer:20*1024*1024});
 const x=JSON.parse(r.stdout.trim()); jobs.set(id,{...jobs.get(id),status:"done",url:`/render/${id}/file`,thumbnail:`/render/${id}/thumbnail`,manifest:`/render/${id}/manifest`,duration:x.duration,finished_at:new Date().toISOString()});
 await fs.writeFile(path.join(work,"manifest.json"),JSON.stringify({...job,assets:x.assets,completed_at:new Date().toISOString()},null,2));
}
for(const kind of ["file","thumbnail","manifest"]) app.get("/render/:id/"+kind,async(req,res)=>{const ext={file:"final.mp4",thumbnail:"thumbnail.jpg",manifest:"manifest.json"}[kind];const p=path.join(DATA,"jobs",req.params.id,ext);try{await fs.access(p);res.sendFile(path.resolve(p))}catch{res.status(404).json({error:"not_ready"})}});
app.listen(PORT,()=>console.log(`yt-ai-local-renderer :${PORT}`));