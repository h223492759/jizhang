import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { parseFlowText } from "../lib/ai.js";

const r = Router();
r.use(auth);

/**
 * 商户 → 分类 映射（AI 自动记账学习闭环）：
 * - POST /           用户确认/修改分类时写入（count+1 累计）
 * - GET /            返回本账本映射表（备用）
 * - POST /classify   弹窗分类：先查映射命中直接返回（不调模型），否则 AI 分类
 */

// 写入/累加映射
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const merchant = String(req.body?.merchant || "").trim();
    const category = String(req.body?.category || "").trim();
    if (!merchant || !category) return res.status(400).json({ error: "merchant 和 category 必填" });
    const ex = db
      .prepare("SELECT category, count FROM merchant_cats WHERE book_id=? AND merchant=?")
      .get(req.bookId, merchant);
    if (ex) {
      db.prepare(
        "UPDATE merchant_cats SET category=?, count=count+1, updated_at=datetime('now','localtime') WHERE book_id=? AND merchant=?"
      ).run(category, req.bookId, merchant);
    } else {
      db.prepare(
        "INSERT INTO merchant_cats (book_id, merchant, category) VALUES (?,?,?)"
      ).run(req.bookId, merchant, category);
    }
    res.json({ ok: true, hit: !!ex, count: (ex?.count || 0) + 1 });
  })
);

// 查询映射表
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const rows = db
      .prepare("SELECT merchant, category, count FROM merchant_cats WHERE book_id=? ORDER BY count DESC")
      .all(req.bookId);
    res.json({ list: rows });
  })
);

// 弹窗分类：先映射，命中直接返回；否则走 AI/规则分类
r.post(
  "/classify",
  requireBook,
  wrap(async (req, res) => {
    const merchant = String(req.body?.merchant || "").trim();
    const text = String(req.body?.text || "").trim();
    const type = req.body?.type === "income" ? "income" : "expense";

    // 1) 映射命中（高频商户，直接返回，不调模型）
    if (merchant) {
      const hit = db
        .prepare("SELECT category FROM merchant_cats WHERE book_id=? AND merchant=?")
        .get(req.bookId, merchant);
      if (hit && hit.category) {
        return res.json({
          category: hit.category,
          amount: Number(req.body?.amount) || 0,
          description: merchant,
          type,
          payment_method: req.body?.payment_method || "",
          hit: true,
          from: "map",
        });
      }
    }
    // 2) AI/规则分类
    const cats = db
      .prepare("SELECT name, type FROM categories WHERE book_id=? ORDER BY sort, id")
      .all(req.bookId)
      .map((c) => ({ name: c.name, type: c.type }));
    let result;
    try {
      result = await parseFlowText(text, cats);
    } catch (e) {
      result = {
        type,
        amount: Number(req.body?.amount) || 0,
        category: type === "income" ? "其它" : "其他",
        description: merchant || text.slice(0, 20),
        payment_method: "",
        source: "rule",
      };
    }
    res.json({
      category: result.category,
      amount: Number(result.amount) || Number(req.body?.amount) || 0,
      description: result.description || merchant,
      type: result.type || type,
      payment_method: result.payment_method || req.body?.payment_method || "",
      hit: false,
      from: "ai",
    });
  })
);

export default r;
