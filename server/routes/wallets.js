import { Router } from "express";
import dayjs from "dayjs";
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

// link_category 归一为数组：兼容旧版单值字符串（"餐饮"）与新版 JSON 数组（'["餐饮","交通"]'）或逗号分隔
const parseCategories = (v) => {
  const s = String(v || "").trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch (_) {}
  return s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
};

// 解析 link_links（多行 cat+from）：存 JSON 数组字符串 [{cat, from}, ...]
// 兼容旧版单 link_category + link_from（无 link_links 时回退构造 1 行）
const parseLinkLinks = (w) => {
  if (w.link_links) {
    try {
      const arr = JSON.parse(w.link_links);
      if (Array.isArray(arr)) {
        return arr
          .map((x) => ({
            cat: String(x?.cat || "").trim(),
            from: normLinkDate(x?.from || ""),
          }))
          .filter((x) => x.cat);
      }
    } catch (_) {}
  }
  if (w.link_category) {
    return [{ cat: String(w.link_category).trim(), from: normLinkDate(w.link_from) }];
  }
  return [];
};


// 解析 deposit_rules（JSON 数组字符串 [{cat, owner, amount, start_ym, end_ym}, ...]）
// 返回对象数组；解析失败或空返回 []
const parseDepositRules = (w) => {
  const raw = w.deposit_rules;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        cat: String(x?.cat || "").trim(),
        owner: String(x?.owner || "").trim(),
        amount: Number(x?.amount || 0),
        start_ym: String(x?.start_ym || "").trim(),
        end_ym: String(x?.end_ym || "").trim(),
      }))
      .filter((x) => x.cat);
  } catch (_) {
    return [];
  }
};

// 某（些）分类自某日起对钱包的净影响：收入计 +，支出计 −
// 支持多行：每行一个 (cat, from)，求和
const linkedSum = (bookId, linksOrCats, from) => {
  // 兼容旧调用（多分类单 from）
  if (!Array.isArray(linksOrCats) || (linksOrCats.length && typeof linksOrCats[0] === "string")) {
    const cats = linksOrCats;
    if (!cats.length || !from) return 0;
    const ph = cats.map(() => "?").join(",");
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS s
         FROM flows WHERE book_id=? AND category IN (${ph}) AND substr(flow_time,1,10) >= ?`
      )
      .get(bookId, ...cats, from);
    return Number(r.s) || 0;
  }
  // 新版：多行（每行 cat+from）
  let total = 0;
  for (const l of linksOrCats) {
    if (!l.cat || !l.from) continue;
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS s
         FROM flows WHERE book_id=? AND category=? AND substr(flow_time,1,10) >= ?`
      )
      .get(bookId, l.cat, l.from);
    total += Number(r.s) || 0;
  }
  return total;
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
      const links = parseLinkLinks(w);
      const linked = linkedSum(req.bookId, links);
      const eff = (a.balance || 0) + linked; // 手动余额 + 关联分类净影响
      return {
        ...w,
        manualBalance: a.balance || 0,
        linked: linked,
        balance: eff,
        deposit_rules: parseDepositRules(w),
        total_in: a.total_in,
        total_out: a.total_out,
        count: a.count,
        last_ymd: a.last_ymd || "",
        percent: w.target > 0 ? Math.round((eff / w.target) * 100) : 0,
        linkedFrom: w.link_from || "",
        linkCategories: parseCategories(w.link_category), // 旧字段（兼容）
        linkLinks: links,                                  // 新版：多行 (cat, from)
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
    // 离线同步幂等：客户端 uuid 已存在则直接返回原 id
    const uuid = (req.body?.client_uuid || "").toString().trim();
    if (uuid) {
      const ex = db
        .prepare("SELECT id FROM wallets WHERE book_id=? AND client_uuid=?")
        .get(req.bookId, uuid);
      if (ex) return res.json({ id: ex.id, dup: true });
    }
    const dup = db
      .prepare("SELECT id FROM wallets WHERE book_id=? AND lower(name)=lower(?)")
      .get(req.bookId, name);
    if (dup) return res.status(400).json({ error: `钱包「${name}」已存在` });
    const target = Number(req.body?.target) || 0;
    const linkFrom = normLinkDate(req.body?.link_from);
    // 多分类支持：统一存 JSON 数组字符串（旧版单值字符串也兼容）
    const linkCategory = JSON.stringify(parseCategories(req.body?.link_category));
    // 多行关联：每行 {cat, from}，存 link_links 字段（link_category+link_from 旧字段也写一份兼容）
    const linkLinksArr = Array.isArray(req.body?.link_links) ? req.body.link_links : [];
    const linkLinks = JSON.stringify(
      linkLinksArr
        .map((x) => ({ cat: String(x?.cat || "").trim(), from: normLinkDate(x?.from || "") }))
        .filter((x) => x.cat)
    );
    // 定期存入规则：JSON 数组 [{cat, owner?, amount, start_ym?, end_ym?}]
    const depositRules = JSON.stringify(
      (Array.isArray(req.body?.deposit_rules) ? req.body.deposit_rules : [])
        .map((x) => ({
          cat: String(x?.cat || "").trim(),
          owner: String(x?.owner || "").trim(),
          amount: Number(x?.amount || 0),
          start_ym: String(x?.start_ym || "").trim(),
          end_ym: String(x?.end_ym || "").trim(),
        }))
        .filter((x) => x.cat && x.amount > 0)
    );
    const max = db
      .prepare("SELECT COALESCE(MAX(sort),0) AS m FROM wallets WHERE book_id=?")
      .get(req.bookId).m;
    const info = db
      .prepare("INSERT INTO wallets (book_id,name,icon,target,note,sort,link_from,link_category,link_links,deposit_rules,client_uuid) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        req.bookId,
        name,
        (req.body?.icon || "👛").toString().trim() || "👛",
        target,
        (req.body?.note || "").toString().trim(),
        max + 1,
        linkFrom,
        linkCategory,
        linkLinks,
        depositRules,
        uuid || null
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
    const depositRules =
      req.body?.deposit_rules != null
        ? JSON.stringify(
            (Array.isArray(req.body.deposit_rules) ? req.body.deposit_rules : [])
              .map((x) => ({
                cat: String(x?.cat || "").trim(),
                owner: String(x?.owner || "").trim(),
                amount: Number(x?.amount || 0),
                start_ym: String(x?.start_ym || "").trim(),
                end_ym: String(x?.end_ym || "").trim(),
              }))
              .filter((x) => x.cat && x.amount > 0)
          )
        : cur.deposit_rules;
    db.prepare("UPDATE wallets SET name=?, icon=?, target=?, note=?, link_from=?, link_category=?, link_links=?, deposit_rules=? WHERE id=?").run(
      name,
      (req.body?.icon ?? cur.icon).toString().trim() || "👛",
      req.body?.target != null ? Number(req.body.target) || 0 : cur.target,
      (req.body?.note ?? cur.note).toString().trim(),
      req.body?.link_from != null ? normLinkDate(req.body.link_from) : cur.link_from,
      req.body?.link_category != null
        ? JSON.stringify(parseCategories(req.body.link_category))
        : cur.link_category,
      req.body?.link_links != null
        ? JSON.stringify(
            (Array.isArray(req.body.link_links) ? req.body.link_links : [])
              .map((x) => ({ cat: String(x?.cat || "").trim(), from: normLinkDate(x?.from || "") }))
              .filter((x) => x.cat)
          )
        : cur.link_links,
      depositRules,
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
    w.deposit_rules = parseDepositRules(w);
    // 定存细则兜底补触发 + 诊断：打开详情页时对匹配的 income 流水补触发一次（幂等防重，
    // 即使 POST /flows 触发异常漏分配，这里也会补上），并生成诊断信息供前端展示
    const depositDebug = [];
    if (w.deposit_rules.length) {
      try {
        for (const r of w.deposit_rules) {
          const sYm = String(r.start_ym || "").slice(0, 7) || dayjs().subtract(6, "month").format("YYYY-MM");
          const eYm = String(r.end_ym || "").slice(0, 7);
          const flows = db
            .prepare(
              `SELECT * FROM flows WHERE book_id=? AND category=? AND type='income'
               AND substr(flow_time,1,7)>=? ORDER BY flow_time ASC`
            )
            .all(req.bookId, r.cat, sYm);
          for (const f of flows) {
            const fYm = String(f.flow_time).slice(0, 7);
            const fOwner = String(f.attribution || "未标注").trim() || "未标注";
            const already = db
              .prepare("SELECT id FROM wallet_txns WHERE book_id=? AND note=?")
              .get(req.bookId, `工资分配·${f.category}·${fOwner}·${fYm}`);
            if (already) {
              depositDebug.push({ ym: fYm, category: f.category, attribution: fOwner, amount: f.amount, status: "ok", reason: "已分配" });
              continue;
            }
            // 诊断原因判断
            let reason = "";
            if (r.owner && String(r.owner).trim() !== fOwner) reason = `归属人不匹配（规则=${r.owner}，流水=${fOwner}）`;
            else if (sYm && fYm < sYm) reason = `早于开始月 ${sYm}`;
            else if (eYm && fYm > eYm) reason = `晚于结束月 ${eYm}`;
            else if (Number(f.amount) < Number(r.amount || 0)) reason = `金额不足（${f.amount} < ${r.amount}）`;
            else reason = "未匹配（未知）";
            depositDebug.push({ ym: fYm, category: f.category, attribution: fOwner, amount: f.amount, status: "miss", reason });
            tryDeposit(req.bookId, f);
          }
        }
      } catch (e) {
        depositDebug.push({ ym: "-", category: "-", attribution: "-", amount: 0, status: "err", reason: String(e.message || e) });
      }
    }
    // 清理残留月结（老版本落库的 wallet_txns 月结记录；月结现改为纯实时聚合，不再落库）
    db.prepare("DELETE FROM wallet_txns WHERE wallet_id=? AND book_id=? AND note LIKE '%月结%'").run(w.id, req.bookId);
    const rows = db
      .prepare(
        `SELECT id, amount, ymd, note, user_id, ${OP_EXPR} AS op_user, created_at
         FROM wallet_txns WHERE book_id=? AND wallet_id=?
           AND (note IS NULL OR note = '' OR note NOT LIKE '%月结%')
         ORDER BY ymd DESC, id DESC`
      )
      .all(req.bookId, w.id);
    const balance = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    // 关联分类的流水（自 link_from 起）：收入计 +，支出计 −（支持多行，每行不同 cat+from）
    let linkedRows = [];
    let linkedSum = 0;
    const linkLinks = parseLinkLinks(w);
    for (const l of linkLinks) {
      if (!l.cat || !l.from) continue;
      const rows = db
        .prepare(
          `SELECT id, type, amount, category, description, attribution, flow_time
           FROM flows WHERE book_id=? AND category=? AND substr(flow_time,1,10) >= ?
           ORDER BY flow_time DESC, id DESC`
        )
        .all(req.bookId, l.cat, l.from);
      linkedRows.push({ link: l, rows });
      linkedSum += rows.reduce((s, x) => s + (x.type === "income" ? Number(x.amount) : -Number(x.amount)), 0);
    }
    // 月结：全量实时聚合（不落库！）。
    // 关键：note 不含月份，若 upsert 落库按 note 唯一 → 每月互相覆盖只剩最后一条（历史月结缺失的根因）。
    // 改为一条 GROUP BY 查全部分类/全部月份（自 link_from 起），每次 GET 都最新、无状态、天然正确。
    const monthly = [];
    for (const l of linkLinks) {
      if (!l.cat || !l.from) continue;
      const mrows = db
        .prepare(
          `SELECT substr(flow_time,1,7) AS ym, type, category,
                  CASE WHEN attribution='' OR attribution IS NULL THEN '未标注' ELSE attribution END AS attribution,
                  SUM(amount) AS sum
           FROM flows
           WHERE book_id=? AND category=? AND type IN ('expense','income')
             AND substr(flow_time,1,10) >= ?
           GROUP BY ym, type, category, attribution`
        )
        .all(req.bookId, l.cat, l.from);
      for (const m of mrows) {
        const sum = Number(m.sum || 0);
        if (sum <= 0) continue;
        const lastDay = dayjs(m.ym + "-01").endOf("month").format("YYYY-MM-DD");
        monthly.push({
          ym: m.ym,
          ymd: lastDay,
          type: m.type,
          category: m.category,
          attribution: m.attribution,
          amount: m.type === "expense" ? -sum : sum,
        });
      }
    }
    // 排序：按 ymd DESC → 支出优先 → 分类 → 归属人
    monthly.sort((a, b) => (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : a.category.localeCompare(b.category, "zh") || a.attribution.localeCompare(b.attribution, "zh")));
    res.json({
      wallet: { ...w, deposit_rules: parseDepositRules(w) },
      rows,
      balance,
      linkedRows,
      linkedSum,
      monthly,
      depositDebug,
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

// 月底结转：把指定年月的关联分类支出按归属人聚合，写入 wallet_txns（支出，金额为负）
// 每个月每个归属人最多一条结转记录（去重：同 ymd+note 已存在则跳过）
r.post(
  "/:id/close-month",
  requireBook,
  wrap((req, res) => {
    const w = db
      .prepare("SELECT * FROM wallets WHERE id=? AND book_id=?")
      .get(req.params.id, req.bookId);
    if (!w) return res.status(404).json({ error: "钱包不存在" });
    const linkLinks = parseLinkLinks(w);
    if (!linkLinks.length) return res.status(400).json({ error: "该钱包未关联分类" });
    const ym = (req.body?.ym || "").trim() || dayjs().format("YYYY-MM");
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym 格式 YYYY-MM" });
    const lastDay = dayjs(ym + "-01").endOf("month").format("YYYY-MM-DD");
    const stmt = db.prepare(
      `INSERT INTO wallet_txns (book_id,wallet_id,amount,ymd,note,user_id,op_user)
       VALUES (?,?,?,?,?,?,?)`
    );
    const existedStmt = db.prepare(
      "SELECT id FROM wallet_txns WHERE wallet_id=? AND book_id=? AND ymd=? AND note=?"
    );
    const tx = db.transaction(() => {
      let inserted = 0;
      const sumByOwner = new Map();
      for (const l of linkLinks) {
        if (!l.cat || !l.from) continue;
        const start = l.from <= ym + "-01" ? ym + "-01" : l.from;
        if (start > lastDay) continue;
        const rows = db
          .prepare(
            `SELECT amount, attribution, attribution_uid
             FROM flows WHERE book_id=? AND category=? AND type='expense'
             AND substr(flow_time,1,10) >= ? AND substr(flow_time,1,10) <= ?`
          )
          .all(req.bookId, l.cat, start, lastDay);
        for (const r of rows) {
          const key = `${r.attribution || "未标注"}|${r.attribution_uid || 0}`;
          if (!sumByOwner.has(key)) {
            sumByOwner.set(key, {
              attribution: r.attribution || "未标注",
              attribution_uid: r.attribution_uid || 0,
              sum: 0,
            });
          }
          sumByOwner.get(key).sum += Number(r.amount);
        }
      }
      const results = [];
      for (const v of sumByOwner.values()) {
        if (v.sum <= 0) continue;
        const note = `${ym} 月结 · ${v.attribution}`;
        const ex = existedStmt.get(w.id, req.bookId, lastDay, note);
        if (ex) { results.push({ attribution: v.attribution, sum: -v.sum, dup: true }); continue; }
        stmt.run(req.bookId, w.id, -v.sum, lastDay, note, v.attribution_uid || 0, v.attribution);
        results.push({ attribution: v.attribution, sum: -v.sum });
        inserted++;
      }
      return { inserted, results };
    });
    const out = tx();
    res.json({ ok: true, ym, ymd: lastDay, ...out });
  })
);

export default r;

// 月结触发器：某条流水变动后，对 (ym, cat, attribution) 重新聚合，写入 wallet_txns
// 仅历史月（< 上月）落库；当前月/上月不落库，由 GET 实时聚合
// note 格式：`月结 · ${cat} · ${owner}`（去 YYYY-MM 前缀；按 wallet_id+ymd+note 唯一）
export function reconcileMonthClose(bookId, flow) {
  if (!flow || !flow.flow_time || !flow.category) return;
  if (flow.type && flow.type !== "expense" && flow.type !== "income") return;
  const ym = String(flow.flow_time).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  // 注意：定存细则所有月份都落库（当月/上月也要写入资金记录，让用户能看到、能改/删）
  // 之前 `ym >= lastMonth return` 是给「月结」用的（实时聚合展示），不适合定存细则
  // 找 link_category / link_links 包含此 cat 的钱包
  const wallets = db
    .prepare(
      `SELECT * FROM wallets WHERE book_id=? AND (
        link_category = ? OR
        link_category LIKE ? OR
        link_links LIKE ?
      )`
    )
    .all(bookId, flow.category, `%"${flow.category}"%`, `%"${flow.category}"%`);
  const lastDay = dayjs(ym + "-01").endOf("month").format("YYYY-MM-DD");
  const owner = flow.attribution || "未标注";
  const flowType = flow.type || "expense";
  const reconcileOne = (w) => {
    const links = parseLinkLinks(w);
    const link = links.find((l) => l.cat === flow.category && l.from <= String(flow.flow_time).slice(0, 10));
    if (!link) return;
    const note = `月结 · ${flow.category} · ${owner}`;
    const sumRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM flows
         WHERE book_id=? AND category=? AND type=?
         AND substr(flow_time,1,7)=?
         AND (CASE WHEN attribution='' OR attribution IS NULL THEN '未标注' ELSE attribution END) = ?`
      )
      .get(bookId, flow.category, flowType, ym, owner);
    const sum = Number(sumRow?.s || 0);
    // 支出存负数，收入存正数（保持 wallet_txns 净额符号）
    const signed = flowType === "expense" ? -Math.abs(sum) : Math.abs(sum);
    if (sum <= 0) {
      db.prepare("DELETE FROM wallet_txns WHERE wallet_id=? AND book_id=? AND note=?").run(w.id, bookId, note);
      return;
    }
    const ex = db.prepare("SELECT id FROM wallet_txns WHERE wallet_id=? AND book_id=? AND note=?").get(w.id, bookId, note);
    if (ex) {
      db.prepare("UPDATE wallet_txns SET amount=?, ymd=? WHERE id=?").run(signed, lastDay, ex.id);
    } else {
      db.prepare(
        `INSERT INTO wallet_txns (book_id,wallet_id,amount,ymd,note,user_id,op_user)
         VALUES (?,?,?,?,?,?,?)`
      ).run(bookId, w.id, signed, lastDay, note, flow.user_id || 0, owner);
    }
  };
  const tx = db.transaction(() => { for (const w of wallets) reconcileOne(w); });
  tx();
}

// 月结兜底重建：对每个 wallet 的每个 linkLinks，从 link_from 起逐月触发一次 reconcileMonthClose
// 幂等（内部 upsert），重复调用安全。
// 解决历史月结缺失的根本问题：触发器只在新增/修改/删除单条流水时被调用，
// 过去已存在的历史月数据可能从未被触发过（尤其是迁移初期或老数据），
// 所以每次 GET 时跑一次兜底重建。
export function rebuildMonthlyClose(bookId) {
  const wallets = db.prepare(
    "SELECT * FROM wallets WHERE book_id=? AND (link_category IS NOT NULL AND link_category != '' AND link_category != '[]')"
  ).all(bookId);
  if (!wallets.length) return { rebuilt: 0 };
  const lastMonth = dayjs().subtract(1, "month");
  let touched = 0;
  const rebuildOne = (w) => {
    const links = parseLinkLinks(w);
    for (const l of links) {
      if (!l.cat || !l.from) continue;
      const start = dayjs(l.from);
      if (!start.isValid()) continue;
      let cur = start.startOf("month");
      while (!cur.isAfter(lastMonth)) {
        const ym = cur.format("YYYY-MM");
        // 找该月该 cat 的任意一条流水（按 type 分别选一条：expense / income）
        for (const type of ["expense", "income"]) {
          const flow = db.prepare(
            "SELECT * FROM flows WHERE book_id=? AND category=? AND type=? AND substr(flow_time,1,7)=? LIMIT 1"
          ).get(bookId, l.cat, type, ym);
          if (flow) {
            reconcileMonthClose(bookId, flow);
            touched++;
          }
        }
        cur = cur.add(1, "month");
      }
    }
  };
  const tx = db.transaction(() => { for (const w of wallets) rebuildOne(w); });
  tx();
  return { rebuilt: touched };
}

// 兼容旧入口：迁移老格式（YYYY-MM 月结·X·Y）。当前已统一用 rebuildMonthlyClose 兜底，
// 老格式（如果还存在）会被 rebuildMonthlyClose 自然 upsert 覆盖；保留此函数备用。
export function migrateMonthCloseFormat(bookId) {
  const olds = db.prepare(
    "SELECT id FROM wallet_txns WHERE book_id=? AND note GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9] 月结*'"
  ).all(bookId);
  if (olds.length) {
    db.prepare(
      "DELETE FROM wallet_txns WHERE book_id=? AND note GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9] 月结*'"
    ).run(bookId);
  }
  return rebuildMonthlyClose(bookId);
}

// 定期存入（工资自动分配）：收入流水创建时触发。
// 规则：当月该来源分类的第一笔收入流水，若金额 ≥ 匹配规则总额 → 按规则给各钱包写入 +amount 资金记录
// 全落库（wallet_txns），读取即普通资金记录，无实时聚合 → 不会卡。
// 防重：note `工资分配·{cat}·{ym}` 全局唯一（同一分类同一月只分配一次）
export function tryDeposit(bookId, flow) {
  if (!flow || !flow.flow_time || !flow.category || flow.type !== "income") return;
  const ym = String(flow.flow_time).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  const wallets = db
    .prepare(
      "SELECT * FROM wallets WHERE book_id=? AND deposit_rules IS NOT NULL AND deposit_rules != '' AND deposit_rules != '[]'"
    )
    .all(bookId);
  const matched = [];
  for (const w of wallets) {
    let rules = [];
    try { rules = JSON.parse(w.deposit_rules || "[]"); } catch (_) { continue; }
    if (!Array.isArray(rules)) continue;
    for (const r of rules) {
      if (String(r?.cat || "").trim() !== flow.category) continue;
      if (r?.owner && String(r.owner).trim() !== (flow.attribution || "")) continue;
      // start_ym/end_ym 兼容 YYYY-MM 和 YYYY-MM-DD 输入：取前 7 位比较（ym 是 YYYY-MM）
      const sYm = String(r?.start_ym || "").trim().slice(0, 7);
      const eYm = String(r?.end_ym || "").trim().slice(0, 7);
      if (sYm && ym < sYm) continue;
      if (eYm && ym > eYm) continue;
      const amount = Number(r?.amount || 0);
      if (amount > 0) matched.push({ wallet: w, amount });
    }
  }
  if (!matched.length) return;
  const totalNeed = matched.reduce((s, m) => s + m.amount, 0);
  if (totalNeed <= 0) return;
  // 金额必须 ≥ 匹配规则总额
  if (Number(flow.amount) < totalNeed) return;
  // 当月该 (分类 + 归属人) 是否已分配过（多归属人各自独立一次）
  const owner = String(flow.attribution || "未标注").trim() || "未标注";
  const note = `工资分配·${flow.category}·${owner}·${ym}`;
  const done = db.prepare("SELECT id FROM wallet_txns WHERE book_id=? AND note=?").get(bookId, note);
  if (done) return;
  // 写入各钱包分配记录
  const stmt = db.prepare(
    "INSERT INTO wallet_txns (book_id,wallet_id,amount,ymd,note,user_id,op_user) VALUES (?,?,?,?,?,?,?)"
  );
  const tx = db.transaction(() => {
    for (const m of matched) {
      stmt.run(bookId, m.wallet.id, m.amount, String(flow.flow_time).slice(0, 10), note, flow.user_id || 0, flow.attribution || "");
    }
  });
  tx();
}
