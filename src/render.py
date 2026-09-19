#!/usr/bin/env python3
import asyncio, json, os, re, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

try:
    import edge_tts
except Exception:
    edge_tts = None

UA = "YT-AI-Local-Renderer/0.1"
VOICE = os.getenv("TTS_VOICE", "en-US-GuyNeural")

def run(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def download(url, dest):
    req=urllib.request.Request(url, headers={"User-Agent":UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        Path(dest).write_bytes(r.read())

def search_openverse(query):
    url="https://api.openverse.org/v1/images/?q="+urllib.parse.quote(query)+"&page_size=5"
    req=urllib.request.Request(url, headers={"User-Agent":UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        data=json.loads(r.read())
    return [x.get("thumbnail") or x.get("url") for x in data.get("results",[]) if x.get("thumbnail") or x.get("url")]

async def tts(text, out):
    if not edge_tts:
        raise RuntimeError("edge-tts is unavailable")
    await edge_tts.Communicate(text, VOICE).save(out)

def srt_time(sec):
    ms=int(round(sec*1000)); h=ms//3600000; ms%=3600000
    m=ms//60000; ms%=60000; s=ms//1000; ms%=1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def make_srt(segments, text, duration, out):
    if not segments:
        words=text.split()
        n=max(1, len(words)); chunk=9
        lines=[]
        for i in range(0,n,chunk):
            a=i/n*duration; b=min(duration,(i+chunk)/n*duration)
            lines.append((a,b," ".join(words[i:i+chunk])))
    else:
        lines=[]
        for s in segments:
            a=float(s.get("start",0)); b=a+float(s.get("duration",2.5)); lines.append((a,b,str(s.get("text",""))))
    with open(out,"w",encoding="utf-8") as f:
        for i,(a,b,t) in enumerate(lines,1):
            f.write(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n\n")

def scene_query(v):
    return str(v.get("search_query") or v.get("visual_direction") or v.get("description") or v.get("prompt") or "technology documentary")

def render(job):
    work=Path(job["work"]); work.mkdir(parents=True,exist_ok=True)
    orientation=job.get("orientation","landscape")
    W,H=(1080,1920) if orientation=="portrait" else (1920,1080)
    script=str(job.get("script_text") or "")
    visuals=job.get("visual_plan") or []
    duration=max(20.0,float(job.get("duration") or max(30,len(script.split())/2.3)))
    assets=[]

    for i,v in enumerate(visuals[:14]):
        urls=[]
        if isinstance(v,dict):
            if v.get("asset_url"): urls=[v["asset_url"]]
            elif isinstance(v.get("asset_urls"),list): urls=v["asset_urls"]
        if not urls:
            try: urls=search_openverse(scene_query(v))
            except Exception: urls=[]
        if not urls: continue
        p=work/f"scene_{i:02d}.jpg"
        try:
            download(urls[0],p); assets.append(str(p))
        except Exception:
            continue

    # Guarantee a valid visual even when a source is temporarily unavailable.
    if not assets:
        bg=work/"fallback.png"
        run(["ffmpeg","-y","-f","lavfi","-i",f"color=c=0x101010:s={W}x{H}","-frames:v","1",str(bg)])
        assets=[str(bg)]

    per=duration/len(assets)
    clips=[]
    for i,a in enumerate(assets):
        c=work/f"clip_{i:02d}.mp4"
        vf=f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
        run(["ffmpeg","-y","-loop","1","-i",a,"-t",str(per),"-vf",vf,"-r","30","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",str(c)])
        clips.append(c)

    concat=work/"concat.txt"
    concat.write_text("".join(f"file '{str(c).replace(chr(39),chr(39)+chr(92)+chr(39)+chr(39))}'\n" for c in clips),encoding="utf8")
    silent=work/"silent.mp4"
    run(["ffmpeg","-y","-f","concat","-safe","0","-i",str(concat),"-c","copy",str(silent)])

    audio=work/"voice.mp3"
    asyncio.run(tts(script,audio))
    srt=work/"captions.srt"
    make_srt(job.get("subtitle_segments") or [],script,duration,srt)

    out=work/"final.mp4"
    style=f"subtitles={str(srt).replace(':','\\:')}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=70'"
    run(["ffmpeg","-y","-i",str(silent),"-i",str(audio),"-vf",style,"-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","veryfast","-crf","22","-c:a","aac","-b:a","128k","-shortest","-movflags","+faststart",str(out)])
    thumb=work/"thumbnail.jpg"
    run(["ffmpeg","-y","-ss","2","-i",str(out),"-frames:v","1","-q:v","2",str(thumb)])
    probe=run(["ffprobe","-v","error","-show_entries","format=duration","-show_entries","stream=codec_type","-of","json",str(out)])
    meta=json.loads(probe.stdout)
    streams=[x.get("codec_type") for x in meta.get("streams",[])]
    actual=float(meta.get("format",{}).get("duration") or 0)
    if actual < max(5,duration*0.9) or "video" not in streams or "audio" not in streams:
        raise RuntimeError(f"render verification failed: duration={actual}, streams={streams}")
    return {"video":str(out),"thumbnail":str(thumb),"assets":assets,"duration":actual,"verified":True}

if __name__=="__main__":
    job=json.loads(sys.stdin.read()); print(json.dumps(render(job)))
