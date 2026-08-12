// 绕过沙箱可能存在的 HTTP 代理（避免 127.0.0.1 被代理拦截返回 HTML）
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const base = process.env.TEST_BASE || "http://127.0.0.1:9644";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (t) => ({ "Content-Type": "application/json", Authorization: "Bearer " + t });

async function main() {
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const loginText = await login.text();
  if (!login.headers.get("content-type")?.includes("json")) {
    console.error("login 返回非 JSON：", loginText.slice(0, 200));
    process.exit(1);
  }
  const { token } = JSON.parse(loginText);
  const me = await fetch(base + "/api/auth/me", { headers: H(token) }).then((r) => r.json());
  const books = await fetch(base + "/api/books", { headers: H(token) }).then((r) => r.json());
  const bookId = books[0].id;

  // 每次运行用不同日期，避免重复插入累积导致 Top 出现重复行
  const day = "2026-03-" + String(10 + (Date.now() % 18)).padStart(2, "0");
  const flows = [
    { type: "expense", amount: 50, category: "餐饮", flow_time: `${day} 08:00:00`, description: "早饭" },
    { type: "expense", amount: 300, category: "购物", flow_time: `${day} 12:00:00`, description: "衣服" },
    { type: "expense", amount: 120, category: "交通", flow_time: `${day} 18:00:00`, description: "打车" },
    { type: "expense", amount: 999, category: "数码", flow_time: `${day} 20:00:00`, description: "键盘" },
    { type: "income", amount: 8000, category: "工资", flow_time: `${day} 09:00:00`, description: "月薪" },
    { type: "income", amount: 200, category: "红包", flow_time: `${day} 21:00:00`, description: "好友" },
    { type: "expense", amount: 10, category: "餐饮", flow_time: "2026-03-06 08:00:00", description: "咖啡" },
  ];
  for (const f of flows) {
    await fetch(base + `/api/flows?bookId=${bookId}`, { method: "POST", headers: H(token), body: JSON.stringify(f) });
  }

  const res = await fetch(base + `/api/stats/daily?start=2026-03-01&end=2026-03-31&bookId=${bookId}`, { headers: H(token) });
  const data = await res.json();
  const d05 = data.find((d) => d.date === day);
  const exp = d05.top?.expense || [];
  const inc = d05.top?.income || [];
  console.log("03-05 支出 Top:", exp.map((t) => `${t.category}¥${t.amount}`).join(", "));
  console.log("03-05 收入 Top:", inc.map((t) => `${t.category}¥${t.amount}`).join(", "));
  const okExp = exp.length === 3 && exp[0].amount === 999 && exp[1].amount === 300 && exp[2].amount === 120;
  const okInc = inc.length === 2 && inc[0].amount === 8000 && inc[1].amount === 200;
  console.log(okExp ? "✅ 支出 Top3 正确（取金额最大 3 笔）" : "❌ 支出 Top3 异常");
  console.log(okInc ? "✅ 收入 Top 正确（仅 2 笔）" : "❌ 收入 Top 异常");
  console.log("合计 <=6 校验:", exp.length + inc.length <= 6 ? "✅" : "❌");

  const cats = await fetch(base + `/api/categories?bookId=${bookId}`, { headers: H(token) }).then((r) => r.json());
  const dup = cats.filter((c) => c.name === "水果").length;
  console.log("水果分类数量（应为1）:", dup, dup === 1 ? "✅ 无重复" : "❌ 重复");
  const newCats = cats.filter((c) => ["水果","孩子","零食","运动","服饰","美容","长辈","社交","旅行","烟酒","数码","居家","宠物","礼金","备婚","礼物","办公","亲友","彩票","保险","汽车","快递","捐赠","兼职"].includes(c.name));
  console.log("截图新增分类已存在:", newCats.length, newCats.length === 24 ? "✅ 全部新增" : "⚠️ 数量不符");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
