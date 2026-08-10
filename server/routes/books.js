import { Router } from "express";
import { db, seedCategories } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 我能访问的账本列表（含成员数、我的角色）
r.get(
  "/",
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT b.id, b.name, b.owner_id, bm.role,
                (SELECT COUNT(*) FROM book_members m WHERE m.book_id=b.id) AS members,
                (SELECT COUNT(*) FROM flows f WHERE f.book_id=b.id) AS flows
         FROM books b
         JOIN book_members bm ON bm.book_id=b.id
         WHERE bm.user_id=?
         ORDER BY b.id`
      )
      .all(req.user.id);
    res.json(rows);
  })
);

// 新建账本
r.post(
  "/",
  wrap((req, res) => {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "账本名称必填" });
    const info = db
      .prepare("INSERT INTO books (name, owner_id) VALUES (?,?)")
      .run(name, req.user.id);
    const bid = info.lastInsertRowid;
    db.prepare(
      "INSERT INTO book_members (book_id, user_id, role) VALUES (?,?, 'owner')"
    ).run(bid, req.user.id);
    seedCategories(bid);
    res.json({ id: bid, name });
  })
);

// 重命名
r.put(
  "/:bookId",
  requireBook,
  wrap((req, res) => {
    if (req.bookRole !== "owner")
      return res.status(403).json({ error: "只有拥有者可以修改账本" });
    const name = (req.body?.name || "").trim();
    db.prepare("UPDATE books SET name=? WHERE id=?").run(name, req.bookId);
    res.json({ ok: true });
  })
);

// 删除账本（连带流水/分类/预算/成员）
r.delete(
  "/:bookId",
  requireBook,
  wrap((req, res) => {
    if (req.bookRole !== "owner")
      return res.status(403).json({ error: "只有拥有者可以删除账本" });
    const bid = req.bookId;
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM flows WHERE book_id=?").run(bid);
      db.prepare("DELETE FROM categories WHERE book_id=?").run(bid);
      db.prepare("DELETE FROM budgets WHERE book_id=?").run(bid);
      db.prepare("DELETE FROM book_members WHERE book_id=?").run(bid);
      db.prepare("DELETE FROM books WHERE id=?").run(bid);
    });
    tx();
    res.json({ ok: true });
  })
);

// 成员管理：查看
r.get(
  "/:bookId/members",
  requireBook,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, bm.role
         FROM book_members bm JOIN users u ON u.id=bm.user_id
         WHERE bm.book_id=? ORDER BY bm.role DESC, u.id`
      )
      .all(req.bookId);
    res.json(rows);
  })
);

// 共享账本：按用户名邀请成员
r.post(
  "/:bookId/members",
  requireBook,
  wrap((req, res) => {
    if (req.bookRole !== "owner")
      return res.status(403).json({ error: "只有拥有者可以添加成员" });
    const username = (req.body?.username || "").trim();
    const user = db.prepare("SELECT id FROM users WHERE username=?").get(username);
    if (!user) return res.status(404).json({ error: "该用户不存在" });
    const exists = db
      .prepare("SELECT 1 FROM book_members WHERE book_id=? AND user_id=?")
      .get(req.bookId, user.id);
    if (exists) return res.status(400).json({ error: "该用户已是成员" });
    db.prepare(
      "INSERT INTO book_members (book_id, user_id, role) VALUES (?,?, 'editor')"
    ).run(req.bookId, user.id);
    res.json({ ok: true });
  })
);

// 移除成员
r.delete(
  "/:bookId/members/:userId",
  requireBook,
  wrap((req, res) => {
    if (req.bookRole !== "owner")
      return res.status(403).json({ error: "只有拥有者可以移除成员" });
    const uid = Number(req.params.userId);
    const owner = db.prepare("SELECT owner_id FROM books WHERE id=?").get(req.bookId);
    if (owner.owner_id === uid)
      return res.status(400).json({ error: "不能移除账本拥有者" });
    db.prepare("DELETE FROM book_members WHERE book_id=? AND user_id=?").run(
      req.bookId,
      uid
    );
    res.json({ ok: true });
  })
);

export default r;
