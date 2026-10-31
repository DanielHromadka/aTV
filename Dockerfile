FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm test && npm run build

# The hub runs its TypeScript directly (Node's type stripping); only runtime packages are installed.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production ATV_DATA=/data ATV_DIST=/app/dist HOME=/home/node
COPY package.json package-lock.json ./
# Xvfb and PulseAudio give the browser a virtual screen and sound card, so the TV can watch it with sound.
RUN apk add --no-cache ffmpeg chromium ttf-dejavu ttf-liberation font-noto-emoji xvfb pulseaudio && npm ci --omit=dev && npm cache clean --force
COPY hub ./hub
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 8090
VOLUME /data
USER node
CMD ["node", "hub/index.ts"]
