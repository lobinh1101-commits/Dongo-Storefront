FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace=backend --omit=dev --include-workspace-root=false

RUN mkdir -p /var/log/dongo && chown node:node /var/log/dongo
COPY backend/server ./backend/server
USER node
EXPOSE 3001
CMD ["node", "backend/server/index.js"]
