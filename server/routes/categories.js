import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { rebuildSuggest } from "../lib/suggest.js";

const r = Router();
r.use(auth);

r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    // 每个分类附带其历史流水中使用次数（用于删除前判断是否有数据 / 前端展示）
    const rows = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM flows f
                  WHERE f.book_id=c.book_id AND f.type=c.type AND f.category=c.name) AS flow_count
           FROM categories c
          WHERE c.book_id=?
          ORDER BY c.type, c.sort, c.id`
      )
      .all(req.bookId);
    res.json(rows);
  })
);

r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const { name, type, icon, color } = req.body || {};
    if (!name || !["expense", "income"].includes(type))
      return res.status(400).json({ error: "参数错误" });
    const n = name.trim();
    // 离线同步幂等：客户端 uuid 已存在则直接返回原 id
    const uuid = (req.body?.client_uuid || "").toString().trim();
    if (uuid) {
      const ex = db
        .prepare("SELECT id FROM categories WHERE book_id=? AND client_uuid=?")
        .get(req.bookId, uuid);
      if (ex) return res.json({ id: ex.id, dup: true });
    }
    // 同类型下不允许重名（不区分大小写）
    const dup = db
      .prepare("SELECT id FROM categories WHERE book_id=? AND type=? AND lower(name)=lower(?)")
      .get(req.bookId, type, n);
    if (dup) return res.status(400).json({ error: `分类「${n}」已存在` });
    const maxSort =
      db
        .prepare("SELECT MAX(sort) AS m FROM categories WHERE book_id=? AND type=?")
        .get(req.bookId, type).m || 0;
    const info = db
      .prepare(
        "INSERT INTO categories (book_id, name, type, icon, color, sort, client_uuid) VALUES (?,?,?,?,?,?,?)"
      )
      .run(req.bookId, name.trim(), type, icon || "💰", color || "#7c8cff", maxSort + 1, uuid || null);
    res.json({ id: info.lastInsertRowid });
  })
);

r.put(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const { name, icon, color } = req.body || {};
    const cat = db
      .prepare("SELECT * FROM categories WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cat) return res.status(404).json({ error: "分类不存在" });
    const n = (name || "").trim();
    // 改名时若与同类型其他分类重名则拒绝
    if (n && n !== cat.name) {
      const dup = db
        .prepare("SELECT id FROM categories WHERE book_id=? AND type=? AND lower(name)=lower(?) AND id<>?")
        .get(req.bookId, cat.type, n, cat.id);
      if (dup) return res.status(400).json({ error: `分类「${n}」已存在` });
    }
    db.prepare("UPDATE categories SET name=?, icon=?, color=? WHERE id=?").run(
      name?.trim() || cat.name,
      icon || cat.icon,
      color || cat.color,
      cat.id
    );
    // 同步更新历史流水里的分类名
    if (name && name.trim() !== cat.name) {
      db.prepare(
        "UPDATE flows SET category=? WHERE book_id=? AND category=? AND type=?"
      ).run(name.trim(), req.bookId, cat.name, cat.type);
      // 分类改名后，preset_suggest 里的 category 是旧名 → 立即重建保持一致
      try { rebuildSuggest(req.bookId); } catch (_) {}
    }
    res.json({ ok: true });
  })
);

// 扫流水：把出现但 categories 表里没有的分类补上。用于导入很多流水后一键补齐分类。
// 按（分类名 + 类型）去重：同名同类型已存在则跳过；同名不同类型（如"餐饮"做支出 + 收入）允许并存。
r.post(
  "/scan",
  requireBook,
  wrap((req, res) => {
    const flowRows = db
      .prepare(
        `SELECT category AS name, type, COUNT(*) AS cnt
           FROM flows WHERE book_id=? AND TRIM(category) <> ''
          GROUP BY category, type`
      )
      .all(req.bookId);
    const exist = db
      .prepare("SELECT lower(name) AS n, type FROM categories WHERE book_id=?")
      .all(req.bookId);
    const existSet = new Set(exist.map((x) => `${x.type}::${x.n}`));

    const insertStmt = db.prepare(
      "INSERT INTO categories (book_id, name, type, icon, color, sort) VALUES (?,?,?,?,?,?)"
    );
    const maxSortStmt = db.prepare(
      "SELECT COALESCE(MAX(sort),0) AS m FROM categories WHERE book_id=? AND type=?"
    );
    const addedItems = [];
    let skipped = 0;
    const tx = db.transaction(() => {
      for (const f of flowRows) {
        const n = (f.name || "").trim();
        if (!n) continue;
        const key = `${f.type}::${n.toLowerCase()}`;
        if (existSet.has(key)) {
          skipped++;
          continue;
        }
        const ms = maxSortStmt.get(req.bookId, f.type).m || 0;
        insertStmt.run(req.bookId, n, f.type, "💰", "#7c8cff", ms + 1);
        existSet.add(key);
        addedItems.push({ name: n, type: f.type, count: f.cnt });
      }
    });
    tx();
    res.json({ added: addedItems.length, skipped, scanned: flowRows.length, items: addedItems });
  })
);

r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const cat = db
      .prepare("SELECT * FROM categories WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cat) return res.status(404).json({ error: "分类不存在" });
    // 该分类下的流水数（用于决定删除流程：0 数据直接删，>0 数据需合并）
    const flowCount = db
      .prepare("SELECT COUNT(*) AS c FROM flows WHERE book_id=? AND category=? AND type=?")
      .get(req.bookId, cat.name, cat.type).c || 0;

    const mergeTo = req.query.mergeTo;
    if (flowCount > 0) {
      if (!mergeTo) {
        return res.status(409).json({
          error: `分类「${cat.name}」下有 ${flowCount} 条流水，请选择并入哪个分类后再删`,
          flowCount,
          categoryId: cat.id,
        });
      }
      const target = db
        .prepare("SELECT * FROM categories WHERE id=? AND book_id=? AND type=?")
        .get(Number(mergeTo), req.bookId, cat.type);
      if (!target) return res.status(400).json({ error: "目标分类不存在或类型不匹配" });
      if (target.id === cat.id) return res.status(400).json({ error: "目标不能是原分类" });
      const tx = db.transaction(() => {
        // 把源分类下的流水全部改成目标分类名
        db.prepare(
          "UPDATE flows SET category=? WHERE book_id=? AND category=? AND type=?"
        ).run(target.name, req.bookId, cat.name, cat.type);
        db.prepare("DELETE FROM categories WHERE id=? AND book_id=?").run(
          cat.id,
          req.bookId
        );
      });
      tx();
      return res.json({ ok: true, merged: flowCount, into: target.id });
    }
    // 0 数据：直接删
    db.prepare("DELETE FROM categories WHERE id=? AND book_id=?").run(
      cat.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

// 调序：传入同一类型下分类的 id 顺序数组，按数组下标写入 sort
r.post(
  "/reorder",
  requireBook,
  wrap((req, res) => {
    const ids = (req.body?.ids || []).map(Number).filter((n) => n > 0);
    if (!ids.length) return res.status(400).json({ error: "缺少排序数据" });
    const stmt = db.prepare("UPDATE categories SET sort=? WHERE id=? AND book_id=?");
    const tx = db.transaction(() => {
      ids.forEach((id, i) => stmt.run(i + 1, id, req.bookId));
    });
    tx();
    res.json({ ok: true });
  })
);

export default r;
