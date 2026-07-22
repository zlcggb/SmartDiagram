import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // 聚合部署：构建产物挂在网关 /ppt/ 路径下；本地 dev 仍从根路径启动，保持原工作流
  base: command === "build" ? "/ppt/" : "/",
  plugins: [react()]
}));
