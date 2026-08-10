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
    ["交易时间", "交易类型", "收/支", "金额", "商品"].reduce(
      (n, k) => n + (s.includes(k) ? 1 : 0),
      0
    );
  return score(gbk) >= score(utf8) ? gbk : utf8;
}

// 找到表头所在行号（包含“交易时间”的那一行）
function locateHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("交易时间")) return i;
  }
  return -1;
}

function toRecords(text) {
  const lines = text.split(/\r?\n/);
  const h = locateHeader(lines);
  if (h < 0) return [];
  const body = lines.slice(h).join("\n");
  return parse(body, {
    columns: (header) => header.map((x) => x.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

function num(s) {
  if (!s) return 0;
  return Math.abs(Number(String(s).replace(/[¥￥,\s]/g, ""))) || 0;
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
      flow_time: fmtTime(rec["交易时间"]),
    });
  }
  return out;
}

// source: alipay | wechat | auto
export function parseBill(buf, source = "auto") {
  const text = decode(buf);
  const records = toRecords(text);
  if (!records.length) return [];
  let type = source;
  if (source === "auto") {
    type = text.includes("微信支付账单") || text.includes("当前状态")
      ? "wechat"
      : "alipay";
  }
  return type === "wechat" ? parseWechat(records) : parseAlipay(records);
}
