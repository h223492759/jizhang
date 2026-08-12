// 验证：记账只传日期，时分秒由系统按保存/修改时刻自动补上
process.env.DATA_DIR = "/tmp/cb-time-test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";
process.env.PORT = "9698";

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 600));

const base = "http://127.0.0.1:9698";
const H = (t) => ({ "Content-Type": "application/json", Authorization: "Bearer " + t });

// 登录
let res = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
let { token } = await res.json();

// 取账本
res = await fetch(base + "/api/books", { headers: H(token) });
const books = await res.json();
const bookId = books[0].id;
const q = (p) => "?" + new URLSearchParams({ ...p, bookId }).toString();

// 1) 新建：只传日期 2026-08-12
res = await fetch(base + "/api/flows" + q(), {
  method: "POST",
  headers: H(token),
  body: JSON.stringify({ type: "expense", amount: 12.5, category: "餐饮", description: "午饭", flow_time: "2026-08-12" }),
});
let created = await res.json();
console.log("① 新建返回 id:", created.id);

// 读取刚建的流水，看 flow_time
res = await fetch(base + "/api/flows" + q({ pageSize: 1 }), { headers: H(token) });
let list = (await res.json()).list;
const f = list[0];
console.log("① 存储 flow_time:", f.flow_time);
const ok1 = /^2026-08-12 \d{2}:\d{2}:\d{2}$/.test(f.flow_time);
console.log(ok1 ? "✅ 日期保留、时分秒=保存时刻" : "❌ 时间格式异常");

// 2) 编辑：改成日期 2026-07-01（不改其他），时间应刷新为修改时刻
await new Promise((r) => setTimeout(r, 1100)); // 确保秒数不同
res = await fetch(base + "/api/flows/" + f.id + q(), {
  method: "PUT",
  headers: H(token),
  body: JSON.stringify({ type: "expense", amount: 12.5, category: "餐饮", description: "午饭", flow_time: "2026-07-01" }),
});
console.log("② 编辑返回:", JSON.stringify(await res.json()));
res = await fetch(base + "/api/flows" + q({ pageSize: 1 }), { headers: H(token) });
const f2 = (await res.json()).list[0];
console.log("② 编辑后 flow_time:", f2.flow_time);
const ok2 = /^2026-07-01 \d{2}:\d{2}:\d{2}$/.test(f2.flow_time);
console.log(ok2 ? "✅ 编辑后日期保留、时分秒=修改时刻" : "❌ 编辑时间异常");

process.exit(0);
