import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({
  root,
  cacheDir: path.join(os.tmpdir(), "ppt-agent-vite-cache"),
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173)
  }
});

await server.listen();
server.printUrls();
