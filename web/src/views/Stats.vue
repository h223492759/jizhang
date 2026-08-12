<script setup>
import { ref, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { toast } from "../toast.js";

const range = ref("month"); // month | year | custom
const custom = ref({ start: "", end: "" });
const year = ref(String(dayjs().year()));
const selMonth = ref(dayjs().format("YYYY-MM"));
const facets = ref({ years: [], months: [] });

const overview = ref({ income: 0, expense: 0, balance: 0, count: 0 });
const category = ref([]);
const attribution = ref([]);
const daily = ref([]);
const monthly = ref([]);

// 历史月份快捷选项：当前月 + 有数据的所有月份，倒序
const monthOptions = computed(() => {
  const cur = dayjs().format("YYYY-MM");
  const set = new Set([cur, ...(facets.value.months || [])]);
  return [...set].sort().reverse();
});
const monthLabel = (m) => `${m.slice(0, 4)}年${m.slice(5)}月`;

const period = computed(() => {
  if (range.value === "month") {
    const m = selMonth.value;
    return { start: `${m}-01`, end: dayjs(`${m}-01`).endOf("month").format("YYYY-MM-DD") };
  }
  if (range.value === "year") {
    return { start: `${year.value}-01-01`, end: `${year.value}-12-31` };
  }
  return { start: custom.value.start, end: custom.value.end };
});

async function load() {
  const params = period.value;
  const [ov, cat, attr, day] = await Promise.all([
    api.get("/stats/overview", { params }),
    api.get("/stats/category", { params: { ...params, type: "expense" } }),
    api.get("/stats/attribution", { params: { ...params, type: "expense" } }),
    api.get("/stats/daily", { params }),
  ]);
  overview.value = ov.data;
  category.value = cat.data;
  attribution.value = attr.data;
  daily.value = day.data;
  const { data: mon } = await api.get("/stats/monthly", { params: { year: year.value } });
  monthly.value = mon;
}
// 切换年份时重新拉月度柱状图
function onYearChange() { load(); }

async function init() {
  const { data } = await api.get("/stats/facets");
  facets.value = data;
  if (data.months?.length && !data.months.includes(selMonth.value)) selMonth.value = data.months[0];
  if (data.years.length && !data.years.includes(year.value)) year.value = data.years[0];
  await load();
}
init();

const PALETTE = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#64748b"];

// 饼图标题 → 维度（点击时据此查询明细）
const PIE_DIM = { "支出分类": "category", "消费归属": "attribution" };
const DIM_LABEL = { category: "分类", payment: "支付方式", attribution: "归属人" };

function pie(title, data) {
  return {
    title: { text: title, left: "center", textStyle: { fontSize: 14 } },
    tooltip: { trigger: "item", formatter: "{b}: ¥{c} ({d}%)" },
    // 注释完整显示，不折叠为滚动
    legend: { bottom: 2, type: "plain", width: "92%", itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    color: PALETTE,
    series: [{
      type: "pie", radius: ["36%", "62%"], center: ["50%", "42%"],
      cursor: "pointer",
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "transparent", borderWidth: 2 },
      label: { formatter: "{b}\n{d}%", fontSize: 11 },
      data: data.map((d) => ({ name: d.name, value: Number(d.value.toFixed(2)) })),
    }],
  };
}

const dailyOpt = computed(() => ({
  tooltip: {
    trigger: "axis",
    formatter(params) {
      const label = params[0]?.axisValue; // "MM-DD"
      const day = daily.value.find((d) => d.date.slice(5) === label);
      if (!day) return "";
      const lines = [];
      lines.push(`<b>${day.date}</b>`);
      lines.push(`支出合计：¥${Number(day.expense).toFixed(2)}`);
      lines.push(`收入合计：¥${Number(day.income).toFixed(2)}`);
      const exp = day.top?.expense || [];
      const inc = day.top?.income || [];
      if (exp.length) {
        lines.push(`<br/>支出 Top${exp.length}：`);
        exp.forEach((t) => lines.push(`　${t.category || "未分类"}${t.description ? "·" + t.description : ""} ¥${Number(t.amount).toFixed(2)}`));
      }
      if (inc.length) {
        lines.push(`<br/>收入 Top${inc.length}：`);
        inc.forEach((t) => lines.push(`　${t.category || "未分类"}${t.description ? "·" + t.description : ""} ¥${Number(t.amount).toFixed(2)}`));
      }
      if (!exp.length && !inc.length) lines.push(`<br/>当日无明细`);
      return lines.join("<br/>");
    },
  },
  legend: { data: ["支出", "收入"], top: 0 },
  grid: { left: 45, right: 15, top: 35, bottom: 30 },
  xAxis: { type: "category", data: daily.value.map((d) => d.date.slice(5)) },
  yAxis: { type: "value" },
  series: [
    { name: "支出", type: "line", smooth: true, data: daily.value.map((d) => d.expense), itemStyle: { color: "#ef4444" }, areaStyle: { opacity: 0.12 } },
    { name: "收入", type: "line", smooth: true, data: daily.value.map((d) => d.income), itemStyle: { color: "#10b981" }, areaStyle: { opacity: 0.12 } },
  ],
}));

const monthlyOpt = computed(() => ({
  tooltip: { trigger: "axis" },
  legend: { data: ["支出", "收入"], top: 0 },
  grid: { left: 45, right: 15, top: 35, bottom: 30 },
  xAxis: { type: "category", data: monthly.value.map((m) => m.month.slice(5) + "月") },
  yAxis: { type: "value" },
  series: [
    { name: "支出", type: "bar", cursor: "pointer", data: monthly.value.map((m) => m.expense), itemStyle: { color: "#ef4444", borderRadius: [4,4,0,0] } },
    { name: "收入", type: "bar", cursor: "pointer", data: monthly.value.map((m) => m.income), itemStyle: { color: "#10b981", borderRadius: [4,4,0,0] } },
  ],
}));

function fmt(n) { return "¥" + Number(n||0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ---------------- 图表点击 → 查看明细 ----------------
const detail = ref({ open: false, title: "", rows: [], total: 0, loading: false });
const sortField = ref("amount"); // amount | time
const sortOrder = ref("desc");   // desc | asc

// 饼图：按维度（分类/归属人）查看明细
async function onPieClick(params) {
  const dim = PIE_DIM[params.seriesName];
  if (!dim || !params.name) return;
  await openDetail(`${params.name}（按${DIM_LABEL[dim]}）`, { ...period.value, type: "expense", [dim]: params.name, pageSize: 300 });
}
// 柱状图：按某月 + 收/支 查看明细
async function onBarClick(params) {
  const m = monthly.value[params.dataIndex];
  if (!m) return;
  const type = params.seriesName === "收入" ? "income" : "expense";
  const start = `${m.month}-01`;
  const end = dayjs(start).endOf("month").format("YYYY-MM-DD");
  await openDetail(`${m.month} ${type === "income" ? "收入" : "支出"}`, { start, end, type, pageSize: 300 });
}

async function openDetail(title, query) {
  detail.value = { open: true, title, rows: [], total: 0, loading: true };
  sortField.value = "amount";
  sortOrder.value = "desc";
  try {
    const { data } = await api.get("/flows", { params: query });
    detail.value.rows = data.list;
    detail.value.total = data.total;
  } catch (e) {
    toast(e.message);
  } finally {
    detail.value.loading = false;
  }
}

// 明细排序：默认金额降序；可切时间；时间顺序/逆序可切换
const detailSum = computed(() => detail.value.rows.reduce((s, f) => s + Number(f.amount || 0), 0));
const sortedRows = computed(() => {
  const rows = [...detail.value.rows];
  const dir = sortOrder.value === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    if (sortField.value === "amount") return (Number(b.amount) - Number(a.amount)) * dir;
    return (new Date(a.flow_time).getTime() - new Date(b.flow_time).getTime()) * dir;
  });
  return rows;
});
function pct(f) {
  if (!detailSum.value) return "0%";
  return ((Number(f.amount) / detailSum.value) * 100).toFixed(1) + "%";
}
</script>

<template>
  <div>
    <h2 class="page-title">统计分析</h2>

    <!-- 时间范围 -->
    <div class="card range">
      <div class="seg">
        <button :class="{on:range==='month'}" @click="range='month';load()">指定月份</button>
        <button :class="{on:range==='year'}" @click="range='year';load()">本年</button>
        <button :class="{on:range==='custom'}" @click="range='custom'">自定义</button>
      </div>
      <select v-if="range==='month'" class="select" style="width:auto" v-model="selMonth" @change="load">
        <option v-for="m in monthOptions" :key="m" :value="m">{{ monthLabel(m) }}</option>
      </select>
      <select v-if="range==='year'" class="select" style="width:auto" v-model="year" @change="onYearChange">
        <option v-for="y in (facets.years.length?facets.years:[year])" :key="y" :value="y">{{ y }}年</option>
      </select>
      <template v-if="range==='custom'">
        <input class="input" style="width:150px" type="date" v-model="custom.start" />
        <span class="muted">至</span>
        <input class="input" style="width:150px" type="date" v-model="custom.end" />
        <button class="btn btn-sm btn-primary" @click="load">查询</button>
      </template>
    </div>

    <!-- 概览 -->
    <div class="grid cards">
      <div class="card stat"><div class="muted">支出</div><div class="big expense">{{ fmt(overview.expense) }}</div></div>
      <div class="card stat"><div class="muted">收入</div><div class="big income">{{ fmt(overview.income) }}</div></div>
      <div class="card stat"><div class="muted">结余</div><div class="big" :class="overview.balance>=0?'income':'expense'">{{ fmt(overview.balance) }}</div></div>
      <div class="card stat"><div class="muted">笔数</div><div class="big">{{ overview.count }}</div></div>
    </div>

    <div class="grid charts">
      <div class="card clickable-hint"><EChart :option="pie('支出分类', category)" v-if="category.length" @click="onPieClick" /><div v-else class="empty muted">暂无支出数据</div></div>
      <div class="card clickable-hint"><EChart :option="pie('消费归属', attribution)" v-if="attribution.length" @click="onPieClick" /><div v-else class="empty muted">暂无数据</div></div>
      <div class="card daily-card">
        <div class="section-title">每日流水趋势（悬浮查看当日明细）</div>
        <EChart :option="dailyOpt" v-if="daily.length" :height="'260px'" /><div v-else class="empty muted">暂无数据</div>
      </div>
    </div>

    <div class="card clickable-hint" style="margin-top:16px">
      <div class="section-title">{{ year }} 年每月流水</div>
      <EChart :option="monthlyOpt" :height="'300px'" @click="onBarClick" />
    </div>

    <!-- 饼图 / 柱形点击后的明细弹窗 -->
    <div v-if="detail.open" class="modal-mask" @click.self="detail.open=false">
      <div class="modal">
        <div class="modal-head">
          <b>{{ detail.title }}</b>
          <span class="muted">共 {{ detail.total }} 笔 · 合计 {{ fmt(detailSum) }}</span>
          <div class="seg sm">
            <button :class="{on:sortField==='amount'}" @click="sortField='amount'">按金额</button>
            <button :class="{on:sortField==='time'}" @click="sortField='time'">按时间</button>
            <button @click="sortOrder = sortOrder==='desc'?'asc':'desc'">{{ sortOrder==='desc'?'↓ 降序':'↑ 升序' }}</button>
          </div>
          <button class="btn btn-sm" @click="detail.open=false">关闭</button>
        </div>
        <div class="modal-body">
          <div v-if="detail.loading" class="muted" style="padding:24px;text-align:center">加载中…</div>
          <table v-else-if="sortedRows.length" class="tbl">
            <thead><tr><th>日期</th><th>分类</th><th class="hide-mobile">名称</th><th style="text-align:right">金额</th><th style="text-align:right">占比</th></tr></thead>
            <tbody>
              <tr v-for="f in sortedRows" :key="f.id">
                <td class="muted">{{ dayjs(f.flow_time).format("MM-DD") }}</td>
                <td>{{ f.category }}</td>
                <td class="hide-mobile muted ellip">{{ f.description }}</td>
                <td style="text-align:right" :class="f.type"><b>{{ Number(f.amount).toFixed(2) }}</b></td>
                <td style="text-align:right" class="muted">{{ pct(f) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="muted" style="padding:24px;text-align:center">没有匹配的流水</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import EChart from "../components/EChart.vue";
export default { components: { EChart } };
</script>

<style scoped>
.range { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: 10px; padding: 4px; }
.seg button { border: none; background: transparent; padding: 7px 16px; border-radius: 7px; cursor: pointer; color: var(--text-2); }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.cards { grid-template-columns: repeat(4,1fr); margin-bottom: 16px; }
.stat .big { font-size: 20px; font-weight: 800; margin-top: 6px; }
.charts { grid-template-columns: repeat(2, 1fr); }
.daily-card { grid-column: span 2; }
.clickable-hint { position: relative; }
.clickable-hint::after { content: "点击查看明细"; position: absolute; top: 8px; right: 12px; font-size: 11px; color: var(--text-2); opacity: .7; pointer-events: none; }
.empty { display: flex; align-items: center; justify-content: center; height: 300px; }
@media (max-width: 720px) { .cards { grid-template-columns: repeat(2,1fr); } .charts { grid-template-columns: 1fr; } .daily-card { grid-column: span 1; } }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal { background: var(--surface); color: var(--text); width: min(640px, 100%); max-height: 80vh; border-radius: 14px; display: flex; flex-direction: column; box-shadow: var(--shadow); overflow: hidden; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--surface-2); flex-wrap: wrap; }
.modal-head .muted { font-size: 13px; }
.seg.sm { padding: 2px; }
.seg.sm button { padding: 4px 10px; font-size: 12px; border-radius: 6px; }
.modal-head .btn { margin-left: auto; }
.modal-body { padding: 8px 16px 16px; overflow: auto; }
.modal-body .tbl th, .modal-body .tbl td { padding: 7px 8px; font-size: 13px; }
</style>
