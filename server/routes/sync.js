import { Router } from "express";
import { createHash } from "crypto";
import { db } from "../db.js";
import { auth, requireBook, wrap } from "../mw.js";

const r = Router();
r.use(auth);

/**
 * 同步指纹：轻量"有没有变化"探测。
 * 客户端每次同步先调它（5ms 级），指纹一致 → 全部小表/流水都跳过，
 * 实现"只同步有修改/新增的部分"（E2/E3/E4 的核心）。
 */
function calcFingerprint(bookId) {
  const q = (sql, args = []) => db.prepare(sql).get(bookId, ...args);
  const flows = q(
    "SELECT COUNT(*) c, COALESCE(MAX(updated_at),'') m FROM flows WHERE book_id=?"
  );
  const cats = q(
    "SELECT COUNT(*) c, COALESCE(MAX(id),0) m FROM categories WHERE book_id=?"
  );
  const pres = q(
    "SELECT COUNT(*) c, COALESCE(MAX(id),0) m FROM presets WHERE book_id=?"
  );
  const sug = q(
    "SELECT COUNT(*) c, COALESCE(MAX(updated_at),'') m FROM preset_suggest WHERE book_id=?"
  );
  const hid = q(
    "SELECT COUNT(*) c, COALESCE(MAX(created_at),'') m FROM hidden_names WHERE book_id=?"
  );
  const bud = q(
    "SELECT COUNT(*) c, COALESCE(MAX(id),0) m FROM budgets WHERE book_id=?"
  );
  const rec = q(
    "SELECT COUNT(*) c, COALESCE(MAX(id),0) m FROM recurring WHERE book_id=?"
  );
  // 整包 JSON 表（savings 是 goal/items/history 分散表，wallets 是结构化表）：
  // 内容哈希兜底（量小，md5 亚毫秒级）
  // ⚠️ 列名必须是真实存在的列（v2.4.0 修正）：此前 savings_goal 用了不存在的
  //    id/target（实际 PK 是 book_id）、savings_items 用了 target/order_no、
  //    wallets 用了 balance —— SELECT 直接报错，又被下面的 catch 吞成 ""，
  //    这三块内容变化时指纹恒定不变 → 客户端永远 unchanged，数据不同步。
  const hashRows = (tbl, cols) => {
    try {
      const rows = db
        .prepare(`SELECT ${cols} FROM ${tbl} WHERE book_id=?`)
        .all(bookId);
      return createHash("md5")
        .update(rows.map((x) => JSON.stringify(x)).join("|"))
        .digest("hex");
    } catch (e) {
      // 不再静默吞错：返回可区分的错误标记（≠ 任何正常哈希），
      // 客户端会认为"有变化"重新拉全量 —— 宁可多拉，不可漏拉。
      console.error(`[fingerprint] 读表失败 ${tbl}: ${e.message}`);
      return "ERR:" + tbl;
    }
  };
  const sav =
    hashRows("savings_goal", "book_id, target, note, updated_at") +
    hashRows("savings_items", "id, name, sign, amount, note, sort, updated_at") +
    hashRows("savings_history", "id, ymd, asset, liability, net, op_user");
  const wal = hashRows(
    "wallets",
    "id, name, icon, target, note, sort, link_from, link_category, link_links, deposit_rules, created_at, client_uuid"
  );

  return [
    `f:${flows.c}:${flows.m}`,
    `c:${cats.c}:${cats.m}`,
    `p:${pres.c}:${pres.m}`,
    `s:${sug.c}:${sug.m}`,
    `h:${hid.c}:${hid.m}`,
    `b:${bud.c}:${bud.m}`,
    `r:${rec.c}:${rec.m}`,
    `sv:${sav}`,
    `w:${wal}`,
  ].join("|");
}

r.get(
  "/fingerprint",
  requireBook,
  wrap((req, res) => {
    const fp = calcFingerprint(req.bookId);
    const last = String(req.query.fp || "");
    if (last && last === fp) {
      return res.json({ unchanged: true, fp });
    }
    res.json({ unchanged: false, fp });
  })
);

export default r;
