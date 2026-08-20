import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

/**
 * 名称候选词。四组数据，前端展示成可点击的标签：
 *  - presets  已收藏（★）的常用名称（置顶，可带默认分类/支付方式/金额）
 *  - frequent 未收藏（×N）建议：出现 ≥2 次，读物化表 preset_suggest
 *             （流水保存后 / 每日自动扫描时重建，不再每次实时聚合）
 *  - recent   最近用过的名称（按时间倒序，实时统计）
 *  - hidden   已取消显示（隐藏）的名称（点 × 后进入，置底灰色展示，可恢复）
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

    // 未收藏建议（×N）：读物化表，排除已收藏与已隐藏
    const frequent = db
      .prepare(
        `SELECT s.name, s.count, s.category, s.payment_method, s.avg_amount
           FROM preset_suggest s
          WHERE s.book_id=@bookId AND s.type=@type
            AND s.name NOT IN (SELECT name FROM presets WHERE book_id=@bookId AND type=@type)
            AND s.name NOT IN (SELECT name FROM hidden_names WHERE book_id=@bookId AND type=@type)
          ORDER BY s.count DESC, s.updated_at DESC
          LIMIT @limit`
      )
      .all({ bookId: req.bookId, type, limit });

    // 最近名称：实时统计，同样排除已收藏与已隐藏
    const lastOf = (field) =>
      `(SELECT f2.${field} FROM flows f2
         WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
         ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1)`;
    const recent = db
      .prepare(
        `SELECT f.description AS name, MAX(f.flow_time) AS last_time,
                ${lastOf("category")} AS category,
                ${lastOf("payment_method")} AS payment_method
           FROM flows f
          WHERE f.book_id=@bookId AND f.type=@type AND TRIM(f.description) <> ''
            AND f.description NOT IN (SELECT name FROM presets WHERE book_id=@bookId AND type=@type)
            AND f.description NOT IN (SELECT name FROM hidden_names WHERE book_id=@bookId AND type=@type)
          GROUP BY f.description
          ORDER BY last_time DESC
          LIMIT @limit`
      )
      .all({ bookId: req.bookId, type, limit });

    // 已取消显示（置底展示，可恢复）
    const hidden = db
      .prepare(
        `SELECT name, created_at FROM hidden_names
          WHERE book_id=? AND type=?
          ORDER BY created_at DESC`
      )
      .all(req.bookId, type);

    res.json({ presets, frequent, recent, hidden });
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

// 取消显示（第三态）：从已收藏移除 + 记入 hidden_names，页面置底灰色展示
r.post(
  "/hide",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const name = (b.name || "").trim();
    const type = b.type === "income" ? "income" : "expense";
    if (!name) return res.status(400).json({ error: "名称不能为空" });
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM presets WHERE book_id=? AND type=? AND name=?").run(
        req.bookId,
        type,
        name
      );
      db.prepare(
        "INSERT OR IGNORE INTO hidden_names (book_id, type, name) VALUES (?,?,?)"
      ).run(req.bookId, type, name);
    });
    tx();
    res.json({ ok: true });
  })
);

// 恢复显示：从 hidden_names 移除（若频次 ≥2 会重新出现在未收藏建议里）
r.post(
  "/unhide",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const name = (b.name || "").trim();
    const type = b.type === "income" ? "income" : "expense";
    if (!name) return res.status(400).json({ error: "名称不能为空" });
    db.prepare("DELETE FROM hidden_names WHERE book_id=? AND type=? AND name=?").run(
      req.bookId,
      type,
      name
    );
    res.json({ ok: true });
  })
);

export default r;
