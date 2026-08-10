/**
 * 回归冒烟测试：昵称同步 / 注册关闭 / 管理员建号 / 常用备注
 * 用法：node scripts/smoke-test.mjs [baseURL] [adminUser] [adminPass]
 */
const BASE = process.argv[2] || "http://localhost:9600";
const USER = process.argv[3] || "admin";
const PASS = process.argv[4] || "admin123";

let token = "";
let pass = 0;
let fail = 0;

async function call(method, path, body, { form = false, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body && !form) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (form) payload = body;
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (raw) return { status: res.status, data };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return data;
}

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  ${detail}`); }
}

const run = async () => {
  console.log("\n【1】登录");
  const login = await call("POST", "/api/auth/login", { username: USER, password: PASS });
  token = login.token;
  check("管理员登录成功", !!token);
  const meId = login.user.id;
  const originalNick = login.user.nickname;
  console.log(`     当前昵称：${originalNick}`);

  const books = await call("GET", "/api/books");
  const bookId = books[0].id;

  console.log("\n【2】历史归属：未绑定清单");
  const unbound = await call("GET", "/api/admin/users/attributions/unbound");
  console.log("     " + JSON.stringify(unbound.map((u) => `${u.name}×${u.count}`)));
  const stale = unbound.find((u) => u.name !== originalNick);
  check("能识别出未绑定用户的历史归属文字", unbound.length >= 0);

  if (stale) {
    console.log(`\n【3】把历史归属「${stale.name}」绑定到当前管理员`);
    const bindRes = await call("POST", "/api/admin/users/attributions/bind", {
      from: stale.name, userId: meId,
    });
    check(`绑定成功（${bindRes.updated} 条）`, bindRes.updated > 0);
    const after = await call("GET", `/api/flows?bookId=${bookId}&pageSize=100`);
    const stillStale = after.list.filter((f) => f.attribution === stale.name);
    check("绑定后流水归属已变成当前昵称", stillStale.length === 0,
      `仍有 ${stillStale.length} 条显示旧文字`);
  } else {
    console.log("\n【3】没有待认领的历史归属，跳过");
  }

  console.log("\n【4】★核心★ 改昵称 → 历史账单归属应自动同步");
  const testNick = "回归测试昵称" + Date.now().toString().slice(-4);
  await call("PUT", "/api/auth/me", { nickname: testNick });
  const flows2 = await call("GET", `/api/flows?bookId=${bookId}&pageSize=100`);
  const mine = flows2.list.filter((f) => f.attribution_uid === meId);
  check("我名下的流水条数 > 0", mine.length > 0);
  check("全部显示为新昵称", mine.every((f) => f.attribution === testNick),
    JSON.stringify(mine.map((f) => f.attribution)));

  const facets = await call("GET", `/api/stats/facets?bookId=${bookId}`);
  check("筛选器里的归属选项已同步", facets.attributions.includes(testNick),
    JSON.stringify(facets.attributions));
  const attrPie = await call("GET", `/api/stats/attribution?bookId=${bookId}&type=expense`);
  check("归属饼图口径已同步", attrPie.every((x) => x.name !== "管理员"),
    JSON.stringify(attrPie));

  // 改回去
  await call("PUT", "/api/auth/me", { nickname: originalNick });
  const flows3 = await call("GET", `/api/flows?bookId=${bookId}&pageSize=100`);
  check("改回原昵称同样即时生效",
    flows3.list.filter((f) => f.attribution_uid === meId).every((f) => f.attribution === originalNick));

  console.log("\n【5】自助注册应被拒绝");
  const cfg = await call("GET", "/api/auth/config");
  check("配置显示注册已关闭", cfg.allowRegister === false, JSON.stringify(cfg));
  const reg = await call("POST", "/api/auth/register",
    { username: "hacker" + Date.now(), password: "123456" }, { raw: true });
  check("注册接口返回 403", reg.status === 403, JSON.stringify(reg.data));

  console.log("\n【6】管理员新增用户");
  const uname = "test" + Date.now().toString().slice(-6);
  const created = await call("POST", "/api/admin/users",
    { username: uname, password: "abc123456", nickname: "测试" + uname.slice(-4), role: "user" });
  check("创建成功并自动建了默认账本", !!created.user?.bookId);
  const dup = await call("POST", "/api/admin/users",
    { username: uname, password: "abc123456" }, { raw: true });
  check("重复用户名被拒绝", dup.status === 400, JSON.stringify(dup.data));
  const weak = await call("POST", "/api/admin/users",
    { username: uname + "x", password: "123" }, { raw: true });
  check("弱密码被拒绝", weak.status === 400, JSON.stringify(weak.data));

  const newLogin = await call("POST", "/api/auth/login",
    { username: uname, password: "abc123456" }, { raw: true });
  check("新用户能正常登录", newLogin.status === 200);

  const users = await call("GET", "/api/admin/users");
  check("用户列表包含新用户", users.some((u) => u.username === uname));
  const delRes = await call("DELETE", `/api/admin/users/${created.user.id}`);
  check("删除新用户成功", delRes.ok === true);
  const selfDel = await call("DELETE", `/api/admin/users/${meId}`, null, { raw: true });
  check("不能删除自己", selfDel.status === 400, JSON.stringify(selfDel.data));

  console.log("\n【7】常用备注预设");
  const pName = "回归早饭" + Date.now().toString().slice(-4);
  const p = await call("POST", "/api/presets",
    { bookId, name: pName, type: "expense", category: "餐饮", payment_method: "微信", amount: 12 });
  check("新增常用名称成功", !!p.id);
  const dupP = await call("POST", "/api/presets",
    { bookId, name: pName, type: "expense" }, { raw: true });
  check("重复常用名称被拒绝", dupP.status === 400);

  // 造 3 条同名备注，验证高频统计
  for (let i = 0; i < 3; i++) {
    await call("POST", "/api/flows",
      { bookId, type: "expense", amount: 9.9, category: "餐饮", description: "回归高频测试", payment_method: "支付宝" });
  }
  const sug = await call("GET", `/api/presets?bookId=${bookId}&type=expense`);
  check("常用分组里有刚加的预设", sug.presets.some((x) => x.name === pName));
  const freqHit = sug.frequent.find((x) => x.name === "回归高频测试");
  check("高频分组统计出 3 次", freqHit?.count === 3, JSON.stringify(sug.frequent.slice(0, 3)));
  check("高频项带出了分类", freqHit?.category === "餐饮");
  check("高频项带出了支付方式", freqHit?.payment_method === "支付宝");
  check("三组之间不重复展示",
    !sug.recent.some((r) => sug.frequent.some((f) => f.name === r.name)));

  await call("DELETE", `/api/presets/${p.id}?bookId=${bookId}`);
  const sug2 = await call("GET", `/api/presets?bookId=${bookId}&type=expense`);
  check("删除常用名称成功", !sug2.presets.some((x) => x.name === pName));

  // 清理测试流水
  const all = await call("GET", `/api/flows?bookId=${bookId}&pageSize=200&keyword=回归高频测试`);
  for (const f of all.list) await call("DELETE", `/api/flows/${f.id}?bookId=${bookId}`);
  check("测试流水已清理", true);

  console.log("\n【8】归属人下拉数据");
  const attrs = await call("GET", `/api/flows/attributions?bookId=${bookId}`);
  check("能取到账本成员列表", attrs.members.length > 0, JSON.stringify(attrs));

  console.log(`\n${"=".repeat(46)}`);
  console.log(`  通过 ${pass} 项 / 失败 ${fail} 项`);
  console.log("=".repeat(46) + "\n");
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error("\n💥 测试中断：", e.message);
  process.exit(1);
});
