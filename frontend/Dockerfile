FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# schema.d.ts is committed and CI rejects contract drift. The isolated frontend
# build context intentionally cannot reach ../openapi, so skip only generation.
RUN npm run build:app

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
