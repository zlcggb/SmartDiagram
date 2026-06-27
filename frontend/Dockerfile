FROM node:20-slim AS build
WORKDIR /app

# 国内 npm 镜像加速（直接写死，避免条件判断失效）
ARG CN_MIRROR=false
RUN npm config set registry https://registry.npmmirror.com

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
