import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 归属人统一解析：优先用 attribution_uid 关联到用户表读取「当前昵称」，
// 关联不上（如导入的外部人名）才回落到历史文本，保证改昵称后全量同步。
const ATTR_SQL = "COALESCE(u.nickname, f.attribution)";
const FROM_SQL = "FROM flows f LEFT JOIN users u ON u.id = f.attribution_uid";

/**
 * 把前端传来的归属人解析成 { uid, text }
 * - 传 attribution_uid 且是本账本成员 → 直接用
 * - 传 attribution 昵称文本 → 尝试在本账本成员里匹配，匹配到就绑定 uid
 * - 都没传 → 归属到当前操作人（共享账本自动归属创建人）
 */
export function resolveAttribution(bookId, currentUser, body = {}) {
  const members = db
    .prepare(
      `SELECT us.id, us.nickname FROM book_members bm
         JOIN users us ON us.id = bm.user_id
        WHERE bm.book_id = ?`
    )
    .all(bookId);

  const uidRaw = Number(body.attribution_uid);
  if (uidRaw) {
    const hit = members.find((m) => m.id === uidRaw);
    if (hit) return { uid: hit.id, text: hit.nickname };
  }
  const text = (body.attribution || "").trim();
  if (text) {
    const hit = members.find((m) => m.nickname === text);
    return hit ? { uid: hit.id, text: hit.nickname } : { uid: null, text };
  }
  return { uid: currentUser.id, text: currentUser.nickname };
}

// 列表：支持日期范围、类型、分类、归属、关键字、分页
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const {
      start,
      end,
      type,
      category,
      attribution,
      keyword,
      page = 1,
      pageSize = 20,
    } = req.query;

    const where = ["f.book_id = @bookId"];
    const p = { bookId: req.bookId };
    if (start) { where.push("f.flow_time >= @start"); p.start = start + " 00:00:00"; }
    if (end) { where.push("f.flow_time <= @end"); p.end = end + " 23:59:59"; }
    if (type) { where.push("f.type = @type"); p.type = type; }
    if (category) { where.push("f.category = @category"); p.category = category; }
    if (attribution) { where.push(`${ATTR_SQL} = @attribution`); p.attribution = attribution; }
    if (keyword) { where.push("f.description LIKE @kw"); p.kw = `%${keyword}%`; }
    const w = "WHERE " + where.join(" AND ");

    const total = db.prepare(`SELECT COUNT(*) AS n ${FROM_SQL} ${w}`).get(p).n;
    const sum = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN f.type='expense' THEN f.amount END),0) AS expense,
           COALESCE(SUM(CASE WHEN f.type='income'  THEN f.amount END),0) AS income
         ${FROM_SQL} ${w}`
      )
      .get(p);

    const limit = Math.min(Number(pageSize) || 20, 200);
    const offset = ((Number(page) || 1) - 1) * limit;
    const list = db
      .prepare(
        `SELECT f.id, f.book_id, f.user_id, f.type, f.amount, f.category,
                f.payment_method, f.description, f.flow_time, f.created_at,
                f.attribution_uid, ${ATTR_SQL} AS attribution
         ${FROM_SQL} ${w}
         ORDER BY f.flow_time DESC, f.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...p, limit, offset });

    res.json({ total, expense: sum.expense, income: sum.income, list });
  })
);

// 本账本可选归属人列表（前端下拉用）
r.get(
  "/attributions",
  requireBook,
  wrap((req, res) => {
    const members = db
      .prepare(
        `SELECT us.id, us.nickname FROM book_members bm
           JOIN users us ON us.id = bm.user_id
          WHERE bm.book_id = ? ORDER BY us.id`
      )
      .all(req.bookId);
    // 历史/导入数据里没绑定用户的自由文本归属，也一并列出
    const extra = db
      .prepare(
        `SELECT DISTINCT attribution AS nickname FROM flows
          WHERE book_id = ? AND attribution_uid IS NULL AND attribution <> ''`
      )
      .all(req.bookId);
    res.json({ members, others: extra.map((e) => e.nickname) });
  })
);

// 新建：默认归属到当前用户（共享账本自动归属创建人）
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const type = b.type === "income" ? "income" : "expense";
    const amount = Number(b.amount);
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "金额必须大于0" });
    const flow_time = b.flow_time
      ? dayjs(b.flow_time).format("YYYY-MM-DD HH:mm:ss")
      : dayjs().format("YYYY-MM-DD HH:mm:ss");
    const attr = resolveAttribution(req.bookId, req.user, b);
    const info = db
      .prepare(
        `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time)
         VALUES (@book_id,@user_id,@attribution,@attribution_uid,@type,@amount,@category,@payment_method,@description,@flow_time)`
      )
      .run({
        book_id: req.bookId,
        user_id: req.user.id,
        attribution: attr.text,
        attribution_uid: attr.uid,
        type,
        amount,
        category: (b.category || "其他").trim(),
        payment_method: (b.payment_method || "").trim(),
        description: (b.description || "").trim(),
        flow_time,
      });
    res.json({ id: info.lastInsertRowid });
  })
);

// 批量新建（用于导入）：默认全部归属到导入者
export function insertMany(bookId, userId, defaultAttr, items, defaultUid = null) {
  const stmt = db.prepare(
    `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const it of rows) {
      if (!it.amount || it.amount <= 0) continue;
      const hasCustomAttr = !!it.attribution && it.attribution !== defaultAttr;
      stmt.run(
        bookId,
        userId,
        it.attribution || defaultAttr,
        hasCustomAttr ? null : defaultUid,
        it.type === "income" ? "income" : "expense",
        it.amount,
        it.category || "其他",
        it.payment_method || "",
        it.description || "",
        it.flow_time || dayjs().format("YYYY-MM-DD HH:mm:ss")
      );
      n++;
    }
    return n;
  });
  return tx(items);
}

r.put(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const b = req.body || {};
    const cur = db
      .prepare("SELECT * FROM flows WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "流水不存在" });

    // 只有显式传了归属字段才重新解析，否则保持原样
    let attrText = cur.attribution;
    let attrUid = cur.attribution_uid;
    if (b.attribution !== undefined || b.attribution_uid !== undefined) {
      const attr = resolveAttribution(req.bookId, req.user, b);
      attrText = attr.text;
      attrUid = attr.uid;
    }

    db.prepare(
      `UPDATE flows SET type=?, amount=?, category=?, payment_method=?, description=?, flow_time=?, attribution=?, attribution_uid=? WHERE id=?`
    ).run(
      b.type === "income" ? "income" : "expense",
      Number(b.amount) || cur.amount,
      (b.category || cur.category).trim(),
      (b.payment_method ?? cur.payment_method).trim(),
      (b.description ?? cur.description).trim(),
      b.flow_time ? dayjs(b.flow_time).format("YYYY-MM-DD HH:mm:ss") : cur.flow_time,
      attrText,
      attrUid,
      cur.id
    );
    res.json({ ok: true });
  })
);

r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM flows WHERE id=? AND book_id=?").run(
      req.params.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

export default r;
