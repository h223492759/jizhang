import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 取一个名称在流水里的实时统计（count + 最近一次的分类/支付方式 + 平均金额）。
// 用于"取消收藏"时把名称写回 preset_suggest，保证低频（<2次）或纯手工的名称
// 仍能在 ×N 未收藏建议区可见，不会被"消失"。
function flowStats(bookId, type, name) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS cnt,
              (SELECT f2.category FROM flows f2
                 WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
                 ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1) AS category,
              (SELECT f2.payment_method FROM flows f2
                 WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
                 ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1) AS payment_method,
              ROUND(AVG(f.amount), 2) AS avg_amount
         FROM flows f
        WHERE f.book_id=? AND f.type=? AND f.description=?`
    )
    .get(bookId, type, name);
  return {
    cnt: r?.cnt || 0,
    category: r?.category || "",
    payment_method: r?.payment_method || "",
    avg_amount: r?.avg_amount || 0,
  };
}

// 把一个名称写回 preset_suggest（保证取消收藏后仍可见）
function upsertSuggest(bookId, type, name, category, payment_method, avg_amount, cnt) {
  db.prepare(
    `INSERT OR REPLACE INTO preset_suggest
       (book_id, type, name, count, category, payment_method, avg_amount, updated_at)
     VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))`
  ).run(bookId, type, name, cnt, category || "", payment_method || "", avg_amount || 0);
}

/**
 * 名称候选词。四组数据，前端展示成可点击的标签：
 *  - presets   已收藏（★），存在 presets 表
 *  - frequent  未收藏（×N）建议：读物化表 preset_suggest
 *              （流水保存后 / 每日自动扫描时重建；取消收藏时也会写入）
 *  - recent    最近用过的名称（按时间倒序，实时统计）
 *  - hidden    已取消显示（隐藏）的名称，按分类返回，置底灰色按分类分组展示，可恢复
 */
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const type = req.query.type === "income" ? "income" : "expense";
    const limit = Math.min(Number(req.query.limit) || 60, 200);

    const presets = db
      .prepare(
        `SELECT id, name, type, category, payment_method, amount, sort
           FROM presets WHERE book_id=? AND type=?
          ORDER BY sort, id`
      )
      .all(req.bookId, type);

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

    // 已取消显示：按分类返回，页面按分类分组展示
    const hidden = db
      .prepare(
        `SELECT name, category, created_at FROM hidden_names
          WHERE book_id=? AND type=?
          ORDER BY created_at DESC`
      )
      .all(req.bookId, type);

    res.json({ presets, frequent, recent, hidden });
  })
);

// 新增常用消费名称（收藏）
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

// 重要：/all 必须注册在 /:id 之前，否则 DELETE /all 会被 /:id 截胡，
// 把它当成 id="all" 删个寂寞（0 行变更），前端收到 ok=true 但 ★ 一个没少。
// 一批量取消收藏：把该类型所有 ★ 全部移回 ×N 未收藏建议区（不是删除，流水不受影响）。
// 用于一次性清理历史残留（比如（之前自动入收藏留下的 ★）。
r.delete(
  "/all",
  requireBook,
  wrap((req, res) => {
    const type = req.query.type === "income" ? "income" : "expense";
    // 先取出要取消收藏的所有名称（含分类/支付方式等元数据）
    const rows = db
      .prepare(
        "SELECT id, name, category, payment_method, amount FROM presets WHERE book_id=? AND type=?"
      )
      .all(req.bookId, type);
    if (rows.length === 0) return res.json({ ok: true, deleted: 0 });

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM presets WHERE book_id=? AND type=?").run(
        req.bookId,
        type
      );
      // 把每个名称写回 preset_suggest（即使 count=0），保证它们仍可见
      for (const r of rows) {
        const st = flowStats(req.bookId, type, r.name);
        upsertSuggest(
          req.bookId,
          type,
          r.name,
          r.category || st.category,
          r.payment_method || st.payment_method,
          st.avg_amount,
          st.cnt
        );
      }
    });
    tx();
    res.json({ ok: true, deleted: rows.length });
  })
);

// 取消收藏单个 ★：从 presets 移除，同时写回 preset_suggest（保证仍可见）
r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const cur = db
      .prepare("SELECT * FROM presets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "记录不存在" });
    const st = flowStats(req.bookId, cur.type, cur.name);
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM presets WHERE id=? AND book_id=?").run(
        cur.id,
        req.bookId
      );
      // 把名称写回 preset_suggest（即使 count=0），低频/纯手工的也不再消失
      upsertSuggest(
        req.bookId,
        cur.type,
        cur.name,
        cur.category || st.category,
        cur.payment_method || st.payment_method,
        st.avg_amount,
        st.cnt
      );
    });
    tx();
    res.json({ ok: true });
  })
);

// 取消显示（第三态）：从已收藏移除 + 记入 hidden_names（带分类，页面按分类分组展示）
r.post(
  "/hide",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const name = (b.name || "").trim();
    const type = b.type === "income" ? "income" : "expense";
    if (!name) return res.status(400).json({ error: "名称不能为空" });
    // 分类取自：① 还在 presets 里的；② 最近一次流水里的；③ 都没有则空
    const p = db
      .prepare(
        "SELECT category FROM presets WHERE book_id=? AND type=? AND name=?"
      )
      .get(req.bookId, type, name);
    const st = flowStats(req.bookId, type, name);
    const category = (p && p.category) || st.category || "";
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM presets WHERE book_id=? AND type=? AND name=?").run(
        req.bookId,
        type,
        name
      );
      db.prepare(
        "INSERT OR REPLACE INTO hidden_names (book_id, type, name, category) VALUES (?,?,?,?)"
      ).run(req.bookId, type, name, category);
    });
    tx();
    res.json({ ok: true });
  })
);

// 恢复显示：从 hidden_names 移除（频次 ≥2 会重新出现在未收藏建议里）
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