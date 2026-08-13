import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地时区）

// 操作人显示名：优先取用户表当前昵称，改昵称后历史记录同步
const OP_EXPR = (t) =>
  `COALESCE((SELECT u.nickname FROM users u WHERE u.id = ${t}.user_id), ${t}.op_user)`;

function getGoal(bookId) {
  const g = db.prepare("SELECT target, note FROM savings_goal WHERE book_id=?").get(bookId);
  return { target: g?.target || 0, note: g?.note || "" };
}

function getItems(bookId) {
  return db
    .prepare("SELECT * FROM savings_items WHERE book_id=? ORDER BY sort, id")
    .all(bookId);
}

// 当前资产 / 负债 / 净资产（按细则的正负号累加）
function computeNet(bookId) {
  const items = getItems(bookId);
  let asset = 0,
    liability = 0;
  for (const it of items) {
    const v = Number(it.amount) || 0;
    if (Number(it.sign) < 0) liability += v;
    else asset += v;
  }
  return { asset, liability, net: asset - liability };
}

// 任何一次细则变动（新增/改金额/删除）都把「今天」这条历史刷新成最新净资产。
// 同一天多次更新只保留最后一次 → 天然满足「每月只显示最后更新日期的数据」。
function touchHistory(bookId, user) {
  const { asset, liability, net } = computeNet(bookId);
  db.prepare(
    `INSERT INTO savings_history (book_id, ymd, asset, liability, net, user_id, op_user, updated_at)
     VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))
     ON CONFLICT(book_id, ymd) DO UPDATE SET
       asset=excluded.asset, liability=excluded.liability, net=excluded.net,
       user_id=excluded.user_id, op_user=excluded.op_user, updated_at=excluded.updated_at`
  ).run(bookId, today(), asset, liability, net, user?.id || 0, user?.nickname || "");
  return { asset, liability, net };
}

// 历史：每月取「该月最后更新日期」那一条（每个月只显示一次数据）
function monthlyHistory(bookId) {
  return db
    .prepare(
      `SELECT h.ymd, substr(h.ymd,1,7) AS month, h.asset, h.liability, h.net,
              ${OP_EXPR("h")} AS op_user
       FROM savings_history h
       JOIN (
         SELECT substr(ymd,1,7) AS m, MAX(ymd) AS mx
         FROM savings_history WHERE book_id=? GROUP BY m
       ) t ON substr(h.ymd,1,7)=t.m AND h.ymd=t.mx
       WHERE h.book_id=?
       ORDER BY h.ymd`
    )
    .all(bookId, bookId);
}

// 总览：目标 + 细则 + 当前净资产 + 按月历史
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const goal = getGoal(req.bookId);
    const items = getItems(req.bookId);
    const cur = computeNet(req.bookId);
    const months = monthlyHistory(req.bookId);
    const percent = goal.target > 0 ? Math.round((cur.net / goal.target) * 100) : 0;
    res.json({
      goal,
      items,
      current: { ...cur, percent, remaining: goal.target - cur.net },
      months,
    });
  })
);

// 设置存款目标
r.put(
  "/goal",
  requireBook,
  wrap((req, res) => {
    const target = Number(req.body?.target);
    if (!(target >= 0)) return res.status(400).json({ error: "目标金额不合法" });
    const note = (req.body?.note || "").toString().trim();
    db.prepare(
      `INSERT INTO savings_goal (book_id, target, note, updated_at)
       VALUES (?,?,?, datetime('now','localtime'))
       ON CONFLICT(book_id) DO UPDATE SET target=excluded.target, note=excluded.note, updated_at=excluded.updated_at`
    ).run(req.bookId, target, note);
    res.json({ ok: true, target });
  })
);

// 新增资金细则（sign 默认 1=正）
r.post(
  "/items",
  requireBook,
  wrap((req, res) => {
    const name = (req.body?.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "请填写名称" });
    const amount = Number(req.body?.amount) || 0;
    if (amount < 0) return res.status(400).json({ error: "金额请填正数，正负用「计入方式」选择" });
    const sign = Number(req.body?.sign) < 0 ? -1 : 1;
    const dup = db
      .prepare("SELECT id FROM savings_items WHERE book_id=? AND lower(name)=lower(?)")
      .get(req.bookId, name);
    if (dup) return res.status(400).json({ error: `细则「${name}」已存在` });
    const max = db
      .prepare("SELECT COALESCE(MAX(sort),0) AS m FROM savings_items WHERE book_id=?")
      .get(req.bookId).m;
    const info = db
      .prepare(
        `INSERT INTO savings_items (book_id,name,sign,amount,note,sort) VALUES (?,?,?,?,?,?)`
      )
      .run(req.bookId, name, sign, amount, (req.body?.note || "").toString().trim(), max + 1);
    const snap = touchHistory(req.bookId, req.user);
    res.json({ id: Number(info.lastInsertRowid), ...snap });
  })
);

// 编辑资金细则（改名 / 改正负 / 改金额）
r.put(
  "/items/:id",
  requireBook,
  wrap((req, res) => {
    const cur = db
      .prepare("SELECT * FROM savings_items WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "细则不存在" });
    const name = (req.body?.name ?? cur.name).toString().trim();
    if (!name) return res.status(400).json({ error: "请填写名称" });
    if (name.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = db
        .prepare("SELECT id FROM savings_items WHERE book_id=? AND lower(name)=lower(?) AND id<>?")
        .get(req.bookId, name, cur.id);
      if (dup) return res.status(400).json({ error: `细则「${name}」已存在` });
    }
    const amount = req.body?.amount != null ? Number(req.body.amount) : cur.amount;
    if (!(amount >= 0)) return res.status(400).json({ error: "金额请填正数，正负用「计入方式」选择" });
    const sign = req.body?.sign != null ? (Number(req.body.sign) < 0 ? -1 : 1) : cur.sign;
    db.prepare(
      `UPDATE savings_items SET name=?, sign=?, amount=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(name, sign, amount, (req.body?.note ?? cur.note).toString().trim(), cur.id);
    const snap = touchHistory(req.bookId, req.user);
    res.json({ ok: true, ...snap });
  })
);

// 批量更新各细则金额（「更新资产和负债」一次填完保存）
r.post(
  "/items/bulk",
  requireBook,
  wrap((req, res) => {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ error: "没有需要更新的细则" });
    const stmt = db.prepare(
      `UPDATE savings_items SET amount=?, updated_at=datetime('now','localtime') WHERE id=? AND book_id=?`
    );
    const tx = db.transaction(() => {
      for (const it of list) {
        const amt = Number(it.amount);
        if (!(amt >= 0)) continue;
        stmt.run(amt, Number(it.id), req.bookId);
      }
    });
    tx();
    const snap = touchHistory(req.bookId, req.user);
    res.json({ ok: true, ...snap });
  })
);

// 删除资金细则
r.delete(
  "/items/:id",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM savings_items WHERE id=? AND book_id=?").run(
      req.params.id,
      req.bookId
    );
    const snap = touchHistory(req.bookId, req.user);
    res.json({ ok: true, ...snap });
  })
);

// 删除某个月的历史记录（按该月最后更新那条的日期删）
r.delete(
  "/history/:ymd",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM savings_history WHERE book_id=? AND ymd=?").run(
      req.bookId,
      req.params.ymd
    );
    res.json({ ok: true });
  })
);

export default r;
