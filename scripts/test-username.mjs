import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// 必须在导入 db.js 之前设置好 DATA_DIR
const tmp = path.join(os.tmpdir(), "cb-username-test-" + Date.now());
fs.mkdirSync(tmp, { recursive: true });
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "9731";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";

const base = "http://127.0.0.1:9731";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import("../server/index.js");
await sleep(900);

function j(r) {
  return r.json();
}

// 1) 用默认 admin/admin123 登录
let res = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
let { token, user } = await j(res);
console.log("① 登录:", res.status, "user=", user.username, "role=", user.role);

// 2) 改自己的登录用户名为 boss
res = await fetch(base + "/api/admin/users/" + user.id, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify({ username: "boss" }),
});
console.log("② 改用户名:", res.status, JSON.stringify(await j(res)));

// 3) 用新用户名 boss 重新登录
res = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "boss", password: "admin123" }),
});
const relogin = await j(res);
console.log("③ 用新用户名登录:", res.status, relogin.user ? "OK 新用户名=" + relogin.user.username : "失败=" + JSON.stringify(relogin));

// 4) 旧用户名 admin 应登录失败
res = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
console.log("④ 旧用户名 admin 再登录:", res.status, "（应为 400 用户名或密码错误）");

console.log("\n结论:", relogin.user && relogin.user.username === "boss" ? "✅ 改用户名功能正常" : "❌ 改用户名功能异常");
process.exit(0);
