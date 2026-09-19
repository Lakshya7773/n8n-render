# YT AI Local Renderer

Self-hosted HTTP video renderer for the YT AI automation system.

## Goal

Accept a content package from n8n and return a rendered MP4 + thumbnail without Shotstack, ElevenLabs, Seedance, Nano Banana, or another paid SaaS renderer.

Default stack:

- Node.js
- FFmpeg
- Edge TTS fallback / Piper-compatible architecture
- Openverse/Wikimedia-compatible remote media URLs
- SRT/VTT captions
- deterministic 16:9 and 9:16 rendering

## API

POST /health
POST /render

/render accepts:

{
  "project_id": "...",
  "orientation": "landscape",
  "title": "...",
  "script": "...",
  "visual_plan": [],
  "subtitle_segments": [],
  "assets": []
}

It returns a job id. GET /render/:id returns status and output URLs.

## Deployment

The intended deployment is beside self-hosted n8n. Mount /data into both services. n8n sends a JSON job to the renderer; the renderer writes MP4 and thumbnail into /data and exposes them through its HTTP API.

The service is deliberately provider-agnostic. Free local TTS/media providers can be swapped without changing the n8n content pipeline.

## Design rules

1. No paid rendering SaaS.
2. No provider-specific rendering JSON in n8n.
3. Deterministic FFmpeg output.
4. Render jobs are resumable and observable.
5. Every render records the source assets and timing manifest.
