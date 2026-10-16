FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace=frontend --include-workspace-root=false
COPY frontend ./frontend
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build --workspace=frontend

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY docker/frontend/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
