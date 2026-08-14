import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

// 资金细则的「历史资金记录」：每次直接修改当前金额都记一笔（用于明细弹窗展示）
db.prepare(`
  CREATE TABLE IF NOT EXISTS savings_item_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    ymd TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL DEFAULT 0,
    op_user TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )
`).run();

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地时区）

// 生效日期归一：YYYY-MM-DD 或空（空=当前/未指定）。支持 8 位紧凑输入 20241217 → 2024-12-17
const normAsOf = (s) => {
  const d = String(s || "").trim();
  const digits = d.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return "";
};

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

// 某细则在指定日期 dateStr(YYYY-MM-DD) 是否有效：
// - as_of 非空且 > date → 尚未生效；as_of_end 非空且 date > as_of_end → 已失效
const activeOn = (it, dateStr) => {
  if (it.as_of && /^\d{4}-\d{2}-\d{2}$/.test(it.as_of) && it.as_of > dateStr) return false;
  if (it.as_of_end && /^\d{4}-\d{2}-\d{2}$/.test(it.as_of_end) && dateStr > it.as_of_end) return false;
  return true;
};

// 当前资产 / 负债 / 净资产（按细则的正负号累加；已失效/未生效的细则不计入）
function computeNet(bookId, asOfDate) {
  const dateStr = asOfDate || today();
  const items = getItems(bookId);
  let asset = 0,
    liability = 0;
  for (const it of items) {
    if (!activeOn(it, dateStr)) continue;
    const v = Number(it.amount) || 0;
    if (Number(it.sign) < 0) liability += v;
    else asset += v;
  }
  return { asset, liability, net: asset - liability };
}

// 任何一次细则变动（新增/改金额/删/回填历史）都重建每月历史快照：
// - 从「最早有生效日期的细则」所在月到本月，逐月计算月末净资产并 upsert 一条（ymd=月末，本月用今天）
// - 细则带 as_of 的，仅在其生效日(含)之后的月份计入；无 as_of 的视为一直持有，所有月份都计入
// - 同一月多条更新只保留最后一条 → 满足「每月只显示一次数据」
function rebuildHistory(bookId, user) {
  const items = getItems(bookId);
  const now = dayjs();
  const startYm = dataStartYm(bookId);
  // 始终清理早于「数据起点月」的自动快照（manual=0）：避免出现生效日/数据起点之前的无意义远古快照（如 2022-01）
  db.prepare(
    "DELETE FROM savings_history WHERE book_id=? AND substr(ymd,1,7) < ? AND manual=0"
  ).run(bookId, startYm);
  const monthList = [];
  let cur = dayjs(startYm + "-01");
  while (!cur.isAfter(now, "month")) {
    monthList.push(cur.format("YYYY-MM"));
    cur = cur.add(1, "month");
  }
  const upsert = db.prepare(
    `INSERT INTO savings_history (book_id, ymd, asset, liability, net, user_id, op_user, updated_at)
     VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))
     ON CONFLICT(book_id, ymd) DO UPDATE SET
       asset=excluded.asset, liability=excluded.liability, net=excluded.net,
       user_id=excluded.user_id, op_user=excluded.op_user, updated_at=excluded.updated_at`
  );
  const tx = db.transaction(() => {
    for (const ym of monthList) {
      // 该月若已有「人工回填的历史快照」则跳过，避免被自动重建覆盖
      const hasManual = db
        .prepare("SELECT 1 FROM savings_history WHERE book_id=? AND substr(ymd,1,7)=? AND manual=1 LIMIT 1")
        .get(bookId, ym);
      if (hasManual) continue;
      const monthEnd = dayjs(ym + "-01").endOf("month");
      const isCur = ym === now.format("YYYY-MM");
      const ymd = isCur ? now.format("YYYY-MM-DD") : monthEnd.format("YYYY-MM-DD");
      let asset = 0,
        liability = 0;
      for (const it of items) {
        const v = Number(it.amount) || 0;
        if (!activeOn(it, monthEnd.format("YYYY-MM-DD"))) continue; // 该月已失效/未生效
        if (Number(it.sign) < 0) liability += v;
        else asset += v;
      }
      upsert.run(bookId, ymd, asset, liability, asset - liability, user?.id || 0, user?.nickname || "");
    }
  });
  tx();
  const { asset, liability, net } = computeNet(bookId);
  return { asset, liability, net };
}

// 数据起点月：历史图/历史的展示与重建下界。
// 取「最早生效日期月」与「最早人工回填(manual=1)快照月」的较小者；若都为空则为本月。
function dataStartYm(bookId) {
  let ym = dayjs().format("YYYY-MM");
  const rows = db
    .prepare("SELECT as_of FROM savings_items WHERE book_id=? AND as_of<>''")
    .all(bookId);
  for (const r of rows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.as_of)) {
      const m = r.as_of.slice(0, 7);
      if (m < ym) ym = m;
    }
  }
  const man = db
    .prepare("SELECT MIN(substr(ymd,1,7)) AS m FROM savings_history WHERE book_id=? AND manual=1")
    .get(bookId);
  if (man && man.m && man.m < ym) ym = man.m;
  return ym;
}

// 历史：每月取「该月最后更新日期」那一条（每个月只显示一次数据）
// 过滤掉早于「最早生效日期」所在月的记录（图表与历史记录表共用，保证都不显示之前的数据）
function monthlyHistory(bookId) {
  const startYm = dataStartYm(bookId);
  let sql = `SELECT h.ymd, substr(h.ymd,1,7) AS month, h.asset, h.liability, h.net,
              ${OP_EXPR("h")} AS op_user
       FROM savings_history h
       JOIN (
         SELECT substr(ymd,1,7) AS m, MAX(ymd) AS mx
         FROM savings_history WHERE book_id=? GROUP BY m
       ) t ON substr(h.ymd,1,7)=t.m AND h.ymd=t.mx
       WHERE h.book_id=?`;
  const params = [bookId, bookId];
  if (startYm) {
    sql += " AND substr(h.ymd,1,7) >= ?";
    params.push(startYm);
  }
  sql += " ORDER BY h.ymd";
  return db.prepare(sql).all(...params);
}

// 总览：目标 + 细则 + 当前净资产 + 按月历史
r.get(
  "/",
  requireBook,
  wrap((req, res) => {
    const goal = getGoal(req.bookId);
    const allItems = getItems(req.bookId);
    const items = allItems.filter((it) => activeOn(it, today())); // 当前有效（计入净资产）
    const expiredItems = allItems.filter((it) => !activeOn(it, today())); // 已失效（不计入，仅作展示/可恢复）
    const cur = computeNet(req.bookId);
    const months = monthlyHistory(req.bookId);
    const percent = goal.target > 0 ? Math.round((cur.net / goal.target) * 100) : 0;
    res.json({
      goal,
      items,
      expiredItems,
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
        `INSERT INTO savings_items (book_id,name,sign,amount,note,sort,as_of,as_of_end) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(req.bookId, name, sign, amount, (req.body?.note || "").toString().trim(), max + 1, normAsOf(req.body?.as_of), normAsOf(req.body?.as_of_end));
    const snap = rebuildHistory(req.bookId, req.user);
    res.json({ id: Number(info.lastInsertRowid), ...snap });
  })
);

// 获取某月的逐条明细基线（用于「修改某月历史」弹窗预填）
// 返回该月最后更新日的 ymd，以及每条当时生效细则的金额（优先取该日逐条记录，缺失则回退当前金额）
r.get(
  "/items/history-month",
  requireBook,
  wrap((req, res) => {
    const ym = String(req.query.ym || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "月份格式不对" });
    const last = db
      .prepare("SELECT MAX(ymd) AS mx FROM savings_history WHERE book_id=? AND substr(ymd,1,7)=?")
      .get(req.bookId, ym);
    const ymd = last?.mx || dayjs(ym + "-01").endOf("month").format("YYYY-MM-DD");
    const histRows = db
      .prepare("SELECT item_id, amount FROM savings_item_history WHERE book_id=? AND ymd=?")
      .all(req.bookId, ymd);
    const histMap = {};
    for (const h of histRows) histMap[h.item_id] = h.amount;
    const items = getItems(req.bookId)
      .filter((it) => activeOn(it, ymd)) // 仅该月当时生效的细则
      .map((it) => ({
        id: it.id,
        name: it.name,
        sign: it.sign,
        amount: histMap[it.id] != null ? String(histMap[it.id]) : String(it.amount),
      }));
    res.json({ ymd, items });
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
    const asOf = req.body?.as_of !== undefined ? normAsOf(req.body.as_of) : cur.as_of;
    const asOfEnd = req.body?.as_of_end !== undefined ? normAsOf(req.body.as_of_end) : cur.as_of_end;
    db.prepare(
      `UPDATE savings_items SET name=?, sign=?, amount=?, note=?, as_of=?, as_of_end=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(name, sign, amount, (req.body?.note ?? cur.note).toString().trim(), asOf, asOfEnd, cur.id);
    const snap = rebuildHistory(req.bookId, req.user);
    res.json({ ok: true, ...snap });
  })
);

// 批量更新各细则金额（「更新资产和负债」一次填完保存）
// - 不传 ymd 或 ymd>=今天：视为「更新当前余额」→ 改写各细则 amount 并重建历史
// - 传历史日期 ymd<今天：视为「回填历史快照」→ 只写入该日净资产快照(manual=1)，不动当前余额
r.post(
  "/items/bulk",
  requireBook,
  wrap((req, res) => {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ error: "没有需要更新的细则" });
    const ymd = normAsOf(req.body?.ymd);
    const isPast = ymd && ymd < today();
    if (isPast) {
      // 历史回填：按下表 sign 汇总净资产，写一条 manual 快照
      const byId = {};
      for (const it of getItems(req.bookId)) byId[it.id] = it;
      let asset = 0,
        liability = 0;
      const itemUpdates = [];
      for (const it of list) {
        const amt = Number(it.amount);
        if (!(amt >= 0)) continue;
        const dbItem = byId[Number(it.id)];
        if (!dbItem) continue;
        if (!activeOn(dbItem, ymd)) continue; // 该日已失效/未生效
        if (Number(dbItem.sign) < 0) liability += amt;
        else asset += amt;
        itemUpdates.push({ id: dbItem.id, amt });
      }
      const ym = ymd.slice(0, 7);
      const histStmt = db.prepare(
        "INSERT INTO savings_item_history (item_id, book_id, ymd, amount, note, user_id, op_user) VALUES (?,?,?,?,?,?,?)"
      );
      const tx = db.transaction(() => {
        // 先清掉该月自动生成的快照（如有），避免与 manual 快照并存导致取最大值时取错
        db.prepare(
          "DELETE FROM savings_history WHERE book_id=? AND substr(ymd,1,7)=? AND manual=0"
        ).run(req.bookId, ym);
        db.prepare(
          `INSERT INTO savings_history (book_id, ymd, asset, liability, net, user_id, op_user, updated_at, manual)
           VALUES (?,?,?,?,?,?,?, datetime('now','localtime'), 1)
           ON CONFLICT(book_id, ymd) DO UPDATE SET
             asset=excluded.asset, liability=excluded.liability, net=excluded.net,
             user_id=excluded.user_id, op_user=excluded.op_user, updated_at=excluded.updated_at, manual=1`
        ).run(req.bookId, ymd, asset, liability, asset - liability, req.user?.id || 0, req.user?.nickname || "");
        // 先清掉该月已有的逐条历史，避免多次「改」同一月时记录堆积（每月只留一份逐条记录）
        db.prepare(
          "DELETE FROM savings_item_history WHERE book_id=? AND substr(ymd,1,7)=?"
        ).run(req.bookId, ym);
        // 每条生效细则各记一条历史（与「直接修改当前金额」一致，便于明细弹窗查看）
        for (const u of itemUpdates) {
          histStmt.run(u.id, req.bookId, ymd, u.amt, "批量更新·回填历史", req.user?.id || 0, req.user?.nickname || "");
        }
      });
      tx();
      res.json({ ok: true, asset, liability, net: asset - liability, manual: true });
      return;
    }
    // 当前余额更新：等同对每条生效细则执行「直接修改当前金额」，并各记一条历史
    const ymdNow = today();
    const stmt = db.prepare(
      `UPDATE savings_items SET amount=?, updated_at=datetime('now','localtime') WHERE id=? AND book_id=?`
    );
    const histStmt = db.prepare(
      "INSERT INTO savings_item_history (item_id, book_id, ymd, amount, note, user_id, op_user) VALUES (?,?,?,?,?,?,?)"
    );
    const tx = db.transaction(() => {
      for (const it of list) {
        const amt = Number(it.amount);
        if (!(amt >= 0)) continue;
        stmt.run(amt, Number(it.id), req.bookId);
        histStmt.run(Number(it.id), req.bookId, ymdNow, amt, "批量更新·更新资产与负债", req.user?.id || 0, req.user?.nickname || "");
      }
    });
    tx();
    const snap = rebuildHistory(req.bookId, req.user);
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
    const snap = rebuildHistory(req.bookId, req.user);
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

// 修改某个月的历史净资产快照（资产/负债，重算净资产，标记 manual=1 避免被重建覆盖）
r.put(
  "/history/:ymd",
  requireBook,
  wrap((req, res) => {
    const ymd = normAsOf(req.params.ymd);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return res.status(400).json({ error: "日期格式不对" });
    const asset = Number(req.body?.asset);
    const liability = Number(req.body?.liability);
    if (!(asset >= 0) || !(liability >= 0)) return res.status(400).json({ error: "金额需填正数" });
    const exists = db
      .prepare("SELECT 1 FROM savings_history WHERE book_id=? AND ymd=?")
      .get(req.bookId, ymd);
    if (!exists) return res.status(404).json({ error: "该月历史记录不存在" });
    db.prepare(
      `UPDATE savings_history SET asset=?, liability=?, net=?, manual=1, updated_at=datetime('now','localtime') WHERE book_id=? AND ymd=?`
    ).run(asset, liability, asset - liability, req.bookId, ymd);
    res.json({ ok: true });
  })
);

// 资金明细：查看某条细则的历史资金记录（每次直接改金额都记一笔）
r.get(
  "/items/:id/history",
  requireBook,
  wrap((req, res) => {
    const it = db
      .prepare("SELECT * FROM savings_items WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!it) return res.status(404).json({ error: "细则不存在" });
    const rows = db
      .prepare(
        `SELECT h.*, ${OP_EXPR("h")} AS op_user
         FROM savings_item_history h
         WHERE h.item_id=? AND h.book_id=? ORDER BY h.created_at DESC, h.id DESC`
      )
      .all(it.id, req.bookId);
    res.json({ item: it, rows });
  })
);

// 直接修改当前金额（不是存入流水，而是设值），并记一条历史
r.post(
  "/items/:id/set-amount",
  requireBook,
  wrap((req, res) => {
    const cur = db
      .prepare("SELECT * FROM savings_items WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!cur) return res.status(404).json({ error: "细则不存在" });
    const amount = Number(req.body?.amount);
    if (!(amount >= 0)) return res.status(400).json({ error: "金额请填正数" });
    const note = (req.body?.note || "").toString().trim();
    const ymd = today();
    db.transaction(() => {
      db.prepare("UPDATE savings_items SET amount=?, updated_at=datetime('now','localtime') WHERE id=?").run(
        amount,
        cur.id
      );
      db.prepare(
        "INSERT INTO savings_item_history (item_id, book_id, ymd, amount, note, user_id, op_user) VALUES (?,?,?,?,?,?,?)"
      ).run(cur.id, req.bookId, ymd, amount, note, req.user?.id || 0, req.user?.nickname || "");
    })();
    const item = db.prepare("SELECT * FROM savings_items WHERE id=?").get(cur.id);
    const snap = rebuildHistory(req.bookId, req.user);
    res.json({ ok: true, item, ...snap });
  })
);

// 删除一条历史资金记录
r.delete(
  "/items/:id/history/:hid",
  requireBook,
  wrap((req, res) => {
    db.prepare("DELETE FROM savings_item_history WHERE id=? AND item_id=? AND book_id=?").run(
      req.params.hid,
      req.params.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

export default r;
