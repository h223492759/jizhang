import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, createUserWithBook } from "../db.js";
import { sign, auth, wrap } from "../mw.js";

const r = Router();

// 是否允许自助注册。默认【关闭】：账号由管理员在「用户管理」里新增。
// 需要开放注册时在 .env 里设置 ALLOW_REGISTER=true
const allowRegister = () =>
  (process.env.ALLOW_REGISTER ?? "false").toLowerCase() === "true";

r.get("/config", (req, res) => {
  res.json({ allowRegister: allowRegister() });
});

// 注册：自动创建一个默认账本 + 默认分类
r.post(
  "/register",
  wrap((req, res) => {
    if (!allowRegister())
      return res
        .status(403)
        .json({ error: "本站未开放注册，请联系管理员创建账号" });
    const { username, password, nickname } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "用户名和密码必填" });
    const exists = db
      .prepare("SELECT id FROM users WHERE username=?")
      .get(username);
    if (exists) return res.status(400).json({ error: "用户名已存在" });

    const u = createUserWithBook({ username, password, nickname, role: "user" });
    res.json({
      token: sign(u),
      user: { id: u.id, username: u.username, nickname: u.nickname, role: "user", color: u.color },
    });
  })
);

r.post(
  "/login",
  wrap((req, res) => {
    const { username, password } = req.body || {};
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
    if (!user || !bcrypt.compareSync(password || "", user.password))
      return res.status(400).json({ error: "用户名或密码错误" });
    res.json({
      token: sign(user),
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role, color: user.color },
    });
  })
);

r.get("/me", auth, (req, res) => res.json({ user: req.user }));

// 修改昵称 / 密码
r.put(
  "/me",
  auth,
  wrap((req, res) => {
    const { nickname, oldPassword, newPassword } = req.body || {};

    if (nickname && nickname.trim() && nickname.trim() !== req.user.nickname) {
      const nick = nickname.trim();
      const oldNick = req.user.nickname;
      const uid = req.user.id;
      db.transaction(() => {
        db.prepare("UPDATE users SET nickname=? WHERE id=?").run(nick, uid);
        // ① 历史遗留：老数据只有昵称文本没有用户ID，先把「本人参与的账本里、
        //    归属文本等于旧昵称」的记录认领回来，之后改名就能永久自动同步
        db.prepare(
          `UPDATE flows SET attribution_uid = @uid
            WHERE attribution_uid IS NULL
              AND attribution = @oldNick
              AND book_id IN (SELECT book_id FROM book_members WHERE user_id = @uid)`
        ).run({ uid, oldNick });
        // ② 冗余文本一并刷新，保证导出的 JSON/CSV 也是新昵称
        db.prepare(
          "UPDATE flows SET attribution = ? WHERE attribution_uid = ?"
        ).run(nick, uid);
        // ③ 预算/账本名里若带旧昵称不动，避免误伤用户自定义命名
      })();
    }

    if (newPassword) {
      const full = db.prepare("SELECT password FROM users WHERE id=?").get(req.user.id);
      if (!bcrypt.compareSync(oldPassword || "", full.password))
        return res.status(400).json({ error: "原密码错误" });
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        bcrypt.hashSync(newPassword, 10),
        req.user.id
      );
    }

    const user = db
      .prepare("SELECT id, username, nickname, role, color FROM users WHERE id=?")
      .get(req.user.id);
    res.json({ user });
  })
);

export default r;
