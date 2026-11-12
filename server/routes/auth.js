import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, createUserWithBook } from "../db.js";
import { sign, auth, wrap } from "../mw.js";

const r = Router();

// ---------- 登录限流（v2.4.0）----------
// 按 IP+用户名 记滑动窗口内的连续失败，超过阈值临时锁定，防暴力猜密码。
// 内存实现（单容器场景足够，重启即清零）；登录成功立即清零不影响本人。
const LOGIN_MAX_FAILS = 10; // 15 分钟内最多失败次数
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // key -> [failTimestamps]

function loginKey(req, username) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  return `${ip}|${String(username || "").toLowerCase()}`;
}

function loginThrottled(key) {
  const arr = loginFails.get(key) || [];
  const now = Date.now();
  const recent = arr.filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFails.set(key, recent);
  return recent.length >= LOGIN_MAX_FAILS;
}

function recordLoginFail(key) {
  const arr = loginFails.get(key) || [];
  arr.push(Date.now());
  loginFails.set(key, arr);
}

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
  wrap(async (req, res) => {
    const { username, password, remember } = req.body || {};
    const key = loginKey(req, username);
    if (loginThrottled(key))
      return res.status(429).json({
        error: "失败次数过多，请 15 分钟后再试",
      });
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
    // v2.4.0：bcrypt.compare 改异步 —— 同步版本会阻塞事件循环，
    // 比对期间所有请求（他人登录/记账）一起卡住。
    const ok =
      !!user && (await bcrypt.compare(password || "", user.password));
    if (!ok) {
      recordLoginFail(key);
      return res.status(400).json({ error: "用户名或密码错误" });
    }
    loginFails.delete(key);
    // remember=true → 签发不过期 token（安卓端固定传 true，登录一次长期有效）
    const longLived = remember === true || remember === "true" || remember === 1;
    res.json({
      token: sign(user, { remember: longLived }),
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role, color: user.color },
    });
  })
);

r.get("/me", auth, (req, res) => res.json({ user: req.user }));

// 修改昵称 / 密码
r.put(
  "/me",
  auth,
  wrap(async (req, res) => {
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
      const oldOk = await bcrypt.compare(oldPassword || "", full.password);
      if (!oldOk) return res.status(400).json({ error: "原密码错误" });
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
