import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { parseFlowText, analyzeMonth, aiConfig, parseFlowImage } from "../lib/ai.js";

const r = Router();
r.use(auth);

r.get("/status", (req, res) => {
  const c = aiConfig();
  res.json({
    enabled: c.enabled,
    provider: c.provider || null,
    model: c.enabled ? c.model : null,
    imageModel: c.enabled ? c.imageModel : null,
  });
});

// 一句话解析（不入库，返回结果给前端确认）
r.post(
  "/parse",
  requireBook,
  async (req, res) => {
    try {
      const text = (req.body?.text || "").trim();
      if (!text) return res.status(400).json({ error: "请输入内容" });
      const cats = db
        .prepare("SELECT name, type FROM categories WHERE book_id=?")
        .all(req.bookId);
      const result = await parseFlowText(text, cats);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// 图片解析（小票 / 账单截图识别，使用视觉模型）
r.post(
  "/parse-image",
  requireBook,
  async (req, res) => {
    try {
      const { image, text } = req.body || {};
      if (!image) return res.status(400).json({ error: "请上传图片" });
      const cats = db
        .prepare("SELECT name, type FROM categories WHERE book_id=?")
        .all(req.bookId);
      const result = await parseFlowImage(image, text, cats);
      res.json(result);
    } catch (e) {
      const msg =
        e.message === "NO_AI"
          ? "未配置 AI 视觉模型，请先在「设置 → AI 记账」里填写图片模型与密钥"
          : e.message;
      res.status(e.message === "NO_AI" ? 400 : 500).json({ error: msg });
    }
  }
);

// 月度分析
r.get(
  "/analyze",
  requireBook,
  async (req, res) => {
    try {
      const month = req.query.month || dayjs().format("YYYY-MM");
      const prevMonth = dayjs(month + "-01").subtract(1, "month").format("YYYY-MM");

      const cur = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
             COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income
           FROM flows WHERE book_id=? AND substr(flow_time,1,7)=?`
        )
        .get(req.bookId, month);
      const prev = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
           FROM flows WHERE book_id=? AND substr(flow_time,1,7)=?`
        )
        .get(req.bookId, prevMonth);
      const top = db
        .prepare(
          `SELECT category AS name, SUM(amount) AS value
           FROM flows WHERE book_id=? AND type='expense' AND substr(flow_time,1,7)=?
           GROUP BY category ORDER BY value DESC LIMIT 5`
        )
        .all(req.bookId, month);

      const summary = {
        month,
        income: cur.income,
        expense: cur.expense,
        balance: cur.income - cur.expense,
        prevExpense: prev.expense,
        topCategories: top,
      };
      const text = await analyzeMonth(summary);
      res.json({ summary, analysis: text, ai: aiConfig().enabled });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default r;
