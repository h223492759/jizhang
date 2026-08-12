import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), "cb-import-choice-" + Date.now());
fs.mkdirSync(tmp, { recursive: true });
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "9733";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";

const base = "http://127.0.0.1:9733";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (token) => ({ "content-type": "application/json", authorization: "Bearer " + token });

await import("../server/index.js");
await sleep(900);

let res = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const { token } = await res.json();
const books = await (await fetch(base + "/api/books", { headers: H(token) })).json();
const bookId = books[0].id;

// ---- A. 文件内重复 + 1000 限制解除 ----
let rows = ["时间,金额,收支,分类,名称,支付方式"];
for (let i = 0; i < 1200; i++) {
  rows.push(`2026-03-${String((i % 28) + 1).padStart(2, "0")} 10:00,${10 + (i % 5)},支出,餐饮,午饭,支付宝`);
}
const csvBig = rows.join("\n");
const fd = new FormData();
fd.append("file", new Blob([csvBig], { type: "text/csv" }), "big.csv");
fd.append("source", "generic");
res = await fetch(base + `/api/import/preview?bookId=${bookId}`, { method: "POST", headers: { authorization: "Bearer " + token }, body: fd });
let p = await res.json();
console.log("A1 解析条数:", p.count, p.count === 1200 ? "✅ 无1000上限" : "❌ 仍被截断");
// 1200 行里有大量同指纹，dupCount 应 > 0（文件内重复被标记）
console.log("A2 文件内重复标记数:", p.dupCount, p.dupCount > 0 ? "✅ 文件内重复已标记" : "❌");

// ---- B. 默认跳过重复导入（只传非重复项） ----
let eff = p.items.filter((it) => !it.dup);
res = await fetch(base + `/api/import/confirm?bookId=${bookId}`, { method: "POST", headers: H(token), body: JSON.stringify({ items: eff, dedup: false }) });
let c = await res.json();
console.log("B1 默认跳过重复导入:", JSON.stringify(c), c.imported === eff.length ? "✅ 跳过重复生效" : "❌");

// ---- C. 用户选择「仍要导入」全部 → 后端不自动去重 ----
res = await fetch(base + `/api/import/confirm?bookId=${bookId}`, { method: "POST", headers: H(token), body: JSON.stringify({ items: p.items, dedup: false }) });
c = await res.json();
console.log("C1 仍要导入(全量):", JSON.stringify(c), c.imported === 1200 ? "✅ 用户可强制导入重复" : "❌");

// ---- D. 与已有账单重复：再次预览同文件，全部应标记为 dup ----
const fd2 = new FormData();
fd2.append("file", new Blob([csvBig], { type: "text/csv" }), "big.csv");
fd2.append("source", "generic");
res = await fetch(base + `/api/import/preview?bookId=${bookId}`, { method: "POST", headers: { authorization: "Bearer " + token }, body: fd2 });
p = await res.json();
console.log("D1 与已有账单重复标记:", p.dupCount, p.dupCount === 1200 ? "✅ 已存在账单正确标记重复" : "❌ 应为1200");

process.exit(0);
