import { parse } from "csv-parse/sync";
import iconv from "iconv-lite";
import dayjs from "dayjs";

// 支付宝/微信导出的 CSV 大多是 GBK 编码，且前面有若干说明行。
// 这里先按 GBK 解码（若解出乱码则回退 UTF-8），再定位真正的表头行。
function decode(buf) {
  const gbk = iconv.decode(buf, "gbk");
  const utf8 = buf.toString("utf8");
  // 谁包含更多可识别的中文表头关键词就用谁
  const score = (s) =>
    ["交易时间", "交易类型", "收/支", "金额", "商品", "时间", "日期", "分类", "备注"].reduce(
      (n, k) => n + (s.includes(k) ? 1 : 0),
      0
    );
  return score(gbk) > score(utf8) ? gbk : utf8;
}

// 定位表头行：第一行“看起来像表头”的行（含逗号，且命中任一常见列关键词）
function locateHeader(lines) {
  const kw = /(交易时间|记账时间|时间|日期|金额|收\/支|收支|交易|date|amount|分类|备注)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(",") && kw.test(line)) return i;
  }
  // 兜底：没有任何已知关键词时，取第一行“含逗号且至少两个字段”的非空行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && line.includes(",") && line.split(",").length >= 2) return i;
  }
  return -1;
}

function toRecords(text) {
  const lines = text.split(/\r?\n/);
  const h = locateHeader(lines);
  if (h < 0) return [];
  // csv-parse 的 delimiter:"auto" 对中文数据不稳（会把整行识别成单列），
  // 这里自行从表头行统计最常见的分隔符（逗号/制表符/分号/竖线）
  const headerLine = lines[h];
  const cands = [",", "\t", ";", "|"];
  let delim = ",";
  let best = 0;
  for (const d of cands) {
    const c = headerLine.split(d).length - 1;
    if (c > best) { best = c; delim = d; }
  }
  const body = lines.slice(h).join("\n");
  return parse(body, {
    columns: (header) => header.map((x) => x.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter: delim,
    trim: true,
  });
}

function num(s) {
  if (!s) return 0;
  return Math.abs(Number(String(s).replace(/[¥￥,\s]/g, ""))) || 0;
}

// 保留正负号的数字（通用导入用，金额列可能为负表示支出）
function signedNum(s) {
  if (!s) return 0;
  const m = String(s).replace(/[¥￥,\s]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function fmtTime(s) {
  const d = dayjs(String(s).trim());
  return d.isValid()
    ? d.format("YYYY-MM-DD HH:mm:ss")
    : dayjs().format("YYYY-MM-DD HH:mm:ss");
}

// 支付宝：交易时间 / 交易分类 / 交易对方 / 商品说明 / 收/支 / 金额 / 收/付款方式 / 交易状态
function parseAlipay(records) {
  const out = [];
  for (const rec of records) {
    const io = (rec["收/支"] || "").trim();
    if (io !== "收入" && io !== "支出") continue; // 跳过“不计收支”
    out.push({
      type: io === "收入" ? "income" : "expense",
      amount: num(rec["金额"] || rec["金额（元）"]),
      category: (rec["交易分类"] || "其他").trim() || "其他",
      payment_method: (rec["收/付款方式"] || rec["付款方式"] || "支付宝").trim() || "支付宝",
      description:
        (rec["商品说明"] || rec["商品"] || rec["交易对方"] || "").trim(),
      attribution: "",
      flow_time: fmtTime(rec["交易时间"]),
    });
  }
  return out;
}

// 微信：交易时间 / 交易类型 / 交易对方 / 商品 / 收/支 / 金额(元) / 支付方式 / 当前状态
function parseWechat(records) {
  const out = [];
  for (const rec of records) {
    const io = (rec["收/支"] || "").trim();
    if (io !== "收入" && io !== "支出") continue;
    out.push({
      type: io === "收入" ? "income" : "expense",
      amount: num(rec["金额(元)"] || rec["金额（元）"] || rec["金额"]),
      category: (rec["交易类型"] || "其他").trim() || "其他",
      payment_method: (rec["支付方式"] || "微信").trim() || "微信",
      description: (rec["商品"] || rec["交易对方"] || "").trim(),
      attribution: "",
      flow_time: fmtTime(rec["交易时间"]),
    });
  }
  return out;
}

// ---------- 通用 CSV：自动识别 + 手动映射 ----------

// 每个字段的候选表头关键词（越靠前优先级越高）
const FIELD_PATTERNS = {
  time: [/交易时间/i, /记账时间/i, /时间/i, /日期/i, /date/i, /记账日期/i],
  amount: [/金额/i, /交易额/i, /数额/i, /amount/i, /price/i, /金额\(元\)/i, /金额（元）/i, /钱/i],
  io: [/收入\/支出/i, /收\/支/i, /收支/i, /方向/i, /借贷/i, /进出/i, /流入流出/i, /类型/i, /收支类型/i, /收付款类型/i],
  category: [/交易分类/i, /消费分类/i, /分类/i, /类别/i, /category/i, /消费类型/i],
  payment: [/支付方式/i, /付款方式/i, /账户/i, /银行/i, /卡/i, /钱包/i, /payment/i, /account/i, /资金来源/i, /结算方式/i, /收\/付款方式/i],
  description: [/商品说明/i, /商品/i, /备注/i, /摘要/i, /用途/i, /说明/i, /名称/i, /明细/i, /memo/i, /desc/i, /交易对方/i, /对方/i, /项目/i],
  attribution: [/归属人/i, /归属/i, /成员/i, /记账人/i, /经手人/i, /person/i, /用户名/i, /谁/i],
};

function detectMapping(headers) {
  const map = {};
  for (const [field, pats] of Object.entries(FIELD_PATTERNS)) {
    let best = null;
    let bestScore = 0;
    for (const h of headers) {
      let score = 0;
      pats.forEach((p, idx) => {
        if (p.test(h)) score += pats.length - idx;
      });
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    if (best) map[field] = best;
  }
  // 若同时存在“收入”和“支出”两个金额列，则用它俩代替 io 列
  const incCol = headers.find((h) => /^(收入|收入金额|in\b|credit)/i.test(h));
  const expCol = headers.find((h) => /^(支出|支出金额|out\b|debit)/i.test(h));
  if (incCol && expCol && !map.io) {
    map.income = incCol;
    map.expense = expCol;
  }
  return map;
}

// 根据 io 列的文字判断收/支（兼容“收入/支出/收/支/in/out/+/−”等多种写法）
function inferTypeByIo(v, amount) {
  const s = String(v || "").trim().toLowerCase();
  if (/收|in|^\+/.test(s) && !/支|出|out/.test(s)) return "income";
  if (/支|出|out|^-/.test(s)) return "expense";
  // 没有明确方向词时，退回金额正负
  return amount < 0 ? "expense" : "income";
}

function parseGeneric(records, mapping) {
  if (!mapping || !mapping.amount) return [];
  const out = [];
  for (const rec of records) {
    let type;
    let amount;
    if (mapping.income && mapping.expense) {
      const inc = signedNum(rec[mapping.income]);
      const exp = signedNum(rec[mapping.expense]);
      if (inc > 0) { type = "income"; amount = inc; }
      else if (exp > 0) { type = "expense"; amount = exp; }
      else continue; // 两列都为 0/空，跳过
    } else if (mapping.io) {
      const raw = signedNum(rec[mapping.amount]);
      type = inferTypeByIo(rec[mapping.io], raw);
      amount = Math.abs(raw);
    } else {
      // 没有方向列：靠金额正负判断
      const raw = signedNum(rec[mapping.amount]);
      type = raw < 0 ? "expense" : "income";
      amount = Math.abs(raw);
    }
    if (!amount || amount <= 0) continue;
    out.push({
      type,
      amount,
      category: (mapping.category ? (rec[mapping.category] || "").trim() : "") || "其他",
      payment_method: mapping.payment ? (rec[mapping.payment] || "").trim() : "",
      description: mapping.description ? (rec[mapping.description] || "").trim() : "",
      attribution: mapping.attribution ? (rec[mapping.attribution] || "").trim() : "",
      flow_time: fmtTime(mapping.time ? rec[mapping.time] : ""),
    });
  }
  return out;
}

// opts: { source?: 'auto'|'alipay'|'wechat'|'generic', mapping?: object }
// 返回 { items, headers, mapping }
export function parseBill(buf, opts = {}) {
  const { source = "auto", mapping = null } = opts;
  const text = decode(buf);
  const records = toRecords(text);
  if (!records.length) return { items: [], headers: [], mapping: {} };
  const headers = Object.keys(records[0]);

  // 明确给了映射 → 走通用解析
  if (mapping && mapping.amount) {
    return { items: parseGeneric(records, mapping), headers, mapping };
  }

  if (source === "alipay") return { items: parseAlipay(records), headers, mapping: {} };
  if (source === "wechat") return { items: parseWechat(records), headers, mapping: {} };

  // auto：先尝试微信/支付宝，再退回通用自动识别
  if (text.includes("微信支付账单") || text.includes("当前状态")) {
    return { items: parseWechat(records), headers, mapping: {} };
  }
  if (text.includes("支付宝") && text.includes("交易时间")) {
    return { items: parseAlipay(records), headers, mapping: {} };
  }
  const m = detectMapping(headers);
  return { items: parseGeneric(records, m), headers, mapping: m };
}
