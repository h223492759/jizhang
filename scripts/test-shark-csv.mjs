import { readFileSync } from "fs";
import { parseBill } from "../server/lib/csv.js";

const buf = readFileSync("Z:/鲨鱼记账示例.csv");
const { items, headers, mapping } = parseBill(buf, { source: "auto" });

console.log("=== HEADERS ===");
console.log(headers.join(" | "));
console.log("\n=== DETECTED MAPPING ===");
console.log(JSON.stringify(mapping, null, 2));
console.log(`\n=== PARSED ${items.length} ITEMS ===`);
for (const it of items) {
  console.log(
    `[${it.type === "income" ? "收入" : "支出"}] ¥${it.amount} | 类别=${it.category} | 归属=${it.attribution || "(空)"} | 名称=${it.description} | 时间=${it.flow_time}`
  );
}

// 校验：全部应为支出，金额无误，名称/归属保留
const wrong = items.filter((i) => i.type !== "expense");
console.log(`\n=== 断言 ===`);
console.log("全部为支出(鲨鱼示例均为支出):", wrong.length === 0 ? "✅" : `❌ 有${wrong.length}条非支出`);
console.log("名称(备注)列已识别:", items.every((i) => i.description) ? "✅" : "❌ 备注为空");
console.log("归属列已识别:", items.every((i) => i.attribution) ? "✅" : "❌ 归属为空");
console.log("示例代码金额 4449.23 存在:", items.some((i) => i.amount === 4449.23) ? "✅" : "❌");
console.log("日期 2026/7/10 解析:", items.some((i) => i.flow_time.startsWith("2026-07-10")) ? "✅" : "❌");
