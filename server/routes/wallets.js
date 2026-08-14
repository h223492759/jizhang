import { Router } from "express";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 操作人显示名：优先取用户表当前昵称（改昵称后历史记录同步），取不到才回落历史文本
const OP_EXPR =
  "COALESCE((SELECT u.nickname FROM users u WHERE u.id = wallet_txns.user_id), wallet_txns.op_user)";

const normDate = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim())) return String(s).trim();
  return new Date().toLocaleDateString("sv-SE");
};

// 关联起始日：20260811 / 2026-08-11 都归一为 YYYY-MM-DD；无效或空返回 ''（表示不关联）
const normLinkDate = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim())) return String(s).trim();
  return "";
};

// 某分类自某日起对钱包的净影响：收入计 +，支出计 −
const linkedSum = (bookId, category, from) => {
  if (!category || !from) return 0;
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS s
       FROM flows WHERE book_id=? AND category=? AND substr(flow_time,1,10) >= ?`
    )
    .get(bookId, category, from);
  return Number(r.s) || 0;
};

// 钱包列表：含余额、累计存入 / 支出、笔数、最近一笔日期
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const wallets = db
      .prepare("SELECT * FROM wallets WHERE book_id=? ORDER BY sort, id")
      .all(req.bookId);
    const agg = db
      .prepare(
        `SELECT wallet_id,
                COALESCE(SUM(amount),0) AS balance,
                COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0) AS total_in,
                COALESCE(SUM(CASE WHEN amount<0 THEN -amount END),0) AS total_out,
                COUNT(*) AS count,
                MAX(ymd) AS last_ymd
         FROM wallet_txns WHERE book_id=? GROUP BY wallet_id`
      )
      .all(req.bookId);
    const map = Object.fromEntries(agg.map((x) => [x.wallet_id, x]));

    const list = wallets.map((w) => {
      const a = map[w.id] || { balance: 0, total_in: 0, total_out: 0, count: 0, last_ymd: "" };
      const linked = linkedSum(req.bookId, w.link_category, w.link_from);
      const eff = (a.balance || 0) + linked; // 手动余额 + 关联分类净影响
      return {
        ...w,
        manualBalance: a.balance || 0,
        linked: linked,
        balance: eff,
        total_in: a.total_in,
        total_out: a.total_out,
        count: a.count,
        last_ymd: a.last_ymd || "",
        percent: w.target > 0 ? Math.round((eff / w.target) * 100) : 0,
        linkedFrom: w.link_from || "",
        linkCategory: w.link_category || "",
      };
    });
    res.json({
      wallets: list,
      totalBalance: list.reduce((s, w) => s + w.balance, 0),
      totalTarget: list.reduce((s, w) => s + (w.target || 0), 0),
    });
  })
);

// 新增钱包
r.post(
  "/",
  requireBook,
  wrap((req, res) => {
    const name = (req.body?.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "请填写钱包名称" });
    const dup = db
      .prepare("SELECT id FROM wallets WHERE book_id=? AND lower(name)=lower(?)")
      .get(req.bookId, name);
    if (dup) return res.status(400).json({ error: `钱包「${name}」已存在` });
    const target = Number(req.body?.target) || 0;
    const linkFrom = normLinkDate(req.body?.link_from);
    const linkCategory = (req.body?.link_category || "").toString().trim();
    const max = db
      .prepare("SELECT COALESCE(MAX(sort),0) AS m FROM wallets WHERE book_id=?")
      .get(req.bookId).m;
    const info = db
      .prepare("INSERT INTO wallets (book_id,name,icon,target,note,sort,link_from,link_category) VALUES (?,?,?,?,?,?,?,?)")
      .run(
        req.bookId,
        name,
        (req.body?.icon || "👛").toString().trim() || "👛",
        target,
        (req.body?.note || "").toString().trim(),
        max + 1,
        linkFrom,
        linkCategory
      );
    res.json({ id: Number(info.lastInsertRowid) });
  })
);

// 编辑钱包
r.put(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const cur = db
      .prepare("SELECT * FROM wallets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "钱包不存在" });
    const name = (req.body?.name ?? cur.name).toString().trim();
    if (!name) return res.status(400).json({ error: "请填写钱包名称" });
    if (name.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = db
        .prepare("SELECT id FROM wallets WHERE book_id=? AND lower(name)=lower(?) AND id<>?")
        .get(req.bookId, name, cur.id);
      if (dup) return res.status(400).json({ error: `钱包「${name}」已存在` });
    }
    db.prepare("UPDATE wallets SET name=?, icon=?, target=?, note=?, link_from=?, link_category=? WHERE id=?").run(
      name,
      (req.body?.icon ?? cur.icon).toString().trim() || "👛",
      req.body?.target != null ? Number(req.body.target) || 0 : cur.target,
      (req.body?.note ?? cur.note).toString().trim(),
      req.body?.link_from != null ? normLinkDate(req.body.link_from) : cur.link_from,
      req.body?.link_category != null ? (req.body.link_category || "").toString().trim() : cur.link_category,
      cur.id
    );
    res.json({ ok: true });
  })
);

// 删除钱包（连带资金记录）
r.delete(
  "/:id",
  requireBook,
  wrap((req, res) => {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM wallet_txns WHERE wallet_id=? AND book_id=?").run(
        req.params.id,
        req.bookId
      );
      db.prepare("DELETE FROM wallets WHERE id=? AND book_id=?").run(req.params.id, req.bookId);
    });
    tx();
    res.json({ ok: true });
  })
);

// 某钱包的资金记录（日期 / 金额 / 操作人）
r.get(
  "/:id/txns",
  requireBook,
  wrap((req, res) => {
    const w = db
      .prepare("SELECT * FROM wallets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!w) return res.status(404).json({ error: "钱包不存在" });
    const rows = db
      .prepare(
        `SELECT id, amount, ymd, note, user_id, ${OP_EXPR} AS op_user, created_at
         FROM wallet_txns WHERE book_id=? AND wallet_id=?
         ORDER BY ymd DESC, id DESC`
      )
      .all(req.bookId, w.id);
    const balance = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    // 关联分类的流水（自 link_from 起）：收入计 +，支出计 −
    let linkedRows = [];
    let linkedSum = 0;
    if (w.link_from && w.link_category) {
      linkedRows = db
        .prepare(
          `SELECT id, type, amount, category, description, attribution, flow_time
           FROM flows WHERE book_id=? AND category=? AND substr(flow_time,1,10) >= ?
           ORDER BY flow_time DESC, id DESC`
        )
        .all(req.bookId, w.link_category, w.link_from);
      linkedSum = linkedRows.reduce((s, x) => s + (x.type === "income" ? Number(x.amount) : -Number(x.amount)), 0);
    }
    res.json({
      wallet: w,
      rows,
      balance,
      linkedRows,
      linkedSum,
      linkFrom: w.link_from || "",
      linkCategory: w.link_category || "",
    });
  })
);

// 新增资金记录（direction: in=存入 / out=支出，存库统一用金额正负）
r.post(
  "/:id/txns",
  requireBook,
  wrap((req, res) => {
    const w = db
      .prepare("SELECT * FROM wallets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!w) return res.status(404).json({ error: "钱包不存在" });
    const amt = Number(req.body?.amount);
    if (!(amt > 0)) return res.status(400).json({ error: "金额必须大于 0" });
    const signed = req.body?.direction === "out" ? -amt : amt;
    const info = db
      .prepare(
        `INSERT INTO wallet_txns (book_id,wallet_id,amount,ymd,note,user_id,op_user)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        req.bookId,
        w.id,
        signed,
        normDate(req.body?.ymd),
        (req.body?.note || "").toString().trim(),
        req.user.id,
        req.user.nickname || ""
      );
    res.json({ id: Number(info.lastInsertRowid) });
  })
);

// 修改单笔资金记录
r.put(
  "/txns/:txnId",
  requireBook,
  wrap((req, res) => {
    const txn = db
      .prepare("SELECT * FROM wallet_txns WHERE id=? AND book_id=?")
      .get(req.params.txnId, req.bookId);
    if (!txn) return res.status(404).json({ error: "记录不存在" });
    const amt = Number(req.body?.amount);
    if (!(amt > 0)) return res.status(400).json({ error: "金额必须大于 0" });
    const signed = req.body?.direction === "out" ? -amt : amt;
    db.prepare(
      `UPDATE wallet_txns SET amount=?, ymd=?, note=?, op_user=?
       WHERE id=? AND book_id=?`
    ).run(
      signed,
      normDate(req.body?.ymd),
      (req.body?.note || "").toString().trim(),
      req.user.nickname || "",
      req.params.txnId,
      req.bookId
    );
    res.json({ ok: true });
  })
);

// 删除资金记录
r.delete(
  "/txns/:txnId",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM wallet_txns WHERE id=? AND book_id=?").run(
      req.params.txnId,
      req.bookId
    );
    res.json({ ok: true });
  })
);

export default r;
