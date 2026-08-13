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

// 计算某模板下一次应记账的日期（>= 基准日的首个排程日）
export function computeNextRun(freq, dayOfMonth, monthOfYear, base = new Date()) {
  const t = dayjs(base);
  if (freq === "yearly") {
    const m = pad(monthOfYear);
    const d = pad(dayOfMonth);
    const thisYear = dayjs(`${t.year()}-${m}-${d}`);
    const next = thisYear.isAfter(t, "day")
      ? thisYear
      : dayjs(`${t.year() + 1}-${m}-${d}`);
    return next.format("YYYY-MM-DD");
  }
  // monthly
  const dm = Math.min(dayOfMonth, t.daysInMonth());
  const thisMonth = t.date(dm);
  if (thisMonth.isAfter(t, "day")) return thisMonth.format("YYYY-MM-DD");
  const nx = t.add(1, "month");
  const dm2 = Math.min(dayOfMonth, nx.daysInMonth());
  return nx.date(dm2).format("YYYY-MM-DD");
}

// 把到期待生成的模板，生成为真实流水。返回生成笔数。
// - 每个模板每个周期只生成一笔（避免服务器长期停机后补一大堆历史）
// - 用 last_period 去重，同一周期不会因重启/重复调用而重复生成
export function generateDueRecurring(bookId, asOf = new Date()) {
  const today = dayjs(asOf);
  const owner = db
    .prepare(
      "SELECT u.id, u.nickname FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id=?"
    )
    .get(bookId);
  if (!owner) return 0;
  const rows = db.prepare("SELECT * FROM recurring WHERE book_id=?").all(bookId);
  if (!rows.length) return 0;

  const insert = db.prepare(
    `INSERT INTO flows (book_id, user_id, attribution, attribution_uid, type, amount, category, payment_method, description, flow_time)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const upd = db.prepare("UPDATE recurring SET next_run=?, last_period=? WHERE id=?");

  let count = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const next = dayjs(r.next_run);
      if (next.isAfter(today, "day")) continue; // 还没到排程日
      const period = r.freq === "yearly" ? today.format("YYYY") : today.format("YYYY-MM");
      if (r.last_period === period) continue; // 本周期已生成，跳过（防重复）

      // 本周期内的排程日
      let sched;
      if (r.freq === "yearly") {
        sched = dayjs(`${today.format("YYYY")}-${pad(r.month_of_year)}-${pad(r.day_of_month)}`);
      } else {
        const dm = Math.min(r.day_of_month, today.daysInMonth());
        sched = today.date(dm);
      }
      const desc = (r.description || "").trim() || r.category;
      insert.run(
        bookId,
        owner.id,
        owner.nickname,
        owner.id,
        r.type,
        r.amount,
        r.category,
        r.payment_method,
        desc,
        sched.format("YYYY-MM-DD HH:mm:ss")
      );
      count++;

      // 推进到下一个排程日
      const nextRun = computeNextRun(r.freq, r.day_of_month, r.month_of_year, today.toDate());
      upd.run(nextRun, period, r.id);
    }
  });
  tx();
  return count;
}
