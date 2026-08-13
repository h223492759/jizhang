import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 可选年份（有流水的年份，倒序）
function yearList(bookId) {
  return db
    .prepare(
      "SELECT DISTINCT substr(flow_time,1,4) AS y FROM flows WHERE book_id=? ORDER BY y DESC"
    )
    .all(bookId)
    .map((x) => Number(x.y));
}

// 月账单：某一年的年汇总 + 12 个月的收入/支出/结余
r.get(
  "/monthly",
  requireBook,
  wrap((req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const rows = db
      .prepare(
        `SELECT substr(flow_time,1,7) AS month,
                COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
                COUNT(*) AS count
         FROM flows
         WHERE book_id=? AND substr(flow_time,1,4)=?
         GROUP BY month ORDER BY month`
      )
      .all(req.bookId, String(year));
    const map = Object.fromEntries(rows.map((x) => [x.month, x]));

    // 补齐 12 个月，没有流水的月份显示 0
    const list = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const x = map[key] || { month: key, income: 0, expense: 0, count: 0 };
      list.push({
        month: key,
        label: `${m}月`,
        income: x.income,
        expense: x.expense,
        balance: x.income - x.expense,
        count: x.count,
      });
    }
    const income = list.reduce((s, x) => s + x.income, 0);
    const expense = list.reduce((s, x) => s + x.expense, 0);
    const count = list.reduce((s, x) => s + x.count, 0);

    res.json({
      year,
      years: yearList(req.bookId),
      summary: { income, expense, balance: income - expense, count },
      rows: list,
    });
  })
);

// 年账单：全部年份的总汇总 + 每年的收入/支出/结余
r.get(
  "/yearly",
  requireBook,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT substr(flow_time,1,4) AS year,
                COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
                COUNT(*) AS count
         FROM flows
         WHERE book_id=?
         GROUP BY year ORDER BY year DESC`
      )
      .all(req.bookId);

    const list = rows.map((x) => ({
      year: Number(x.year),
      label: `${x.year}年`,
      income: x.income,
      expense: x.expense,
      balance: x.income - x.expense,
      count: x.count,
    }));
    const income = list.reduce((s, x) => s + x.income, 0);
    const expense = list.reduce((s, x) => s + x.expense, 0);
    const count = list.reduce((s, x) => s + x.count, 0);

    res.json({
      summary: { income, expense, balance: income - expense, count },
      rows: list,
    });
  })
);

export default r;
