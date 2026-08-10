import { parseBill } from "../server/lib/csv.js";

function show(title, buf, opts) {
  const r = parseBill(buf, opts);
  console.log(`\n=== ${title} ===`);
  console.log("headers:", r.headers);
  console.log("detectedMapping:", r.mapping);
  console.log("items:", JSON.stringify(r.items, null, 1));
}

// 1) 其它记账软件：时间/类型/金额/分类/备注/账户
const csv1 = Buffer.from(
  `时间,类型,金额,分类,备注,账户
2026-01-05,支出,28.5,餐饮,午餐,微信
2026-01-06,收入,5000,工资,发薪,银行
2026-03-12,支出,12,交通,地铁,支付宝`,
  "utf8"
);
show("通用CSV-类型列(自动识别)", csv1, { source: "generic" });

// 2) 带正负号的金额（无方向列）
const csv2 = Buffer.from(
  `日期,分类,账户,金额
2026/2/1,餐饮,微信,-45.6
2026/2/3,工资,银行,8000`,
  "utf8"
);
show("通用CSV-金额正负号(自动识别)", csv2, { source: "generic" });

// 3) 收/支列 + 金额
const csv3 = Buffer.from(
  `记账日期,收/支,金额,交易分类,支付方式,备注
2026-04-01,支出,99,购物,微信,买菜
2026-04-02,收入,200,转账,银行,收款`,
  "utf8"
);
show("通用CSV-收/支列(自动识别)", csv3, { source: "generic" });

// 4) 手动映射（强制指定列）
const csv4 = Buffer.from(
  `when,io,howmuch,note
2026-05-01,out,33.3,test`,
  "utf8"
);
show(
  "通用CSV-手动映射(when/io/howmuch)",
  csv4,
  { source: "generic", mapping: { time: "when", io: "io", amount: "howmuch", description: "note" } }
);

// 5) 支付宝仍可用
const ali = Buffer.from(
  `支付宝交易记录明细查询
账号:xxx
交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态
2026-06-01,餐饮,肯德基,午饭,支出,35,支付宝,成功`,
  "utf8"
);
show("支付宝(自动识别)", ali, { source: "auto" });
