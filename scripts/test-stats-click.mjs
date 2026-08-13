// 集成测试：统计饼图点击（修复回归）+ 常用名称按分类分组
// 用与导入格式一致的示例 CSV：
//   1) 直接单测 CSV 解析（parseBill）—— 与「上传 CSV 文件」走同一套解析逻辑
//   2) 经 JSON 模板导入入库（insertMany）—— 与确认导入同一落库逻辑
//   3) 验证 /stats/category、/stats/attribution，以及饼图点击触发的 /flows?category=/attribution= 能返回数据
//   4) 验证 /presets 返回的名称带 category（前端按分类分组的前提）
//   5) 单测 statsDetail 的 resolvePieDetail / resolveBarDetail（即修复点）
process.env.DATA_DIR = "/tmp/cb-stats-test-" + Date.now();
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";
process.env.PORT = "9656";
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) delete process.env[k];
process.env.NO_PROXY = "127.0.0.1,localhost";

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 700));

const BASE = "http://127.0.0.1:9656";
const J = (p, opt) => fetch(BASE + p, opt).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const results = [];
function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
}

// 与导入格式一致的示例 CSV（含餐饮/日用/工资等分类与不同常用名称）
const CSV = `日期,收/支,分类,备注,金额,支付方式,归属人
2026-07-01,支出,餐饮,午饭,32.5,微信,张三
2026-07-02,支出,餐饮,晚饭,45,支付宝,张三
2026-07-03,支出,餐饮,早饭,12,微信,李四
2026-07-04,支出,餐饮,午饭,32.5,微信,张三
2026-07-05,支出,日用,纸巾,19.9,支付宝,李四
2026-07-06,支出,日用,洗衣液,39,微信,李四
2026-07-07,支出,餐饮,奶茶,18,微信,张三
2026-07-08,支出,日用,垃圾袋,9.9,支付宝,李四
2026-07-09,收入,工资,月薪,12000,银行,张三
2026-07-10,支出,餐饮,午饭,32.5,微信,张三`;

async function main() {
  const login = await J("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const token = login.data.token;
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const books = await J("/api/books", { headers: H });
  const bookId = books.data[0].id;

  // 1) CSV 解析单测（与上传文件同一逻辑）
  const { parseBill } = await import("../server/lib/csv.js");
  const parsed = parseBill(Buffer.from(CSV), { source: "auto" }).items;
  ok("CSV 解析出 10 条", parsed.length === 10, `count=${parsed.length}`);
  const food = parsed.filter((x) => x.category === "餐饮");
  const daily = parsed.filter((x) => x.category === "日用");
  ok("CSV 解析：餐饮 6 笔 / 日用 3 笔", food.length === 6 && daily.length === 3, `餐饮=${food.length} 日用=${daily.length}`);
  ok("CSV 解析：名称保留（午餐/纸巾）", parsed.some((x) => x.description === "午饭") && parsed.some((x) => x.description === "纸巾"));

  // 2) 真实走「上传 CSV 文件」链路：preview（multipart）+ confirm
  const fd = new FormData();
  fd.append("file", new Blob([CSV], { type: "text/csv" }), "test.csv");
  const prev = await fetch(`${BASE}/api/import/preview?bookId=${bookId}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  const prevData = await prev.json();
  ok("CSV 预览解析出 10 条", prevData.items && prevData.items.length === 10, `count=${prevData.items?.length}`);
  const confirm = await J(`/api/import/confirm?bookId=${bookId}`, { method: "POST", headers: H, body: JSON.stringify({ items: prevData.items }) });
  ok("CSV 确认导入成功", confirm.data.imported === 10, `imported=${confirm.data.imported}`);

  // 3) 分类统计 + 饼图点击触发的明细查询
  const cat = await J(`/api/stats/category?bookId=${bookId}&type=expense&start=2026-07-01&end=2026-07-31`, { headers: H });
  ok("分类统计含「餐饮」", cat.data.some((c) => c.name === "餐饮"));
  ok("分类统计含「日用」", cat.data.some((c) => c.name === "日用"));

  const foodFlows = await J(`/api/flows?bookId=${bookId}&type=expense&category=餐饮&start=2026-07-01&end=2026-07-31`, { headers: H });
  ok("饼图点击「餐饮」→ 明细 6 笔（修复点）", foodFlows.data.list.length === 6, `rows=${foodFlows.data.list.length}`);
  const dailyFlows = await J(`/api/flows?bookId=${bookId}&type=expense&category=日用&start=2026-07-01&end=2026-07-31`, { headers: H });
  ok("饼图点击「日用」→ 明细 3 笔", dailyFlows.data.list.length === 3, `rows=${dailyFlows.data.list.length}`);

  // 4) 归属统计 + 点击明细
  const attr = await J(`/api/stats/attribution?bookId=${bookId}&type=expense&start=2026-07-01&end=2026-07-31`, { headers: H });
  const someone = attr.data[0];
  ok("归属统计有数据", !!someone, `归属人=${someone?.name}`);
  const attrFlows = await J(`/api/flows?bookId=${bookId}&type=expense&attribution=${encodeURIComponent(someone.name)}&start=2026-07-01&end=2026-07-31`, { headers: H });
  ok("饼图点击归属人 → 明细有数据", attrFlows.data.list.length > 0, `rows=${attrFlows.data.list.length}`);

  // 5) /presets 返回的名称带 category（前端按分类分组的前提）
  const presets = await J(`/api/presets?bookId=${bookId}&type=expense`, { headers: H });
  const freq = presets.data.frequent || [];
  ok("高频名称带分类（餐饮·午饭）", freq.some((x) => x.category === "餐饮" && x.name === "午饭"));
  ok("高频按分类隔离：餐饮高频全是餐饮名称（不含日用）", freq.filter((x) => x.category === "餐饮").every((x) => ["午饭", "晚饭", "早饭", "奶茶"].includes(x.name)));

  // 6) 单测 statsDetail 点击解析（修复点：seriesName 必须能命中维度）
  const { resolvePieDetail, resolveBarDetail } = await import("../web/src/lib/statsDetail.js");
  const rPie = resolvePieDetail({ seriesName: "支出分类", name: "餐饮" }, { start: "2026-07-01", end: "2026-07-31" });
  ok("resolvePieDetail 命中 category 维度", rPie && rPie.dim === "category" && rPie.query.category === "餐饮" && rPie.query.type === "expense");
  const rAttr = resolvePieDetail({ seriesName: "消费归属", name: "张三" }, { start: "2026-07-01", end: "2026-07-31" });
  ok("resolvePieDetail 命中 attribution 维度", rAttr && rAttr.dim === "attribution" && rAttr.query.attribution === "张三");
  // 回归：若 series 未设 name（旧 bug），seriesName 为空 → 解析失败（这正是修复前点击无反应的原因）
  const rNull = resolvePieDetail({ seriesName: "", name: "餐饮" }, {});
  ok("seriesName 为空时解析为 null（旧 bug 根因）", rNull === null);
  const rBar = resolveBarDetail({ seriesName: "收入", dataIndex: 0 }, [{ month: "2026-07" }]);
  ok("resolveBarDetail 按月+收支配明细", rBar && rBar.type === "income" && rBar.query.type === "income");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
