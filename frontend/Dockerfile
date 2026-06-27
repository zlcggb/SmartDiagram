FROM registry.cn-hangzhou.aliyuncs.com/library/node:20-slim AS build
WORKDIR /app

# 阿里云内网 npm 镜像（阿里云 ECS 专用，内网带宽，极速）
ARG CN_MIRROR=false
RUN npm config set registry https://registry.npmmirror.com

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM registry.cn-hangzhou.aliyuncs.com/library/nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
