import { Router } from "express";
import multer from "multer";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { parseBill } from "../lib/csv.js";
import { insertMany } from "./flows.js";

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
    const items = parseBill(req.file.buffer, source);
    res.json({ count: items.length, items: items.slice(0, 1000) });
  })
);

// 确认导入：把前端确认后的条目写入
r.post(
  "/confirm",
  requireBook,
  wrap((req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "没有可导入的数据" });
    const n = insertMany(req.bookId, req.user.id, req.user.nickname, items, req.user.id);
    res.json({ imported: n });
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
    const n = insertMany(req.bookId, req.user.id, req.user.nickname, items, req.user.id);
    res.json({ imported: n });
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
    const n = insertMany(req.bookId, req.user.id, req.user.nickname, data.flows || [], req.user.id);
    res.json({ flows: n, categories: cats, budgets: buds });
  })
);

export default r;
