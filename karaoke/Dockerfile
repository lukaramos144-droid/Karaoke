FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/* \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY worker/requirements.txt worker/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
 && pip3 install --no-cache-dir --break-system-packages -r worker/requirements.txt
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
