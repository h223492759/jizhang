// 集成测试：名称缺省为分类名 / AI 设置读写 / 图片解析未配置兜底
// 自包含：启动服务（临时数据目录）后直接对本进程内服务发请求。
process.env.DATA_DIR = "/tmp/cb-ai-test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";
process.env.PORT = "9655";
// 清掉可能存在的外部 AI 环境变量，保证测试从「未配置」状态开始（DB 配置仍会优先生效）
for (const k of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_IMAGE_MODEL"]) delete process.env[k];
// 避免沙箱代理拦截 127.0.0.1
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) delete process.env[k];
process.env.NO_PROXY = "127.0.0.1,localhost";

await import("../server/index.js");
await new Promise((r) => setTimeout(r, 700));

const BASE = "http://127.0.0.1:9655";
const J = (p, opt) => fetch(BASE + p, opt).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

let token = "";
const results = [];
function ok(name, cond, extra = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
}

async function main() {
  const login = await J("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  token = login.data.token;
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // 先清掉可能残留的 AI 配置，保证测试从「未配置」状态开始（沙箱临时库可能跨命令保留）
  await J("/api/settings/ai", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ provider: "", baseUrl: "", apiKey: "", model: "", imageModel: "" }),
  });

  const books = await J("/api/books", { headers: H });
  const bookId = books.data[0].id;

  // 1) 名称缺省为分类名
  const add = await J("/api/flows", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ type: "expense", amount: 12.5, category: "餐饮", bookId }),
  });
  const list = await J(`/api/flows?bookId=${bookId}&pageSize=5`, { headers: H });
  const flow = list.data.list.find((f) => f.id === add.data.id);
  ok("未填名称时自动用分类名「餐饮」", flow && flow.description === "餐饮", `description=${flow && flow.description}`);
  await J(`/api/flows/${add.data.id}`, { method: "DELETE", headers: H, body: JSON.stringify({ bookId }) });

  // 2) 图片解析未配置 AI 时返回友好提示
  const st0 = await J("/api/ai/status", { headers: H });
  ok("初始未配置 AI => enabled=false", st0.data.enabled === false);
  const imgNoAi = await J("/api/ai/parse-image", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ image: "data:image/png;base64,AAAA", bookId }),
  });
  ok("未配置视觉模型 => 400 且提示文案", imgNoAi.status === 400 && /视觉模型/.test(imgNoAi.data.error || ""), imgNoAi.data.error);

  // 3) 保存 AI 设置（管理员）
  const setAi = await J("/api/settings/ai", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      provider: "zhipu",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "sk-test-secret-123",
      model: "glm-4-flash",
      imageModel: "glm-4v-flash",
    }),
  });
  ok("保存 AI 设置成功", setAi.data.ok === true);

  // 4) 读取 AI 设置：apiKey 脱敏、enabled 生效
  const getAi = await J("/api/settings/ai", { headers: H });
  ok("读取到 provider=zhipu", getAi.data.provider === "zhipu");
  ok("baseUrl 正确", getAi.data.baseUrl === "https://open.bigmodel.cn/api/paas/v4");
  ok("apiKey 脱敏为 ******", getAi.data.apiKey === "******" && getAi.data.apiKeySet === true);
  ok("imageModel 正确", getAi.data.imageModel === "glm-4v-flash");
  ok("启用状态生效 enabled=true", getAi.data.enabled === true);

  // 5) 状态接口反映配置
  const st1 = await J("/api/ai/status", { headers: H });
  ok("status.enabled=true", st1.data.enabled === true);
  ok("status.imageModel=glm-4v-flash", st1.data.imageModel === "glm-4v-flash");

  // 6) 再次保存但 apiKey 用占位符 => 保留原 key
  await J("/api/settings/ai", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ provider: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "******", model: "glm-4-flash", imageModel: "glm-4v-flash" }),
  });
  const getAi2 = await J("/api/settings/ai", { headers: H });
  ok("占位符 apiKey 不覆盖原值（仍 set）", getAi2.data.apiKeySet === true);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
