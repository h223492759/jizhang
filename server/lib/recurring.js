import dayjs from "dayjs";
import { db } from "../db.js";

function pad(n) {
  return String(n).padStart(2, "0");
}

export function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 某周期内的排程日（ref = 该周期内任意一天），返回该日 00:00。
 * - 月模板：YYYY-MM-<day_of_month>（该月没有这一天则取月末，如 31 号 → 2 月 28/29）
 * - 年模板：YYYY-<month_of_year>-<day_of_month>
 */
export function schedInPeriod(freq, dayOfMonth, monthOfYear, ref) {
  const t = dayjs(ref);
  if (freq === "yearly") {
    return dayjs(`${t.format("YYYY")}-${pad(monthOfYear)}-${pad(dayOfMonth)}`);
  }
  const dm = Math.min(dayOfMonth, t.daysInMonth());
  return dayjs(`${t.format("YYYY-MM")}-${pad(dm)}`);
}

/** 周期键：月模板 YYYY-MM、年模板 YYYY（与 recurring.last_period 同口径） */
export function periodKey(freq, ref) {
  const t = dayjs(ref);
  return freq === "yearly" ? t.format("YYYY") : t.format("YYYY-MM");
}

/**
 * 下一次应记账的日期（**严格晚于**基准日）。
 * 当天就是排程日 → 返回下一期（当天的这笔由 generateDueRecurring 生成，
 * next_run 只用来展示「下次」，不能等于已经生成过的那天）。
 */
export function computeNextRun(freq, dayOfMonth, monthOfYear, base = new Date()) {
  const t = dayjs(base).startOf("day");
  const cur = schedInPeriod(freq, dayOfMonth, monthOfYear, t);
  if (cur.isAfter(t, "day")) return cur.format("YYYY-MM-DD");
  const nx = freq === "yearly" ? t.add(1, "year") : t.add(1, "month");
  return schedInPeriod(freq, dayOfMonth, monthOfYear, nx).format("YYYY-MM-DD");
}

// 把到期待生成的模板，生成为真实流水。返回生成笔数。
// 规则（v1.1.2 重写）：
// - **只有到了排程日那天（或之后）才生成**；没到就一笔都不记。
//   旧版用 next_run 判「到期」+ 把运行日的日号强改成排程日，导致每月 1 号
//   打开 App 就把全月（10 号房租 / 16 号意外险 / 26 号防癌险）全部提前记上（11-02 反馈）。
// - 每个模板每个周期只生成一笔（last_period 去重，防重启/重复调用重复生成）
// - 上一期漏生成（服务器停机 / 长期没打开）→ 补记最近一期，日期用上期排程日，
//   不会写成未来日期
export function generateDueRecurring(bookId, asOf = new Date()) {
  const today = dayjs(asOf).startOf("day");
  const owner = db
    .prepare(
      "SELECT u.id, u.nickname FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id=?"
    )
    .get(bookId);
  if (!owner) return 0;
  const rows = db.prepare("SELECT * FROM recurring WHERE book_id=?").all(bookId);
  if (!rows.length) return 0;

  const insert = db.prepare(
    `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`
  );
  const upd = db.prepare("UPDATE recurring SET next_run=?, last_period=? WHERE id=?");

  let count = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const freq = r.freq === "yearly" ? "yearly" : "monthly";
      if (r.last_period === periodKey(freq, today)) continue; // 本周期已生成过

      // 本周期排程日；还没到那天 → 不生成（关键修复）
      let sched = null;
      const curSched = schedInPeriod(freq, r.day_of_month, r.month_of_year, today);
      if (!curSched.isAfter(today, "day")) {
        sched = curSched;
      } else if (r.last_period) {
        // 本周期还没到，但上一期一直没生成（停机/长期没打开）→ 只补最近一期
        const prevRef =
          freq === "yearly" ? today.subtract(1, "year") : today.subtract(1, "month");
        if (r.last_period !== periodKey(freq, prevRef)) {
          const prevSched = schedInPeriod(
            freq,
            r.day_of_month,
            r.month_of_year,
            prevRef
          );
          if (!prevSched.isAfter(today, "day")) sched = prevSched;
        }
      }
      if (!sched) continue; // 还没到排程日，什么都不记

      const desc = (r.description || "").trim() || r.category;
      // 归属：用模板上记录的账号（默认就是创建人），保证共享账本里各记各的、且双方可见
      const attrUid = r.attribution_uid || owner.id;
      const attrText = (r.attribution || "").trim() || owner.nickname;
      insert.run(
        bookId,
        owner.id,
        attrText,
        attrUid,
        r.type,
        r.amount,
        r.category,
        r.payment_method,
        desc,
        sched.format("YYYY-MM-DD HH:mm:ss")
      );
      count++;

      // 推进：next_run = 严格晚于今天的排程日；last_period 记实际生成的那个周期
      const nextRun = computeNextRun(
        freq,
        r.day_of_month,
        r.month_of_year,
        today.toDate()
      );
      upd.run(nextRun, periodKey(freq, sched), r.id);
    }
  });
  tx();
  return count;
}

/**
 * 删除一笔流水后，若它其实是「提前生成的定期流水」（日期在未来），
 * 把对应模板该周期的 last_period 清掉 —— 否则到了排程日不会再补记
 * （10 月「房租没触发」的另一半原因就是 last_period 被锁死）。
 *
 * 历史数据没有 recurring_id 溯源列，这里用保守匹配：日期在未来 + 同账本 +
 * 同分类 + 同金额 + 日号一致（年模板还要月份一致），命中才回退。
 */
export function rollbackRecurringOnDelete(bookId, flow) {
  try {
    if (!flow || !flow.flow_time) return;
    const ft = dayjs(flow.flow_time);
    if (!ft.isValid() || !ft.isAfter(dayjs(), "day")) return; // 只处理未来日期的提前生成
    const tmpl = db
      .prepare(
        `SELECT * FROM recurring
          WHERE book_id=? AND type=? AND category=? AND ABS(amount-?)<0.005
            AND day_of_month=?
            AND (freq='monthly' OR (freq='yearly' AND month_of_year=?))
          ORDER BY id LIMIT 1`
      )
      .get(bookId, flow.type, flow.category || "其他", Number(flow.amount) || 0, ft.date(), ft.month() + 1);
    if (!tmpl) return;
    const pk = tmpl.freq === "yearly" ? ft.format("YYYY") : ft.format("YYYY-MM");
    if (tmpl.last_period !== pk) return; // 不是本期生成的，不动
    db.prepare("UPDATE recurring SET last_period='', next_run=? WHERE id=?").run(
      ft.format("YYYY-MM-DD"),
      tmpl.id
    );
  } catch (e) {
    console.error("[recurring-rollback]", e);
  }
}
