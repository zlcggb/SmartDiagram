/**
 * SSE 进度推送端点。
 *
 * GET /api/projects/:id/progress
 * → text/event-stream，实时推送该项目的 AI 生成进度事件。
 */

import type { FastifyInstance } from "fastify";
import { subscribeProgress } from "../lib/progressEmitter.js";

interface IdParams {
  id: string;
}

export async function progressRoutes(app: FastifyInstance) {
  app.get<{ Params: IdParams }>("/api/projects/:id/progress", async (request, reply) => {
    const projectId = request.params.id;

    // 设置 SSE 头
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*"
    });
    reply.raw.flushHeaders();

    // SSE 注释用于确认连接，不伪造一个“流水线”执行阶段。
    reply.raw.write(": connected\n\n");

    // 订阅进度事件
    const unsubscribe = subscribeProgress(projectId, (event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // 连接已断开，忽略
      }
    });

    // 心跳保活（每 15 秒）
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // 客户端断开时清理
    request.raw.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });

    // 不要 reply.send()——SSE 持续推送
    await reply;
  });
}
