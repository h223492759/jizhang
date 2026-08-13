import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 获取某年度预算 + 实际支出进度
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();

    const budgets = db
      .prepare("SELECT category, amount, expression FROM budgets WHERE book_id=? AND year=?")
      .all(req.bookId, year);
    const total = budgets.find((b) => b.category === "");
    const cats = budgets.filter((b) => b.category !== "");

    // 该年度实际支出（总 + 分类）
    const yearSpent = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM flows
         WHERE book_id=? AND type='expense' AND substr(flow_time,1,4)=?`
      )
      .get(req.bookId, String(year)).s;

    const catSpent = db
      .prepare(
        `SELECT category, SUM(amount) AS s FROM flows
         WHERE book_id=? AND type='expense' AND substr(flow_time,1,4)=?
         GROUP BY category`
      )
      .all(req.bookId, String(year));
    const spentMap = Object.fromEntries(catSpent.map((x) => [x.category, x.s]));

    // 全部分类（含未设预算的）的已花费，供前端「添加预算」时实时算剩余
    const allCats = db
      .prepare("SELECT name FROM categories WHERE book_id=? AND type='expense'")
      .all(req.bookId)
      .map((x) => x.name);
    const spentByCategory = {};
    for (const c of allCats) spentByCategory[c] = spentMap[c] || 0;

    res.json({
      year,
      total: {
        amount: total?.amount || 0,
        spent: yearSpent,
        remaining: (total?.amount || 0) - yearSpent,
        percent: total?.amount ? Math.round((yearSpent / total.amount) * 100) : 0,
      },
      categories: cats.map((c) => {
        const spent = spentMap[c.category] || 0;
        return {
          category: c.category,
          amount: c.amount,
          expression: c.expression || "",
          spent,
          remaining: c.amount - spent,
          percent: c.amount ? Math.round((spent / c.amount) * 100) : 0,
        };
      }),
      spentByCategory,
    });
  })
);

// 设置/更新预算（category 为空字符串代表年度总预算）
// 支持单分类（{category,amount}）或多分类批量（{categories:[...],amount}）
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const year = Number(req.body?.year) || new Date().getFullYear();
    const amount = Number(req.body?.amount);
    if (!(amount >= 0)) return res.status(400).json({ error: "金额不合法" });
    // 原始算式保留（如 "1000+200"），方便下次修改时回填
    const expression = (req.body?.expression || "").toString().trim();
    const cats = req.body?.categories && Array.isArray(req.body.categories)
      ? req.body.categories.map((c) => (c || "").trim()).filter(Boolean)
      : [(req.body?.category || "").trim()];

    // 多个分类时，传入的 amount 视为「这些分类的总预算」，按分类数平分后逐条写入，
    // 这样每个分类卡片显示的剩余 = 平分值 - 已花费，合计即输入的总预算。
    const per = cats.length > 1 ? amount / cats.length : amount;

    const stmt = db.prepare(
      `INSERT INTO budgets (book_id, year, category, amount, expression) VALUES (?,?,?,?,?)
       ON CONFLICT(book_id, year, category) DO UPDATE SET amount=excluded.amount, expression=excluded.expression`
    );
    const tx = db.transaction(() => {
      for (const category of cats) stmt.run(req.bookId, year, category, per, expression);
    });
    tx();
    res.json({ ok: true, count: cats.length, per, total: amount });
  })
);

// 复制预算：把 fromYear 的「年度总预算 + 分类预算」复制到 toYear（覆盖式）
r.post(
  "/copy",
  requireBook,
  wrap((req, res) => {
    const fromYear = Number(req.body?.fromYear);
    const toYear = Number(req.body?.toYear) || new Date().getFullYear();
    if (!fromYear) return res.status(400).json({ error: "请选择来源年份" });
    const rows = db
      .prepare("SELECT category, amount, expression FROM budgets WHERE book_id=? AND year=?")
      .all(req.bookId, fromYear);
    const stmt = db.prepare(
      `INSERT INTO budgets (book_id, year, category, amount, expression) VALUES (?,?,?,?,?)
       ON CONFLICT(book_id, year, category) DO UPDATE SET amount=excluded.amount, expression=excluded.expression`
    );
    const tx = db.transaction(() => {
      for (const r of rows) stmt.run(req.bookId, toYear, r.category, r.amount, r.expression || "");
    });
    tx();
    res.json({ ok: true, copied: rows.length });
  })
);

r.delete(
  "/",
  requireBook,
  wrap((req, res) => {
    const year = Number(req.query.year);
    const category = (req.query.category || "").trim();
    db.prepare("DELETE FROM budgets WHERE book_id=? AND year=? AND category=?").run(
      req.bookId,
      year,
      category
    );
    res.json({ ok: true });
  })
);

export default r;
