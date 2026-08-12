// 冒烟测试：启动服务并验证 /api/meta 返回版本号
process.env.DATA_DIR = "/tmp/cb-meta-test";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin123";
process.env.PORT = "9699";

await import("../server/index.js");

await new Promise((r) => setTimeout(r, 600));

const res = await fetch("http://127.0.0.1:9699/api/meta");
const data = await res.json();
console.log("GET /api/meta =>", JSON.stringify(data));
console.log(data.version && data.version.length ? "✅ 版本号已返回" : "❌ 版本号缺失");

const h = await fetch("http://127.0.0.1:9699/api/health");
console.log("GET /api/health =>", (await h.json()).ok ? "✅ ok" : "❌");

process.exit(0);
