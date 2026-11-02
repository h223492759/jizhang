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
import syncRoutes from "./routes/sync.js";
import logRoutes from "./routes/logs.js";
import merchantRoutes from "./routes/merchants.js";
import utilityRoutes, { migrateUtilityAlignV1, migrateUtilityAlignV2, migrateUtilityAlignV3 } from "./routes/utility.js";
import { logOp } from "./oplog.js";
import oplogRoutes from "./oplog.js";
import { generateDueRecurring } from "./lib/recurring.js";
import { rebuildAllSuggest } from "./lib/suggest.js";
import { APP_VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));

ensureAdmin();
ensureDefaultCategoriesForAllBooks();
applyCanonicalCategoryOrder();

// 存量流水名称补齐：历史数据 description 留空 → 自动补为该笔的分类名（幂等，可重复执行）
// 与前端「名称留空自动用分类名」语义一致；新写入侧由 FlowDialog 提交前兜底。
try {
  const r = db
    .prepare(
      "UPDATE flows SET description = category WHERE description IS NULL OR TRIM(description) = ''"
    )
    .run();
  if (r.changes > 0)
    console.log(`[migrate] 已为 ${r.changes} 笔空名称流水补齐分类名`);
} catch (e) {
  console.warn("[migrate] 名称补齐失败:", e.message);
}

// 存量水电气账单覆盖区间对齐（v2.2.14）：燃气规则生效月 → 2023-12、
// 水/气/物业历史账单 bill_start/bill_end 按真实缴费月重排。幂等 + settings 打标。
try {
  migrateUtilityAlignV1();
} catch (e) {
  console.warn("[utility-migrate] 存量校准失败:", e.message);
}

// 存量校准 V2（v2.2.17 显式账期）：删除引擎账单（auto/pending）并按「出账窗口→账期」
// 从流水重建；manual/corrected 保留。须在 V1 之后跑（V1 会把老燃气规则生效月推到 2023-12）。
try {
  migrateUtilityAlignV2();
} catch (e) {
  console.warn("[utility-migrate] v2.2.17 显式账期校准失败:", e.message);
}

// 存量校准 V3（v2.2.18）：corrected 历史账单区间归位——V2 尊重 corrected 保留，
// 但老引擎时代的错位 corrected（如物业 2024-02 缴却记 02~04）与 auto 重建账单
// 在边界月重叠 → 月视图 amountAvg 双倍。本迁移按流水推导唯一区间后仅平移
// bill_start/bill_end（保留用户对金额/用量的校正）。须在 V2 之后跑。
try {
  migrateUtilityAlignV3();
} catch (e) {
  console.warn("[utility-migrate] v2.2.18 corrected 区间归位失败:", e.message);
}

// 存量流水 updated_at 回填：历史 bug 使定期记账生成的流水漏写 updated_at（NULL），
// 安卓端增量同步按 updated_at > since 拉取 → NULL 行永远不同步（症状：网页端可见、安卓端缺失，
// 用户误以为定期记账没生效而手动补记 → 产生重复）。填当前时间而非 created_at：
// 安卓同步游标已推进到当下，只有比游标新的行才会被下一次增量拉取到。
try {
  const r = db
    .prepare(
      "UPDATE flows SET updated_at = datetime('now','localtime') WHERE updated_at IS NULL OR TRIM(updated_at) = ''"
    )
    .run();
  if (r.changes > 0)
    console.log(`[migrate] 已为 ${r.changes} 笔流水回填 updated_at（安卓端将能同步到定期记账流水）`);
} catch (e) {
  console.warn("[migrate] updated_at 回填失败:", e.message);
}

// 启动时把到期待生成的定期记账补成真实流水（防重：同一周期只生成一次）
// v1.1.2：生成规则改为「只有到了排程日那天才记」+ 每天 00:05 定时补记，
// 不再只在启动 / 打开定期页时才跑（服务器常驻时也能当天落账）。
function generateAllDue(reason) {
  for (const b of db.prepare("SELECT id FROM books").all()) {
    try {
      const n = generateDueRecurring(b.id, new Date());
      if (n > 0) console.log(`[recurring] 账本 ${b.id} 已生成 ${n} 笔定期记账（${reason}）`);
    } catch (e) {
      console.warn("[recurring] 启动生成失败:", e.message);
    }
  }
}
generateAllDue("启动");

// 计算到下一个「北京时间 hh:mm」的毫秒数
function msUntilNextBjt(hour, minute) {
  const now = new Date();
  const bjt = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const next = new Date(bjt);
  next.setHours(hour, minute, 0, 0);
  if (next <= bjt) next.setDate(next.getDate() + 1);
  return Math.max(1000, next - bjt);
}
setTimeout(function scheduleRecurring() {
  generateAllDue("每日定时");
  setTimeout(scheduleRecurring, msUntilNextBjt(0, 5));
}, msUntilNextBjt(0, 5));

// 常用名称建议：启动全量重建一次 + 每天凌晨 1 点（北京时间）定时重建。
// 流水保存/删除/导入不再触发单账本重建（用户：没那么高频，只保留定时）。
// 分类改名 / 手动扫描（POST /presets/scan、/rescan）仍即时触发。
try {
  rebuildAllSuggest();
} catch (e) {
  console.warn("[suggest] 启动重建失败:", e.message);
}
// 计算到下一个北京时间 01:00 的毫秒数
function msUntilNextBjt1am() {
  const now = new Date();
  const bjt = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const next = new Date(bjt);
  next.setHours(1, 0, 0, 0);
  if (next <= bjt) next.setDate(next.getDate() + 1);
  return Math.max(1000, next - bjt);
}
setTimeout(function scheduleDaily() {
  try {
    rebuildAllSuggest();
  } catch (e) {
    console.warn("[suggest] 每日重建失败:", e.message);
  }
  setTimeout(scheduleDaily, 24 * 3600 * 1000);
}, msUntilNextBjt1am());

// ---------- API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/api/meta", (req, res) => res.json({ name: "记账本", version: APP_VERSION }));
// 写操作审计（响应后异步记录）。必须在业务路由【之前】挂载：
// Express 按注册顺序匹配，若挂在业务路由之后，POST/PUT/DELETE 早已被
// 前面的路由终结响应，永远走不到本中间件 → op_logs 空。
// bookId/userId 由业务路由内的 auth/requireBook 在响应完成前设置，
// res.on('finish') 回调执行时读取即为最终值。
app.use("/api", logOp);
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
app.use("/api/sync", syncRoutes);
// 客户端自动记账运行日志（安卓端上传，服务端不限条数留存，排查漏记用）
app.use("/api/logs", logRoutes);
app.use("/api/merchants", merchantRoutes);
app.use("/api/utility", utilityRoutes);
app.use("/api/oplogs", oplogRoutes);

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
  console.log(`Jizhang 服务已启动: http://0.0.0.0:${PORT}`);
});
