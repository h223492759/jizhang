import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { resolveAttribution } from "./flows.js";
import { computeNextRun, generateDueRecurring, clampInt } from "../lib/recurring.js";
import { rebuildSuggest } from "../lib/suggest.js";

const r = Router();
r.use(auth);

// 列表
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const list = db
      .prepare(
        "SELECT * FROM recurring WHERE book_id=? ORDER BY freq, day_of_month, id"
      )
      .all(req.bookId);
    res.json(list);
  })
);

// 新增模板
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const type = b.type === "income" ? "income" : "expense";
    const amount = Number(b.amount);
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "金额必须大于0" });
    const freq = b.freq === "yearly" ? "yearly" : "monthly";
    const dayOfMonth = clampInt(b.day_of_month, 1, 31, 1);
    const monthOfYear = clampInt(b.month_of_year, 1, 12, 1);
    const next_run = computeNextRun(freq, dayOfMonth, monthOfYear);
    // 离线同步幂等：客户端 uuid 已存在则直接返回原 id
    const uuid = (b.client_uuid || "").toString().trim();
    if (uuid) {
      const ex = db
        .prepare("SELECT id FROM recurring WHERE book_id=? AND client_uuid=?")
        .get(req.bookId, uuid);
      if (ex) return res.json({ id: ex.id, next_run: computeNextRun(freq, dayOfMonth, monthOfYear), dup: true });
    }
    // 归属：默认按当前账号填充（共享账本双方都能看到对方的记录）
    const attr = resolveAttribution(req.bookId, req.user, b);
    const info = db
      .prepare(
        `INSERT INTO recurring (book_id,type,category,description,amount,payment_method,freq,day_of_month,month_of_year,note,next_run,attribution_uid,attribution,client_uuid)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        req.bookId,
        type,
        (b.category || "其他").trim(),
        (b.description || "").trim(),
        amount,
        (b.payment_method || "").trim(),
        freq,
        dayOfMonth,
        monthOfYear,
        (b.note || "").trim(),
        next_run,
        attr.uid,
        attr.text,
        uuid || null
      );
    res.json({ id: Number(info.lastInsertRowid), next_run });
  })
);

// 编辑模板
r.put(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const cur = db
      .prepare("SELECT * FROM recurring WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "模板不存在" });
    const type = b.type ? (b.type === "income" ? "income" : "expense") : cur.type;
    const amount = Number(b.amount);
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "金额必须大于0" });
    const freq = b.freq ? (b.freq === "yearly" ? "yearly" : "monthly") : cur.freq;
    const dayOfMonth =
      b.day_of_month != null
        ? clampInt(b.day_of_month, 1, 31, cur.day_of_month)
        : cur.day_of_month;
    const monthOfYear =
      b.month_of_year != null
        ? clampInt(b.month_of_year, 1, 12, cur.month_of_year)
        : cur.month_of_year;
    const next_run = computeNextRun(freq, dayOfMonth, monthOfYear);
    // 归属：若显式传了就改，否则保持原模板归属
    let attrUid = cur.attribution_uid;
    let attrText = cur.attribution;
    if (b.attribution_uid !== undefined || b.attribution !== undefined) {
      const attr = resolveAttribution(req.bookId, req.user, b);
      attrUid = attr.uid;
      attrText = attr.text;
    }
    db.prepare(
      `UPDATE recurring SET type=?,category=?,description=?,amount=?,payment_method=?,freq=?,day_of_month=?,month_of_year=?,note=?,next_run=?,attribution_uid=?,attribution=? WHERE id=?`
    ).run(
      type,
      (b.category || cur.category).trim(),
      (b.description || cur.description).trim(),
      amount,
      (b.payment_method || cur.payment_method).trim(),
      freq,
      dayOfMonth,
      monthOfYear,
      (b.note || cur.note).trim(),
      next_run,
      attrUid,
      attrText,
      cur.id
    );
    res.json({ ok: true, next_run });
  })
);

// 删除模板
r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM recurring WHERE id=? AND book_id=?").run(
      req.params.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

// 把到期待生成的模板落成真实流水
r.post(
  "/generate",
  requireBook,
  wrap((req, res) => {
    const n = generateDueRecurring(req.bookId, new Date());
    if (n > 0) rebuildSuggest(req.bookId); // 流水有变动 → 触发一次建议重建
    res.json({ ok: true, generated: n });
  })
);

export default r;
