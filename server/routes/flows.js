import { Router } from "express";
import dayjs from "dayjs";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";
import { tryDeposit } from "./wallets.js";

const r = Router();
r.use(auth);

// 归属人统一解析：优先用 attribution_uid 关联到用户表读取「当前昵称」，
// 关联不上（如导入的外部人名）才回落到历史文本，保证改昵称后全量同步。
const ATTR_SQL = "COALESCE(u.nickname, f.attribution)";
const FROM_SQL = "FROM flows f LEFT JOIN users u ON u.id = f.attribution_uid";

// 记账时间处理：
// - 前端只让用户选「日期」，时分秒由系统按保存/修改时刻自动补上
// - 若上游已带完整时分秒（如导入 / AI 记账），则原样保留不动
// - fallbackDate 用于编辑时上游没传日期的情况，沿用原记录的日期
function stampSaveTime(input, fallbackDate) {
  const s = input ? String(input).trim() : "";
  if (s.length > 10 && s.includes(":")) {
    return dayjs(s).format("YYYY-MM-DD HH:mm:ss");
  }
  const d = (s || fallbackDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d} ${dayjs().format("HH:mm:ss")}`;
  }
  return dayjs().format("YYYY-MM-DD HH:mm:ss");
}

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
      payment,
      attribution,
      keyword,
      page = 1,
      pageSize = 20,
      sortBy = "flow_time", // flow_time | amount
      order = "desc", // asc | desc
    } = req.query;

    const where = ["f.book_id = @bookId"];
    const p = { bookId: req.bookId };
    if (start) { where.push("f.flow_time >= @start"); p.start = start + " 00:00:00"; }
    if (end) { where.push("f.flow_time <= @end"); p.end = end + " 23:59:59"; }
    if (type) { where.push("f.type = @type"); p.type = type; }
    if (category) {
      // 支持多分类：① JSON 数组字符串（如 '["餐饮","交通"]'，预算多分类预算原值）②逗号分隔
      let cats = [];
      if (category.trim().startsWith("[")) {
        try {
          const arr = JSON.parse(category);
          if (Array.isArray(arr)) cats = arr.map((s) => String(s).trim()).filter(Boolean);
        } catch (_) {}
      }
      if (!cats.length) cats = category.split(",").map((s) => s.trim()).filter(Boolean);
      if (cats.length > 1) {
        const names = cats.map((_, i) => `@cat${i}`).join(",");
        where.push(`f.category IN (${names})`);
        cats.forEach((c, i) => { p[`cat${i}`] = c; });
      } else if (cats.length === 1) {
        where.push("f.category = @category");
        p.category = cats[0];
      }
    }
    if (payment) { where.push("(f.payment_method = @payment OR (@payment='未标注' AND f.payment_method=''))"); p.payment = payment; }
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
    // 排序：金额 / 日期，升序或降序
    const sortCol = sortBy === "amount" ? "f.amount" : "f.flow_time";
    const sortDir = order === "asc" ? "ASC" : "DESC";
    const list = db
      .prepare(
        `SELECT f.id, f.book_id, f.user_id, f.type, f.amount, f.category,
                f.payment_method, f.description, f.flow_time, f.created_at,
                f.source, f.attribution_uid, ${ATTR_SQL} AS attribution, u.color AS attribution_color
         ${FROM_SQL} ${w}
         ORDER BY ${sortCol} ${sortDir}, f.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...p, limit, offset });

    res.json({ total, expense: sum.expense, income: sum.income, list });
  })
);

// 增量同步（安卓离线优先用）：
// - 传 since 时只返回 updated_at > since 的变更行（含新增+修改，客户端 upsert）
// - 始终返回当前账本全部存活 id 列表，客户端据此对账删除
// - 不传 since = 全量拉取
r.get(
  "/sync",
  requireBook,
  wrap((req, res) => {
    const bookId = req.bookId;
    const since = String(req.query.since || "").trim();
    const allIds = db
      .prepare("SELECT id FROM flows WHERE book_id=?")
      .all(bookId)
      .map((x) => x.id);
    const select =
      `SELECT f.id, f.user_id, f.type, f.amount, f.category, f.payment_method,
              f.description, f.flow_time, f.source, f.created_at, f.updated_at,
              f.attribution_uid, ${ATTR_SQL} AS attribution, u.color AS attribution_color
       ${FROM_SQL} WHERE f.book_id = @bookId`;
    let changed;
    if (since) {
      changed = db
        .prepare(select + ` AND f.updated_at > @since ORDER BY f.updated_at`)
        .all({ bookId, since });
    } else {
      changed = db
        .prepare(select + ` ORDER BY f.id`)
        .all({ bookId });
    }
    res.json({
      all_ids: allIds,
      changed,
      server_time: db.prepare("SELECT datetime('now','localtime') AS t").get().t,
    });
  })
);

// 本账本可选归属人列表（前端下拉用）
// 流水查询（发现页 AI 问账用）：按分类+时段统计合计
//   GET /flows/query?category=奶茶&period=this_month
//   返回 { category, period: 'YYYY-MM', count, total }
r.get(
  "/query",
  requireBook,
  wrap((req, res) => {
    const category = String(req.query.category || "").trim();
    if (!category) return res.status(400).json({ error: "category 必填" });
    const period = String(req.query.period || "this_month");
    const now = new Date();
    let start, end, periodLabel;
    if (period === "last_month") {
      const y = now.getFullYear();
      const m = now.getMonth(); // 0-indexed, 上月
      const yy = m === 0 ? y - 1 : y;
      const mm = m === 0 ? 12 : m;
      start = `${yy}-${String(mm).padStart(2, "0")}-01`;
      end = new Date(y, now.getMonth(), 0, 23, 59, 59).toISOString().slice(0, 19);
      periodLabel = `${yy}-${String(mm).padStart(2, "0")}`;
    } else {
      // 默认本月
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      start = `${y}-${String(m).padStart(2, "0")}-01`;
      end = new Date(y, m, 0, 23, 59, 59).toISOString().slice(0, 19);
      periodLabel = `${y}-${String(m).padStart(2, "0")}`;
    }
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
           FROM flows
          WHERE book_id=? AND category=? AND type='expense'
            AND flow_time >= ? AND flow_time <= ?`
      )
      .get(req.bookId, category, start, end);
    res.json({
      category,
      period: periodLabel,
      count: Number(rows.count) || 0,
      total: Number(rows.total) || 0,
    });
  })
);

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

// 查重：把「同一天 + 同类型 + 同金额 + 同名称 + 同分类 + 同支付方式」视为同一笔，
// 返回出现次数 > 1 的重复分组，每组带可删除的明细
r.get(
  "/duplicates",
  requireBook,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT f.id, f.type, f.amount, f.category, f.description, f.payment_method,
                f.flow_time,
                ${ATTR_SQL} AS attribution, u.color AS attribution_color
         ${FROM_SQL}
         WHERE f.book_id = @bookId`
      )
      .all({ bookId: req.bookId });
    const groups = new Map();
    for (const r of rows) {
      const date = (r.flow_time || "").slice(0, 10);
      const key = `${date}|${r.type}|${Math.round(Number(r.amount) * 100)}|${String(r.description || "").trim()}|${String(r.category || "其他").trim()}|${String(r.payment_method || "").trim()}`;
      if (!groups.has(key)) groups.set(key, { key, type: r.type, count: 0, items: [] });
      const g = groups.get(key);
      g.count++;
      g.items.push({
        id: r.id,
        flow_time: r.flow_time,
        amount: r.amount,
        category: r.category,
        description: r.description,
        payment_method: r.payment_method,
        attribution: r.attribution,
        attribution_color: r.attribution_color,
      });
    }
    const dupGroups = [...groups.values()]
      .filter((g) => g.count > 1)
      .map((g) => ({
        ...g,
        // 按时间正序，第一项作为「保留项」参考
        keepId: g.items[0]?.id,
      }))
      .sort((a, b) => b.count - a.count);
    const totalDup = dupGroups.reduce((s, g) => s + (g.count - 1), 0);
    res.json({ groups: dupGroups, totalDup, groupCount: dupGroups.length });
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
    const flow_time = stampSaveTime(b.flow_time);
    const attr = resolveAttribution(req.bookId, req.user, b);
    const category = (b.category || "其他").trim();
    // 没写名称时，自动用分类名（如「餐饮」），方便检索与统计
    const description = (b.description || "").toString().trim() || category;
    // 来源标记：'' 手动 | 'ai' AI识别 | 'auto' 通知自动记账
    const source = ["ai", "auto"].includes(b.source) ? b.source : "";
    // 客户端幂等键：离线补传重试时按 (book_id, client_uuid) 去重，绝不产生重复流水
    const uuid = (b.uuid || "").toString().trim();
    if (uuid) {
      const dup = db
        .prepare("SELECT id FROM flows WHERE book_id=? AND client_uuid=?")
        .get(req.bookId, uuid);
      if (dup) return res.json({ id: dup.id, dup: true });
    }
    const info = db
      .prepare(
        `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time, source, client_uuid, updated_at)
         VALUES (@book_id,@user_id,@attribution,@attribution_uid,@type,@amount,@category,@payment_method,@description,@flow_time,@source,@client_uuid,datetime('now','localtime'))`
      )
      .run({
        book_id: req.bookId,
        user_id: req.user.id,
        attribution: attr.text,
        attribution_uid: attr.uid,
        type,
        amount,
        category,
        payment_method: (b.payment_method || "").trim(),
        description,
        flow_time,
        source,
        client_uuid: uuid || null,
      });
    // 定期存入触发（收入流水 → 按钱包规则自动分配）
    try { tryDeposit(req.bookId, { flow_time, category, attribution: attr.text, type, amount, user_id: req.user.id }); }
    catch (e) { console.error("[tryDeposit]", e); }
    res.json({ id: info.lastInsertRowid });
  })
);

// 查重指纹：日期 + 类型 + 金额(分) + 名称 + 分类 + 支付方式
// 同一天、同类型、同金额、同名称、同分类、同支付方式 → 视为同一笔（重复）
export function flowDedupKey(it) {
  const type = it.type === "income" ? "income" : "expense";
  const date = (it.flow_time || "").slice(0, 10);
  const desc = String(it.description || "").trim();
  const cat = String(it.category || "其他").trim();
  const pay = String(it.payment_method || "").trim();
  const cents = Math.round(Number(it.amount || 0) * 100);
  return `${date}|${type}|${cents}|${desc}|${cat}|${pay}`;
}

// 加载本账本已有记录的指纹集合，供导入时查重
export function loadBookDedupKeys(bookId) {
  const rows = db
    .prepare(
      `SELECT substr(flow_time,1,10) d, type, ROUND(amount,2) amt,
              description, category, payment_method
         FROM flows WHERE book_id=?`
    )
    .all(bookId);
  const seen = new Set();
  for (const r of rows) {
    seen.add(
      `${r.d}|${r.type}|${Math.round(Number(r.amt) * 100)}|${r.description}|${r.category}|${r.payment_method}`
    );
  }
  return seen;
}

// 批量新建（用于导入）：默认全部归属到导入者
// opts.dedup=true 时，与「本账本已有账单 + 本批次已插入」重复的记录会被跳过，
// 返回 { imported, skipped }，避免重复导入同一份 CSV 导致账单翻倍。
export function insertMany(bookId, userId, defaultAttr, items, defaultUid = null, opts = {}) {
  const dedup = !!opts.dedup;
  const seen = dedup ? loadBookDedupKeys(bookId) : null;
  const stmt = db.prepare(
    `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`
  );
  const tx = db.transaction((rows) => {
    let imported = 0;
    let skipped = 0;
    for (const it of rows) {
      const amount = Number(it.amount);
      if (!amount || amount <= 0) { skipped++; continue; }
      const type = it.type === "income" ? "income" : "expense";
      const flow_time = it.flow_time || dayjs().format("YYYY-MM-DD HH:mm:ss");
      const hasCustomAttr = !!it.attribution && it.attribution !== defaultAttr;
      const desc = String(it.description || "").trim();
      const cat = String(it.category || "其他").trim();
      const pay = String(it.payment_method || "").trim();

      if (dedup) {
        const key = `${flow_time.slice(0, 10)}|${type}|${Math.round(amount * 100)}|${desc}|${cat}|${pay}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
      }

      stmt.run(
        bookId,
        userId,
        it.attribution || defaultAttr,
        hasCustomAttr ? null : defaultUid,
        type,
        amount,
        cat,
        pay,
        desc,
        flow_time
      );
      imported++;
    }
    return { imported, skipped };
  });
  const result = tx(items);
  return result;
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

    const effectiveCat = (b.category || cur.category).trim();
    // 编辑时若清空名称，自动回退为分类名；没传名称字段则保持原值
    const description =
      b.description !== undefined
        ? ((b.description || "").toString().trim() || effectiveCat)
        : cur.description;

    db.prepare(
      `UPDATE flows SET type=?, amount=?, category=?, payment_method=?, description=?, flow_time=?, attribution=?, attribution_uid=?, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(
      b.type === "income" ? "income" : "expense",
      Number(b.amount) || cur.amount,
      effectiveCat,
      (b.payment_method ?? cur.payment_method).trim(),
      description,
      stampSaveTime(b.flow_time, cur.flow_time),
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
    // 先读原值供触发器用，再删除
    const cur = db.prepare("SELECT * FROM flows WHERE id=? AND book_id=?").get(req.params.id, req.bookId);
    db.prepare("DELETE FROM flows WHERE id=? AND book_id=?").run(
      req.params.id,
      req.bookId
    );
    res.json({ ok: true });
  })
);

export default r;
