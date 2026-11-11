FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TRACKER_HOME=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY examples ./examples
COPY .env.example ./
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
# API + a scan every 6 hours. Mount /data with config/targets.json; state and reports are written there.
CMD ["node", "bin/hiring-tracker.js", "serve", "--port", "3000", "--every", "360"]
