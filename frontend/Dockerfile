# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Relative API base so the SPA talks to the same origin (nginx proxies /api).
ARG VITE_API_BASE=/api/v1
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_SENTRY_DSN=
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
# vite build only (esbuild transpiles TS) — type-checking runs locally/CI via
# `npm run typecheck`, not on the small VPS where tsc thrashes RAM into swap.
RUN npm run build:docker

# --- serve stage ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
