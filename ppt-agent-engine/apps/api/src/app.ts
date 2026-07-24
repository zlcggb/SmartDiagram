import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import { aiRuntimeStatus, configureResearchAdapter } from "./lib/ai.js";
import { getAiUsage } from "./lib/aiUsage.js";
import { ensureStorageDirs, exportsDir } from "./lib/paths.js";
import { checkDatabaseConnection } from "./lib/prisma.js";
import { fail, ok } from "./lib/response.js";
import { projectRoutes } from "./routes/projects.js";
import { progressRoutes } from "./routes/progress.js";
import { mediaRoutes } from "./routes/media.js";
import { materialRoutes } from "./routes/materials.js";
import { installPptAuthorization, type PptAuthorizationOptions } from "./lib/pptAuthorization.js";
import { installProtectedExports } from "./lib/exportAccess.js";

export async function buildApp(authOptions: PptAuthorizationOptions = {}) {
  ensureStorageDirs();
  configureResearchAdapter();

  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  installProtectedExports(app);

  await app.register(staticPlugin, {
    root: exportsDir,
    prefix: "/exports/",
    decorateReply: false
  });

  installPptAuthorization(app, authOptions);

  app.get("/api/health", async (_request, reply) => {
    try {
      await checkDatabaseConnection();
      return reply.send({ status: "ok", database: "connected" });
    } catch (error) {
      app.log.error(error, "Database health check failed");
      return reply.status(503).send({
        status: "error",
        database: "disconnected",
        message: "数据库未初始化或无法连接，请运行 pnpm db:migrate 初始化数据库"
      });
    }
  });

  app.get("/api/ai/status", async (_request, reply) => {
    return reply.send({ status: "ok", ...aiRuntimeStatus() });
  });

  app.get("/api/ai/usage", async (_request, reply) => {
    return reply.send(ok(getAiUsage(), "AI 粗用量（本进程内存）"));
  });

  await app.register(projectRoutes);
  await app.register(materialRoutes);
  await app.register(progressRoutes);
  await app.register(mediaRoutes);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send(fail("未找到请求的接口"));
  });

  app.setErrorHandler(async (error, _request, reply) => {
    app.log.error(error);
    const knownError = error as { statusCode?: number; message?: string };
    const statusCode = knownError.statusCode && knownError.statusCode >= 400 ? knownError.statusCode : 500;
    const message = statusCode >= 500 ? "服务端处理失败，请查看 API 日志" : knownError.message ?? "请求处理失败";
    return reply.status(statusCode).send(fail(message));
  });

  return app;
}
