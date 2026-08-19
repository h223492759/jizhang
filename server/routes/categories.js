import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const rows = db
      .prepare("SELECT * FROM categories WHERE book_id=? ORDER BY type, sort, id")
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
    }
    res.json({ ok: true });
  })
);

r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM categories WHERE id=? AND book_id=?").run(
      req.params.id,
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
