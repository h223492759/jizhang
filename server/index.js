import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, ensureAdmin, ensureDefaultCategoriesForAllBooks, applyCanonicalCategoryOrder } from "./db.js";
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
import settingsRoutes from "./routes/settings.js";
import recurringRoutes from "./routes/recurring.js";
import billRoutes from "./routes/bills.js";
import savingsRoutes from "./routes/savings.js";
import walletRoutes from "./routes/wallets.js";
import { generateDueRecurring } from "./lib/recurring.js";
import { APP_VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));

ensureAdmin();
ensureDefaultCategoriesForAllBooks();
applyCanonicalCategoryOrder();

// 启动时把到期待生成的定期记账补成真实流水（防重：同一周期只生成一次）
for (const b of db.prepare("SELECT id FROM books").all()) {
  try {
    const n = generateDueRecurring(b.id, new Date());
    if (n > 0) console.log(`[recurring] 账本 ${b.id} 已生成 ${n} 笔定期记账`);
  } catch (e) {
    console.warn("[recurring] 启动生成失败:", e.message);
  }
}

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
app.use("/api/settings", settingsRoutes);
app.use("/api/recurring", recurringRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/wallets", walletRoutes);

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
