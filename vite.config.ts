import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 打包成单个 HTML：可直接双击打开、部署到 GitHub Pages，也便于「导出离线 HTML」时复制自身
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: { outDir: "dist", target: "es2022" },
});
