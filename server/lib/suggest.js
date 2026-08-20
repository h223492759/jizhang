import { db } from "../db.js";

/**
 * 常用名称建议（未收藏 ×N）物化。
 * 触发时机（避免每次打开页面实时聚合）：
 *   1. 流水 增/删/改/导入 成功后 → rebuildSuggest(bookId)
 *   2. 服务启动 + 每 24h → rebuildAllSuggest()
 * 页面 GET /presets 直接读 preset_suggest 表，占用极小（每账本每名称一行）。
 */

// 重建单个账本的建议：从 flows 聚合（出现 ≥2 次）后整体覆盖 preset_suggest
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
              ROUND(AVG(f.amount), 2) AS avg_amount
         FROM flows f
        WHERE f.book_id=@bookId AND TRIM(f.description) <> ''
        GROUP BY f.description, f.type
       HAVING COUNT(*) >= 2`
    )
    .all({ bookId });

  const del = db.prepare("DELETE FROM preset_suggest WHERE book_id=?");
  const ins = db.prepare(
    `INSERT OR REPLACE INTO preset_suggest
       (book_id, type, name, count, category, payment_method, avg_amount, updated_at)
     VALUES (?,?,?,?,?,?,?, datetime('now','localtime'))`
  );
  const tx = db.transaction(() => {
    del.run(bookId);
    for (const r of rows) {
      ins.run(
        bookId,
        r.type,
        r.name,
        r.count,
        r.category || "",
        r.payment_method || "",
        r.avg_amount || 0
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
