import { Router } from "express";
import multer from "multer";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { parseBill } from "../lib/csv.js";
import { insertMany, flowDedupKey, loadBookDedupKeys } from "./flows.js";

const r = Router();
r.use(auth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 预览：解析但不入库，返回条目供前端确认
r.post(
  "/preview",
  upload.single("file"),
  requireBook,
  wrap((req, res) => {
    if (!req.file) return res.status(400).json({ error: "请上传CSV文件" });
    const source = req.body?.source || "auto";
    let mapping = null;
    if (req.body?.mapping) {
      try { mapping = JSON.parse(req.body.mapping); } catch { mapping = null; }
    }
    const result = parseBill(req.file.buffer, { source, mapping });
    // 查重：与「本账本已有账单」+「本文件内其他行」比对，标记重复项。
    // 仅做标记，是否跳过由用户在预览里决定（重复可能是同一笔，也可能是不同笔）。
    const seen = loadBookDedupKeys(req.bookId);
    let dupCount = 0;
    for (const it of result.items) {
      const key = flowDedupKey(it);
      if (seen.has(key)) { it.dup = true; dupCount++; }
      else { it.dup = false; seen.add(key); } // 本文件内后续相同行也标为重复
    }
    res.json({
      count: result.items.length,
      dupCount,
      items: result.items,
      headers: result.headers,
      detectedMapping: result.mapping,
    });
  })
);

// 确认导入：前端已在预览里决定哪些重复项保留/跳过，这里按传入清单写入
r.post(
  "/confirm",
  requireBook,
  wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "没有可导入的数据" });
    // dedup:false —— 完全按前端传来的清单入库，不在后端自动跳过（避免误删用户决定保留的重复）
    const r = insertMany(req.bookId, req.user.id, req.user.nickname, items, req.user.id, { dedup: false });
    res.json({ imported: r.imported, skipped: r.skipped });
  })
);

// 模板导入（前端粘贴表格/JSON）
r.post(
  "/template",
  requireBook,
  wrap((req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((x) => ({
      type: x.type === "income" ? "income" : "expense",
      amount: Number(x.amount) || 0,
      category: x.category || "其他",
      payment_method: x.payment_method || "",
      description: x.description || "",
      flow_time: x.flow_time
        ? dayjs(x.flow_time).format("YYYY-MM-DD HH:mm:ss")
        : dayjs().format("YYYY-MM-DD HH:mm:ss"),
    }));
    const n = insertMany(req.bookId, req.user.id, req.user.nickname, items, req.user.id, { dedup: true });
    res.json({ imported: n.imported, skipped: n.skipped });
  })
);

// 账本数据导出（JSON，含流水/分类/预算）
r.get(
  "/export",
  requireBook,
  wrap((req, res) => {
    const flows = db.prepare("SELECT type, amount, category, payment_method, description, flow_time, COALESCE((SELECT u.nickname FROM users u WHERE u.id = flows.attribution_uid), flows.attribution) AS attribution FROM flows WHERE book_id=? ORDER BY flow_time").all(req.bookId);
    const categories = db.prepare("SELECT name, type, icon, color FROM categories WHERE book_id=?").all(req.bookId);
    const budgets = db.prepare("SELECT year, category, amount FROM budgets WHERE book_id=?").all(req.bookId);
    const book = db.prepare("SELECT name FROM books WHERE id=?").get(req.bookId);
    res.json({ version: 1, exportedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"), book: book.name, categories, budgets, flows });
  })
);

// 账本数据导入（JSON，仅追加流水，可选合并分类/预算）
r.post(
  "/import-json",
  requireBook,
  wrap((req, res) => {
    const data = req.body?.data || {};
    let cats = 0, buds = 0;
    if (Array.isArray(data.categories)) {
      const exist = new Set(
        db.prepare("SELECT name||'|'||type k FROM categories WHERE book_id=?").all(req.bookId).map((x) => x.k)
      );
      const ins = db.prepare("INSERT INTO categories (book_id,name,type,icon,color,sort) VALUES (?,?,?,?,?,0)");
      for (const c of data.categories) {
        if (!exist.has(`${c.name}|${c.type}`)) { ins.run(req.bookId, c.name, c.type, c.icon || "💰", c.color || "#7c8cff"); cats++; }
      }
    }
    if (Array.isArray(data.budgets)) {
      const ins = db.prepare("INSERT INTO budgets (book_id,year,category,amount) VALUES (?,?,?,?) ON CONFLICT(book_id,year,category) DO UPDATE SET amount=excluded.amount");
      for (const b of data.budgets) { ins.run(req.bookId, b.year, b.category || "", b.amount); buds++; }
    }
    const n = insertMany(req.bookId, req.user.id, req.user.nickname, data.flows || [], req.user.id, { dedup: false });
    res.json({ flows: n.imported, skipped: n.skipped, categories: cats, budgets: buds });
  })
);

export default r;
