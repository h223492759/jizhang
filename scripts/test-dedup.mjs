import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), "cb-dedup-test-" + Date.now());
fs.mkdirSync(tmp, { recursive: true });
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "9732";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";

const base = "http://127.0.0.1:9732";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (token) => ({ "content-type": "application/json", authorization: "Bearer " + token });

await import("../server/index.js");
await sleep(900);

// 登录拿 token + 默认账本 id
let res = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const { token, user } = await res.json();
const books = await (await fetch(base + "/api/books", { headers: H(token) })).json();
const bookId = books[0].id;
console.log("账本 id =", bookId);

const items = [
  { type: "expense", amount: 28, category: "餐饮", description: "午饭", payment_method: "微信", flow_time: "2026-07-01 12:00:00" },
  { type: "expense", amount: 5.5, category: "交通", description: "地铁", payment_method: "地铁卡", flow_time: "2026-07-01 18:00:00" },
  { type: "income", amount: 10000, category: "工资", description: "月薪", payment_method: "", flow_time: "2026-07-05 10:00:00" },
];

// 第 1 次导入
res = await fetch(base + `/api/import/template?bookId=${bookId}`, {
  method: "POST", headers: H(token), body: JSON.stringify({ items }),
});
console.log("① 首次导入:", JSON.stringify(await res.json()));

// 第 2 次导入（完全相同）
res = await fetch(base + `/api/import/template?bookId=${bookId}`, {
  method: "POST", headers: H(token), body: JSON.stringify({ items }),
});
console.log("② 重复导入:", JSON.stringify(await res.json()));

// 第 3 次：改一个金额（非重复）→ 应只导入 1 条，跳过 2 条
const items2 = items.map((x, i) => (i === 0 ? { ...x, amount: 30 } : x));
res = await fetch(base + `/api/import/template?bookId=${bookId}`, {
  method: "POST", headers: H(token), body: JSON.stringify({ items: items2 }),
});
console.log("③ 部分改动再导入:", JSON.stringify(await res.json()));

// 校验库里实际只有 4 条（3 + 1 新）
res = await fetch(base + `/api/flows?bookId=${bookId}&pageSize=1`, { headers: H(token) });
const flowRes = await res.json();
console.log("④ 库中流水总数:", flowRes.total, flowRes.total === 4 ? "✅ 查重正确" : "❌ 数量异常");
process.exit(0);
