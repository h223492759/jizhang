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
      .prepare("SELECT category, amount FROM budgets WHERE book_id=? AND year=?")
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
          spent,
          remaining: c.amount - spent,
          percent: c.amount ? Math.round((spent / c.amount) * 100) : 0,
        };
      }),
    });
  })
);

// 设置/更新预算（category 为空字符串代表年度总预算）
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const year = Number(req.body?.year) || new Date().getFullYear();
    const category = (req.body?.category || "").trim();
    const amount = Number(req.body?.amount);
    if (!(amount >= 0)) return res.status(400).json({ error: "金额不合法" });
    db.prepare(
      `INSERT INTO budgets (book_id, year, category, amount) VALUES (?,?,?,?)
       ON CONFLICT(book_id, year, category) DO UPDATE SET amount=excluded.amount`
    ).run(req.bookId, year, category, amount);
    res.json({ ok: true });
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
