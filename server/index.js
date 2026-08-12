import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureAdmin } from "./db.js";
import authRoutes from "./routes/auth.js";
import bookRoutes from "./routes/books.js";
import categoryRoutes from "./routes/categories.js";
import flowRoutes from "./routes/flows.js";
import statsRoutes from "./routes/stats.js";
import budgetRoutes from "./routes/budgets.js";
import importRoutes from "./routes/importer.js";
import aiRoutes from "./routes/ai.js";
import userRoutes from "./routes/users.js";
import presetRoutes from "./routes/presets.js";
import { APP_VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));

ensureAdmin();

// ---------- API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/api/meta", (req, res) => res.json({ name: "记账本", version: APP_VERSION }));
app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/flows", flowRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/import", importRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin/users", userRoutes);
app.use("/api/presets", presetRoutes);

// ---------- 静态前端 ----------
const webDist = path.resolve(__dirname, "../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA 兜底：非 API 路由都回 index.html
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  app.get("/", (req, res) =>
    res.send("前端尚未构建，请先执行 npm run build:web")
  );
}

const PORT = Number(process.env.PORT) || 9600;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cashbook 服务已启动: http://0.0.0.0:${PORT}`);
});
