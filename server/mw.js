import jwt from "jsonwebtoken";
import { db } from "./db.js";

export const JWT_SECRET =
  process.env.JWT_SECRET || "jizhang-nas-please-change-me";

// 签发 token。
// remember=true  → 不写入 exp，签发「不过期」token（个人 NAS 场景，安卓端默认使用）。
//                  这正是「同步显示连不上」的根因之一：30 天过期后所有请求 401，
//                  客户端又只弹一句笼统提示，用户完全不知道要重新登录。
// remember=false → 沿用原来的 30 天有效期的行为。
export function sign(user, { remember = false } = {}) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    color: user.color,
  };
  if (remember) return jwt.sign(payload, JWT_SECRET);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

// 登录校验中间件
export function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare("SELECT id, username, nickname, role, color FROM users WHERE id=?")
      .get(payload.id);
    if (!user) return res.status(401).json({ error: "用户不存在" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

// 仅管理员可访问
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "需要管理员权限" });
  next();
}

// 校验用户是否为该账本成员，返回成员角色；否则抛 403
export function requireBook(req, res, next) {
  const bookId = Number(
    req.params.bookId || req.query.bookId || req.body.bookId
  );
  if (!bookId) return res.status(400).json({ error: "缺少账本ID" });
  const member = db
    .prepare("SELECT role FROM book_members WHERE book_id=? AND user_id=?")
    .get(bookId, req.user.id);
  if (!member) return res.status(403).json({ error: "无权访问该账本" });
  req.bookId = bookId;
  req.bookRole = member.role;
  next();
}

// 统一错误包装
export function wrap(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "服务器错误" });
    }
  };
}
