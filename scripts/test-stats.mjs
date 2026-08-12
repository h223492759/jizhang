// 验证：flows 列表新增 payment 过滤 + stats/facets 返回 months
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.resolve(".");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cb-"));
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "9611";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";

const srv = spawn("node", ["server/index.js"], { cwd: root, env: process.env, stdio: "ignore" });
const base = "http://127.0.0.1:9611";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (t) => ({ "Content-Type": "application/json", Authorization: "Bearer " + t });

async function main() {
  await sleep(900);
  // 用预置管理员登录（默认关闭自助注册）
  let r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  let j = await r.json();
  const token = j.token;
  // 拿到默认账本
  r = await fetch(base + "/api/books", { headers: H(token) });
  j = await r.json();
  const bookId = j[0].id;

  // 造两条：同一分类，不同支付方式
  const mk = (payment, cat, amt) => fetch(base + `/api/flows?bookId=${bookId}`, { method: "POST", headers: H(token), body: JSON.stringify({ type: "expense", amount: amt, category: cat, payment_method: payment, flow_time: "2026-03-15 12:00:00", description: "测试" }) }).then(() => {});
  await mk("微信", "餐饮", 30);
  await mk("支付宝", "餐饮", 50);
  await mk("", "餐饮", 20); // 未标注

  // payment 过滤：微信 → 应只返回 1 条(30)
  r = await fetch(base + `/api/flows?bookId=${bookId}&type=expense&payment=微信`, { headers: H(token) });
  j = await r.json();
  console.log("① 按支付方式=微信过滤:", JSON.stringify(j.list.map(x=>x.amount)), j.list.length === 1 && j.list[0].amount === 30 ? "✅" : "❌");

  // payment=未标注 → 应返回空支付方式那条(20)
  r = await fetch(base + `/api/flows?bookId=${bookId}&type=expense&payment=未标注`, { headers: H(token) });
  j = await r.json();
  console.log("② 按支付方式=未标注过滤:", JSON.stringify(j.list.map(x=>x.amount)), j.list.length === 1 && j.list[0].amount === 20 ? "✅" : "❌");

  // facets 应返回 months 含 2026-03
  r = await fetch(base + `/api/stats/facets?bookId=${bookId}`, { headers: H(token) });
  j = await r.json();
  console.log("③ facets.months:", JSON.stringify(j.months), j.months.includes("2026-03") ? "✅" : "❌");

  srv.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
