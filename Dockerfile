FROM node:22-bookworm

WORKDIR /usr/src/app

# Native build libraries for canvas/image processing and media tooling.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg imagemagick webp rsync python3 python3-venv python3-pip make g++ \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json requirements-lirik.txt ./
COPY scripts/install-lirik-deps.js ./scripts/install-lirik-deps.js
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
