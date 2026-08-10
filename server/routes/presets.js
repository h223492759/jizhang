import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

/**
 * 名称候选词。三组数据，前端展示成可点击的标签：
 *  - presets  手动预设的常用消费名称（置顶，可带默认分类/支付方式/金额）
 *  - frequent 该账本用得最多的名称（按出现次数）
 *  - recent   最近用过的名称（按时间倒序）
 * 后两组从流水里实时统计，越用越准，不需要维护。
 */
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const type = req.query.type === "income" ? "income" : "expense";
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const presets = db
      .prepare(
        `SELECT id, name, type, category, payment_method, amount, sort
           FROM presets WHERE book_id=? AND type=?
          ORDER BY sort, id`
      )
      .all(req.bookId, type);

    // 同一名称取它最近一次用的分类/支付方式，点击时一并带出
    const lastOf = (field) =>
      `(SELECT f2.${field} FROM flows f2
         WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
         ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1)`;

    const frequent = db
      .prepare(
        `SELECT f.description AS name, COUNT(*) AS count,
                ${lastOf("category")} AS category,
                ${lastOf("payment_method")} AS payment_method,
                ROUND(AVG(f.amount), 2) AS avg_amount
           FROM flows f
          WHERE f.book_id=@bookId AND f.type=@type AND TRIM(f.description) <> ''
          GROUP BY f.description
         HAVING COUNT(*) >= 2
          ORDER BY count DESC, MAX(f.flow_time) DESC
          LIMIT @limit`
      )
      .all({ bookId: req.bookId, type, limit });

    const recent = db
      .prepare(
        `SELECT f.description AS name, MAX(f.flow_time) AS last_time,
                ${lastOf("category")} AS category,
                ${lastOf("payment_method")} AS payment_method
           FROM flows f
          WHERE f.book_id=@bookId AND f.type=@type AND TRIM(f.description) <> ''
          GROUP BY f.description
          ORDER BY last_time DESC
          LIMIT @limit`
      )
      .all({ bookId: req.bookId, type, limit });

    // 去重：已置顶为常用的、以及已在高频里出现的，不在后面的分组重复展示
    const presetNames = new Set(presets.map((x) => x.name));
    const freq = frequent.filter((x) => !presetNames.has(x.name));
    const freqNames = new Set(freq.map((x) => x.name));
    const rec = recent.filter(
      (x) => !presetNames.has(x.name) && !freqNames.has(x.name)
    );

    res.json({ presets, frequent: freq, recent: rec });
  })
);

// 新增常用消费名称
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const name = (b.name || "").trim();
    if (!name) return res.status(400).json({ error: "名称不能为空" });
    if (name.length > 30) return res.status(400).json({ error: "名称最多 30 字" });
    const type = b.type === "income" ? "income" : "expense";
    const dup = db
      .prepare("SELECT id FROM presets WHERE book_id=? AND type=? AND name=?")
      .get(req.bookId, type, name);
    if (dup) return res.status(400).json({ error: "该常用名称已存在" });

    const maxSort =
      db
        .prepare("SELECT COALESCE(MAX(sort),0) AS s FROM presets WHERE book_id=?")
        .get(req.bookId).s || 0;
    const info = db
      .prepare(
        `INSERT INTO presets (book_id, name, type, category, payment_method, amount, sort)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        req.bookId,
        name,
        type,
        (b.category || "").trim(),
        (b.payment_method || "").trim(),
        Number(b.amount) > 0 ? Number(b.amount) : 0,
        maxSort + 1
      );
    res.json({ id: info.lastInsertRowid });
  })
);

r.put(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const cur = db
      .prepare("SELECT * FROM presets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "记录不存在" });
    const b = req.body || {};
    db.prepare(
      `UPDATE presets SET name=?, category=?, payment_method=?, amount=?, sort=? WHERE id=?`
    ).run(
      (b.name ?? cur.name).trim(),
      (b.category ?? cur.category).trim(),
      (b.payment_method ?? cur.payment_method).trim(),
      b.amount === undefined ? cur.amount : Number(b.amount) || 0,
      b.sort === undefined ? cur.sort : Number(b.sort) || 0,
      cur.id
    );
    res.json({ ok: true });
  })
);

r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM presets WHERE id=? AND book_id=?").run(
      req.params.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

export default r;
