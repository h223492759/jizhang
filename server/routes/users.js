import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, createUserWithBook } from "../db.js";
import { auth, requireAdmin, wrap } from "../mw.js";

const r = Router();
r.use(auth, requireAdmin);

// 用户列表（含账本数、流水数，方便管理员判断能不能删）
r.get(
  "/",
  wrap((req, res) => {
    const list = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, u.role, u.created_at,
                (SELECT COUNT(*) FROM book_members bm WHERE bm.user_id = u.id) AS books,
                (SELECT COUNT(*) FROM flows f WHERE f.attribution_uid = u.id)  AS flows
           FROM users u ORDER BY u.id`
      )
      .all();
    res.json(list);
  })
);

// 新增用户（自动创建其默认账本与默认分类）
r.post(
  "/",
  wrap((req, res) => {
    const { username, password, nickname, role } = req.body || {};
    const uname = (username || "").trim();
    if (!uname || !password)
      return res.status(400).json({ error: "用户名和密码必填" });
    if (String(password).length < 6)
      return res.status(400).json({ error: "密码至少 6 位" });
    if (db.prepare("SELECT id FROM users WHERE username=?").get(uname))
      return res.status(400).json({ error: "用户名已存在" });
    const nick = (nickname || "").trim() || uname;
    if (db.prepare("SELECT id FROM users WHERE nickname=?").get(nick))
      return res
        .status(400)
        .json({ error: "昵称已被占用，昵称同时用于账单归属，需保持唯一" });

    const u = createUserWithBook({
      username: uname,
      password,
      nickname: nick,
      role: role === "admin" ? "admin" : "user",
    });
    res.json({ ok: true, user: u });
  })
);

// ---------------- 历史归属修复 ----------------
// 早期版本把归属人当成纯文本存，改昵称后老账单不会跟着变（例如仍显示旧的「管理员」）。
// 这里列出所有还没绑定到用户的归属文本，让管理员显式指认它属于谁，绑定后永久自动同步。
r.get(
  "/attributions/unbound",
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT f.attribution AS name, COUNT(*) AS count,
                COUNT(DISTINCT f.book_id) AS books,
                MIN(f.flow_time) AS first_time, MAX(f.flow_time) AS last_time
           FROM flows f
          WHERE f.attribution_uid IS NULL AND TRIM(f.attribution) <> ''
          GROUP BY f.attribution
          ORDER BY count DESC`
      )
      .all();
    res.json(rows);
  })
);

r.post(
  "/attributions/bind",
  wrap((req, res) => {
    const from = (req.body?.from || "").trim();
    const userId = Number(req.body?.userId);
    if (!from) return res.status(400).json({ error: "缺少要绑定的归属名称" });
    const u = db.prepare("SELECT id, nickname FROM users WHERE id=?").get(userId);
    if (!u) return res.status(404).json({ error: "目标用户不存在" });

    const info = db
      .prepare(
        `UPDATE flows SET attribution_uid = @uid, attribution = @nick
          WHERE attribution_uid IS NULL AND attribution = @from`
      )
      .run({ uid: u.id, nick: u.nickname, from });
    res.json({ ok: true, updated: info.changes, nickname: u.nickname });
  })
);

// 修改：昵称 / 角色 / 重置密码
r.put(
  "/:id",
  wrap((req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!target) return res.status(404).json({ error: "用户不存在" });
    const { nickname, role, password } = req.body || {};

    db.transaction(() => {
      if (nickname && nickname.trim() && nickname.trim() !== target.nickname) {
        const nick = nickname.trim();
        const dup = db
          .prepare("SELECT id FROM users WHERE nickname=? AND id<>?")
          .get(nick, id);
        if (dup) throw new Error("昵称已被占用");
        db.prepare("UPDATE users SET nickname=? WHERE id=?").run(nick, id);
        // 与个人设置改昵称保持一致：认领历史文本 + 刷新冗余字段
        db.prepare(
          `UPDATE flows SET attribution_uid = @id
            WHERE attribution_uid IS NULL
              AND attribution = @oldNick
              AND book_id IN (SELECT book_id FROM book_members WHERE user_id = @id)`
        ).run({ id, oldNick: target.nickname });
        db.prepare("UPDATE flows SET attribution=? WHERE attribution_uid=?").run(
          nick,
          id
        );
      }

      if (role && role !== target.role) {
        // 不允许把最后一个管理员降级
        if (target.role === "admin" && role !== "admin") {
          const admins = db
            .prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'")
            .get().n;
          if (admins <= 1) throw new Error("至少要保留一个管理员");
        }
        db.prepare("UPDATE users SET role=? WHERE id=?").run(
          role === "admin" ? "admin" : "user",
          id
        );
      }

      if (password) {
        if (String(password).length < 6) throw new Error("密码至少 6 位");
        db.prepare("UPDATE users SET password=? WHERE id=?").run(
          bcrypt.hashSync(password, 10),
          id
        );
      }
    })();

    const user = db
      .prepare("SELECT id, username, nickname, role FROM users WHERE id=?")
      .get(id);
    res.json({ ok: true, user });
  })
);

// 删除用户
// 规则：不能删自己、不能删最后一个管理员；
// 其名下账本若还有其他成员 → 移交给最早加入的成员；否则连同数据一起删除。
r.delete(
  "/:id",
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id)
      return res.status(400).json({ error: "不能删除当前登录的自己" });
    const target = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!target) return res.status(404).json({ error: "用户不存在" });
    if (target.role === "admin") {
      const admins = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'")
        .get().n;
      if (admins <= 1) return res.status(400).json({ error: "至少要保留一个管理员" });
    }

    let removedBooks = 0;
    let movedBooks = 0;
    db.transaction(() => {
      const owned = db.prepare("SELECT id FROM books WHERE owner_id=?").all(id);
      for (const b of owned) {
        const heir = db
          .prepare(
            "SELECT user_id FROM book_members WHERE book_id=? AND user_id<>? ORDER BY user_id LIMIT 1"
          )
          .get(b.id, id);
        if (heir) {
          db.prepare("UPDATE books SET owner_id=? WHERE id=?").run(heir.user_id, b.id);
          db.prepare(
            "UPDATE book_members SET role='owner' WHERE book_id=? AND user_id=?"
          ).run(b.id, heir.user_id);
          movedBooks++;
        } else {
          db.prepare("DELETE FROM flows WHERE book_id=?").run(b.id);
          db.prepare("DELETE FROM categories WHERE book_id=?").run(b.id);
          db.prepare("DELETE FROM budgets WHERE book_id=?").run(b.id);
          db.prepare("DELETE FROM presets WHERE book_id=?").run(b.id);
          db.prepare("DELETE FROM book_members WHERE book_id=?").run(b.id);
          db.prepare("DELETE FROM books WHERE id=?").run(b.id);
          removedBooks++;
        }
      }
      db.prepare("DELETE FROM book_members WHERE user_id=?").run(id);
      // 保留的流水仍显示其昵称文本，避免共享账本里数据凭空消失
      db.prepare(
        "UPDATE flows SET attribution_uid=NULL WHERE attribution_uid=?"
      ).run(id);
      db.prepare("DELETE FROM users WHERE id=?").run(id);
    })();

    res.json({ ok: true, removedBooks, movedBooks });
  })
);

export default r;
