import { Router } from "express";
import dayjs from "dayjs";
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

// 某月的总结分析（区域 1~7 所需数据）
r.get(
  "/month-detail",
  requireBook,
  wrap((req, res) => {
    const ym = String(req.query.ym || "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym))
      return res.status(400).json({ error: "请传入 ym=YYYY-MM" });
    const bookId = req.bookId;
    const [yy, mm] = ym.split("-").map(Number);
    const today = dayjs();
    const isCurrent = ym === today.format("YYYY-MM");
    const monthEnd = dayjs(`${ym}-01`).endOf("month");
    const daysInMonth = monthEnd.date();
    const elapsed = isCurrent ? Math.min(today.date(), daysInMonth) : daysInMonth;

    // 全部有流水的月份（升序），用于对比窗口
    const allMonths = db
      .prepare("SELECT DISTINCT substr(flow_time,1,7) m FROM flows WHERE book_id=? ORDER BY m")
      .all(bookId)
      .map((x) => x.m);
    const idx = allMonths.indexOf(ym);

    // 区域 1：开始记账的第多少天
    const firstRow = db
      .prepare("SELECT MIN(flow_time) AS f FROM flows WHERE book_id=?")
      .get(bookId);
    const firstFlow = firstRow?.f ? firstRow.f.slice(0, 10) : "";
    let startDayCount = 0;
    if (firstFlow) {
      const endRef = isCurrent ? today : monthEnd;
      const d0 = dayjs(firstFlow);
      if (!endRef.isBefore(d0, "day")) {
        startDayCount = endRef.diff(d0, "day") + 1;
      }
    }

    // 本月收支
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
         FROM flows WHERE book_id=? AND substr(flow_time,1,7)=?`
      )
      .get(bookId, ym);
    const monthIncome = Number(agg.income) || 0;
    const monthExpense = Number(agg.expense) || 0;
    const monthBalance = monthIncome - monthExpense;

    // 区域 2：上月结余 = 本月之前所有流水的累计净结余
    const before = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income,
                COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
         FROM flows WHERE book_id=? AND flow_time < ?`
      )
      .get(bookId, `${ym}-01 00:00:00`);
    const lastMonthBalance =
      (Number(before.income) || 0) - (Number(before.expense) || 0);

    // 区域 3：支出分类饼图 + 最高 3 笔支出
    const expenseByCat = db
      .prepare(
        `SELECT category, COALESCE(SUM(amount),0) AS amount
         FROM flows WHERE book_id=? AND type='expense' AND substr(flow_time,1,7)=?
         GROUP BY category ORDER BY amount DESC`
      )
      .all(bookId, ym)
      .map((x) => ({
        category: x.category,
        amount: Number(x.amount),
        percent: monthExpense > 0 ? Math.round((Number(x.amount) / monthExpense) * 1000) / 10 : 0,
      }));
    const topExpenses = db
      .prepare(
        `SELECT id, flow_time, amount, category, description, payment_method
         FROM flows WHERE book_id=? AND type='expense' AND substr(flow_time,1,7)=?
         ORDER BY amount DESC, id DESC LIMIT 3`
      )
      .all(bookId, ym);

    // 区域 4：单日最高支出 + 日均支出
    const dayRows = db
      .prepare(
        `SELECT substr(flow_time,1,10) d, COALESCE(SUM(amount),0) AS s
         FROM flows WHERE book_id=? AND type='expense' AND substr(flow_time,1,7)=?
         GROUP BY d ORDER BY s DESC`
      )
      .all(bookId, ym);
    const highestDay = dayRows[0]
      ? { date: dayRows[0].d, amount: Number(dayRows[0].s) }
      : { date: "", amount: 0 };
    const dailyAvgExpense = elapsed > 0 ? monthExpense / elapsed : 0;

    // 区域 5 / 7：对比窗口（前 2 + 本月 + 后 2；无后续月份则向前补到 5 个）
    let lo = idx - 2;
    let hi = idx + 2;
    if (idx < 0) {
      lo = 0;
      hi = 4;
    } else {
      if (hi > allMonths.length - 1) {
        hi = allMonths.length - 1;
        lo = Math.max(0, hi - 4);
      }
      lo = Math.max(0, lo);
    }
    const windowMonths = idx < 0 ? [] : allMonths.slice(lo, hi + 1);
    const monthAgg = (m) => {
      const a = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income,
                  COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
           FROM flows WHERE book_id=? AND substr(flow_time,1,7)=?`
        )
        .get(bookId, m);
      return {
        ym: m,
        label: String(Number(m.slice(5, 7))),
        income: Number(a.income) || 0,
        expense: Number(a.expense) || 0,
      };
    };
    const expenseCompare = windowMonths.map(monthAgg);
    const incomeCompare = windowMonths.map(monthAgg);

    // 对比上月：分类变化 top3（支出 / 收入分别算）
    const catSums = (m, type) => {
      const rows = db
        .prepare(
          `SELECT category, COALESCE(SUM(amount),0) AS s
           FROM flows WHERE book_id=? AND type=? AND substr(flow_time,1,7)=?
           GROUP BY category`
        )
        .all(bookId, type, m);
      const map = {};
      for (const x of rows) map[x.category] = Number(x.s);
      return map;
    };
    const diffTop = (type) => {
      if (idx < 1) return [];
      const prev = catSums(allMonths[idx - 1], type);
      const cur = catSums(ym, type);
      const names = new Set([...Object.keys(prev), ...Object.keys(cur)]);
      const list = [];
      for (const c of names) {
        const delta = (cur[c] || 0) - (prev[c] || 0);
        if (Math.abs(delta) < 0.005) continue;
        list.push({
          category: c,
          prev: prev[c] || 0,
          cur: cur[c] || 0,
          delta: Math.round(delta * 100) / 100,
          dir: delta > 0 ? "up" : "down",
        });
      }
      list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return list.slice(0, 3);
    };

    // 区域 6：月收入 + 最高 3 笔收入
    const topIncomes = db
      .prepare(
        `SELECT id, flow_time, amount, category, description, payment_method
         FROM flows WHERE book_id=? AND type='income' AND substr(flow_time,1,7)=?
         ORDER BY amount DESC, id DESC LIMIT 3`
      )
      .all(bookId, ym);

    res.json({
      year: yy,
      month: mm,
      ym,
      startDayCount,
      firstFlow,
      thisMonth: { income: monthIncome, expense: monthExpense, balance: monthBalance },
      lastMonthBalance,
      expenseByCategory: expenseByCat,
      topExpenses,
      highestDayExpense: highestDay,
      dailyAvgExpense,
      expenseCompare,
      expenseChangeVsPrev: diffTop("expense"),
      monthIncome,
      topIncomes,
      incomeCompare,
      incomeChangeVsPrev: diffTop("income"),
    });
  })
);

export default r;
