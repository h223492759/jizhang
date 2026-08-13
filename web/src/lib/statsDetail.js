import dayjs from "dayjs";

// 饼图标题 → 维度（点击时据此查询明细）
export const PIE_DIM = { "支出分类": "category", "消费归属": "attribution" };
export const DIM_LABEL = { category: "分类", payment: "支付方式", attribution: "归属人" };

// 饼图点击：seriesName 即饼图标题（如「支出分类」），据此定位维度。
// 注：series 必须设置 name 才会带出 seriesName，否则点击无反应。
export function resolvePieDetail(params, period) {
  const dim = PIE_DIM[params.seriesName];
  if (!dim || !params.name) return null;
  return {
    dim,
    name: params.name,
    title: `${params.name}（按${DIM_LABEL[dim]}）`,
    query: { ...period, type: "expense", [dim]: params.name, pageSize: 300 },
  };
}

// 柱状图点击：根据月份索引 + 收/支 返回明细查询参数
export function resolveBarDetail(params, monthly) {
  const m = monthly[params.dataIndex];
  if (!m) return null;
  const type = params.seriesName === "收入" ? "income" : "expense";
  const start = `${m.month}-01`;
  const end = dayjs(start).endOf("month").format("YYYY-MM-DD");
  return {
    type,
    title: `${m.month} ${type === "income" ? "收入" : "支出"}`,
    query: { start, end, type, pageSize: 300 },
  };
}
