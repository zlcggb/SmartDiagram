// SmartDiagram 本地开发网关（零依赖，Node 内置模块实现）
// 统一 SPA 架构：前端单应用承载 首页/思维导图/PPT 三个路由，网关只做 API 分流：
//
//   /            → 统一前端构建产物（apps/web/dist，SPA 回退）
//   /api/        → SmartDiagram 后端  http://127.0.0.1:8000
//   /ppt-api/    → PPT Agent 后端    http://127.0.0.1:4000（剥离前缀）
//   /drawio/     → drawio 容器       http://127.0.0.1:9022（剥离前缀）

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(gatewayDir, "..");

const listenPort = Number(process.env.GATEWAY_PORT ?? 8080);
const frontendDistDir = path.join(projectRoot, "apps/web/dist");

/** 反向代理规则：prefix 命中后转发到 target；stripPrefix 决定是否剥掉前缀 */
const proxyRoutes = [
  { prefix: "/api/", target: "http://127.0.0.1:8000", stripPrefix: false },
  { prefix: "/ppt-api/", target: "http://127.0.0.1:4000", stripPrefix: true },
  { prefix: "/drawio/", target: "http://127.0.0.1:9022", stripPrefix: true }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

function proxyRequest(clientRequest, clientResponse, route) {
  const targetUrl = new URL(route.target);
  const upstreamPath = route.stripPrefix
    ? clientRequest.url.slice(route.prefix.length - 1) // 保留开头的 "/"
    : clientRequest.url;

  const upstreamRequest = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: upstreamPath,
      method: clientRequest.method,
      headers: { ...clientRequest.headers, host: targetUrl.host },
      timeout: 900_000 // SSE 长连接
    },
    (upstreamResponse) => {
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(clientResponse);
    }
  );

  upstreamRequest.on("timeout", () => upstreamRequest.destroy());
  upstreamRequest.on("error", (error) => {
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    clientResponse.end(`上游服务不可用: ${route.target} (${error.code ?? error.message})\n`);
  });

  clientRequest.pipe(upstreamRequest);
}

function serveFrontend(clientRequest, clientResponse) {
  const requestPath = decodeURIComponent(clientRequest.url.split("?")[0]);
  const safeRelative = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(frontendDistDir, safeRelative);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA 回退：无扩展名的路径交给前端路由（/、/diagram、/ppt/...）
    if (!path.extname(safeRelative)) {
      filePath = path.join(frontendDistDir, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      clientResponse.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      clientResponse.end("Not Found\n");
      return;
    }
  }

  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  clientResponse.writeHead(200, {
    "content-type": contentType,
    "content-length": fs.statSync(filePath).size,
    "cache-control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache"
  });
  fs.createReadStream(filePath).pipe(clientResponse);
}

const server = http.createServer((clientRequest, clientResponse) => {
  const requestPath = clientRequest.url.split("?")[0];

  const matchedProxy = proxyRoutes.find((route) => requestPath.startsWith(route.prefix));
  if (matchedProxy) {
    proxyRequest(clientRequest, clientResponse, matchedProxy);
    return;
  }

  serveFrontend(clientRequest, clientResponse);
});

server.listen(listenPort, () => {
  console.log(`聚合网关已启动 → http://localhost:${listenPort}`);
  console.log(`  /         平台首页（统一 SPA：/diagram 思维导图 · /ppt PPT 制作）`);
  console.log(`  /api/     SmartDiagram 后端 → :8000`);
  console.log(`  /ppt-api/ PPT Agent 后端   → :4000`);
});
