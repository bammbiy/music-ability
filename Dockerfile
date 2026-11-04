# Music Ability: no dependencies and no build step, so the image is just Node and the source.
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=3003 \
    DATABASE_PATH=/data/music-ability.sqlite

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# The SQLite file lives on a mounted volume so it survives restarts and redeploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/app.js"]
