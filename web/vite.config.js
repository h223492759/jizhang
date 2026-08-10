import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 开发时把 /api 代理到后端，构建产物由后端 express 直接托管
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:9600",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
