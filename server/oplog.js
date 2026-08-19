import { Router } from "express";
import { db } from "./db.js";
import { auth, wrap } from "./mw.js";

// 从路径推断实体与 id：/flows/123 → { entity:'flows', id:123 }
const PATH_RE = /^\/([a-z_]+)\/?(\d+)?/;

// 写操作审计中间件：挂在所有 /api 路由之后，响应完成后异步记录。
// 零侵入——不需要在业务路由里手动埋点；审计失败不影响业务。
export function logOp(req, res, next) {
  const m = req.method;
  if (m !== "POST" && m !== "PUT" && m !== "DELETE") return next();
  res.on("finish", () => {
    try {
      const mm = PATH_RE.exec(req.path || "");
      const entity = mm ? mm[1] : "";
      const entityId = mm && mm[2] ? Number(mm[2]) : null;
      const b = req.body || {};
      const summary = [b.description, b.name, b.category, b.type, b.amount, b.target]
        .filter((x) => x !== undefined && x !== null && x !== "")
        .join(" ");
      db.prepare(
        `INSERT INTO op_logs (book_id,user_id,method,path,entity,entity_id,summary,status)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        req.bookId ?? null,
        req.user?.id ?? null,
        m,
        req.originalUrl || req.path,
        entity,
        entityId,
        String(summary).slice(0, 200),
        res.statusCode
      );
    } catch (_) {
      /* 审计失败不影响业务 */
    }
  });
  next();
}

const r = Router();
r.use(auth);

// 当前账本最近操作日志（网页端 / 安卓端排查、失败重试定位用）
r.get(
  "/",
  wrap((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = db
      .prepare(
        `SELECT id, method, path, entity, entity_id, summary, status, created_at
           FROM op_logs
          WHERE book_id = ?
          ORDER BY id DESC LIMIT ?`
      )
      .all(req.bookId, limit);
    res.json({ list: rows });
  })
);

export default r;
