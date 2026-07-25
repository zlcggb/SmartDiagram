import { buildApp } from "./app.js";
import { aiRuntimeStatus } from "./lib/ai.js";
import { checkDatabaseInitialization, databaseUrlForLog } from "./lib/prisma.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

try {
  app.log.info({ databaseUrl: databaseUrlForLog() }, "Database configuration loaded");
  app.log.info(aiRuntimeStatus(), "AI provider configuration loaded");
  try {
    await checkDatabaseInitialization();
    app.log.info("Database connected and initialized");
  } catch (error) {
    app.log.error(error, "Database check failed. 请运行 pnpm db:migrate 初始化数据库");
  }

  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
