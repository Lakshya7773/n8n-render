FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
RUN pip3 install --break-system-packages edge-tts
COPY src ./src
RUN mkdir -p /data/jobs
ENV PORT=5002
ENV DATA_DIR=/data
EXPOSE 5002
CMD ["npm","start"]