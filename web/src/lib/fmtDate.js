// 日期 + 周几（如 2026-11-11 周二），弹窗流水行统一用。
// 不把 dayjs 全局 locale 设为 zh-cn（避免影响其他页面的日期格式），周几本地映射。
import dayjs from "dayjs";

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function fmtDateWeek(ts) {
  const d = dayjs(ts);
  if (!d.isValid()) return String(ts || "");
  return `${d.format("YYYY-MM-DD")} ${WEEK[d.day()]}`;
}
