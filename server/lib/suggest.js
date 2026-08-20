import { db } from "../db.js";

/**
 * 常用名称建议（未收藏 ×N）物化。
 * 触发时机（避免每次打开页面实时聚合）：
 *   1. 流水 增/删/改/导入 成功后 → rebuildSuggest(bookId)
 *   2. 服务启动 + 每 24h → rebuildAllSuggest()
 *   3. 用户在页面点"立即刷新建议" → POST /presets/rescan → rebuildSuggest(req.bookId)
 * 页面 GET /presets 直接读 preset_suggest 表，占用极小（每账本每名称一行）。
 *
 * 重建策略（修复"取消收藏后名称消失"的 bug）：
 *   - **count = 0**（手动取消收藏产生的，没有任何流水）：永久保留，永不删除。
 *   - **count >= 1** 且名字已不在流水中：清理掉（属于"流水被删干净了"的脏数据）。
 *   - 来自流水的（count >= 1）：UPSERT 刷新分类/支付方式/均价/count。
 * 不再使用 DELETE-all-then-INSERT 的粗暴方式，否则 count=0 的手动项会被一并清掉。
 */

export function rebuildSuggest(bookId) {
  const rows = db
    .prepare(
      `SELECT f.description AS name, f.type AS type, COUNT(*) AS count,
              (SELECT f2.category FROM flows f2
                 WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
                 ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1) AS category,
              (SELECT f2.payment_method FROM flows f2
                 WHERE f2.book_id=f.book_id AND f2.type=f.type AND f2.description=f.description
                 ORDER BY f2.flow_time DESC, f2.id DESC LIMIT 1) AS payment_method,
              ROUND(AVG(f.amount), 2) AS avg_amount,
              MAX(f.flow_time) AS last_time
         FROM flows f
        WHERE f.book_id=@bookId AND TRIM(f.description) <> ''
        GROUP BY f.description, f.type
       HAVING COUNT(*) >= 1`
    )
    .all({ bookId });

  const ins = db.prepare(
    `INSERT OR REPLACE INTO preset_suggest
       (book_id, type, name, count, category, payment_method, avg_amount, last_time, updated_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now','localtime'))`
  );
  // 清理：count >= 1 但名字已完全离开流水的（"流水全删了"的脏数据）
  const cleanup = db.prepare(
    `DELETE FROM preset_suggest
      WHERE book_id=@bookId AND count >= 1
        AND NOT EXISTS (
          SELECT 1 FROM flows f
          WHERE f.book_id=preset_suggest.book_id
            AND f.type=preset_suggest.type
            AND f.description=preset_suggest.name
            AND TRIM(f.description) <> ''
        )`
  );

  const tx = db.transaction(() => {
    cleanup.run({ bookId });
    for (const r of rows) {
      ins.run(
        bookId,
        r.type,
        r.name,
        r.count,
        r.category || "",
        r.payment_method || "",
        r.avg_amount || 0,
        (r.last_time || "").slice(0, 19) // "YYYY-MM-DD HH:mm:ss"
      );
    }
  });
  tx();
  return rows.length;
}

// 重建所有账本的建议（每日自动扫描）
export function rebuildAllSuggest() {
  const books = db.prepare("SELECT id FROM books").all();
  let total = 0;
  for (const b of books) total += rebuildSuggest(b.id);
  console.log(`[suggest] 全量重建完成：${books.length} 个账本，${total} 条建议`);
  return total;
}