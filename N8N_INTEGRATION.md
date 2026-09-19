# n8n Integration Contract

The renderer exposes:

- GET /health
- POST /render
- GET /render/:id
- GET /render/:id/file
- GET /render/:id/thumbnail
- GET /render/:id/manifest

POST /render payload:

    {
      "project_id": "content-project-id",
      "orientation": "landscape",
      "title": "title",
      "script": {"full_text": "narration"},
      "visual_plan": [
        {"search_query": "subject", "duration": 12},
        {"search_query": "another subject", "duration": 10}
      ],
      "subtitle_segments": [
        {"start": 0, "duration": 3, "text": "caption"}
      ]
    }

n8n should poll the returned id until status is done or failed.

When done:
- url points to the MP4
- thumbnail points to the JPG
- manifest points to the audit manifest

Do not send Shotstack edit JSON to this service. The renderer owns FFmpeg composition.
