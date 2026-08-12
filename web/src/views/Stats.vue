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
const payment = ref([]);
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
  const [ov, cat, pay, attr, day] = await Promise.all([
    api.get("/stats/overview", { params }),
    api.get("/stats/category", { params: { ...params, type: "expense" } }),
    api.get("/stats/payment", { params }),
    api.get("/stats/attribution", { params: { ...params, type: "expense" } }),
    api.get("/stats/daily", { params }),
  ]);
  overview.value = ov.data;
  category.value = cat.data;
  payment.value = pay.data;
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
const PIE_DIM = { "支出分类": "category", "支付方式": "payment", "消费归属": "attribution" };
const DIM_LABEL = { category: "分类", payment: "支付方式", attribution: "归属人" };

function pie(title, data) {
  return {
    title: { text: title, left: "center", textStyle: { fontSize: 14 } },
    tooltip: { trigger: "item", formatter: "{b}: ¥{c} ({d}%)" },
    legend: { bottom: 0, type: "scroll" },
    color: PALETTE,
    series: [{
      type: "pie", radius: ["42%", "68%"], center: ["50%", "46%"],
      cursor: "pointer",
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: "transparent", borderWidth: 2 },
      label: { formatter: "{b}\n{d}%", fontSize: 11 },
      data: data.map((d) => ({ name: d.name, value: Number(d.value.toFixed(2)) })),
    }],
  };
}

const dailyOpt = computed(() => ({
  tooltip: { trigger: "axis" },
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
    { name: "支出", type: "bar", data: monthly.value.map((m) => m.expense), itemStyle: { color: "#ef4444", borderRadius: [4,4,0,0] } },
    { name: "收入", type: "bar", data: monthly.value.map((m) => m.income), itemStyle: { color: "#10b981", borderRadius: [4,4,0,0] } },
  ],
}));

function fmt(n) { return "¥" + Number(n||0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ---------------- 饼图点击 → 查看该维度明细 ----------------
const detail = ref({ open: false, title: "", rows: [], total: 0, loading: false });
async function onPieClick(params) {
  const dim = PIE_DIM[params.seriesName];
  if (!dim || !params.name) return;
  openDetail(dim, params.name);
}
async function openDetail(dim, name) {
  detail.value = { open: true, title: `${name}（按${DIM_LABEL[dim]}）`, rows: [], total: 0, loading: true };
  const q = { ...period.value, type: "expense", pageSize: 300 };
  q[dim] = name;
  try {
    const { data } = await api.get("/flows", { params: q });
    detail.value.rows = data.list;
    detail.value.total = data.total;
  } catch (e) {
    toast(e.message);
  } finally {
    detail.value.loading = false;
  }
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
      <div class="card clickable-hint"><EChart :option="pie('支付方式', payment)" v-if="payment.length" @click="onPieClick" /><div v-else class="empty muted">暂无数据</div></div>
      <div class="card clickable-hint"><EChart :option="pie('消费归属', attribution)" v-if="attribution.length" @click="onPieClick" /><div v-else class="empty muted">暂无数据</div></div>
      <div class="card">
        <div class="section-title">每日流水趋势</div>
        <EChart :option="dailyOpt" v-if="daily.length" :height="'260px'" /><div v-else class="empty muted">暂无数据</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">{{ year }} 年每月流水</div>
      <EChart :option="monthlyOpt" :height="'300px'" />
    </div>

    <!-- 饼图项点击后的明细弹窗 -->
    <div v-if="detail.open" class="modal-mask" @click.self="detail.open=false">
      <div class="modal">
        <div class="modal-head">
          <b>{{ detail.title }}</b>
          <span class="muted">共 {{ detail.total }} 笔</span>
          <button class="btn btn-sm" @click="detail.open=false">关闭</button>
        </div>
        <div class="modal-body">
          <div v-if="detail.loading" class="muted" style="padding:24px;text-align:center">加载中…</div>
          <table v-else-if="detail.rows.length" class="tbl">
            <thead><tr><th>时间</th><th>分类</th><th class="hide-mobile">名称</th><th style="text-align:right">金额</th></tr></thead>
            <tbody>
              <tr v-for="f in detail.rows" :key="f.id">
                <td class="muted">{{ dayjs(f.flow_time).format("MM-DD HH:mm") }}</td>
                <td>{{ f.category }}</td>
                <td class="hide-mobile muted ellip">{{ f.description }}</td>
                <td style="text-align:right" :class="f.type"><b>{{ Number(f.amount).toFixed(2) }}</b></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="muted" style="padding:24px;text-align:center">该分类下没有流水</div>
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
.clickable-hint { position: relative; }
.clickable-hint::after { content: "点击查看明细"; position: absolute; top: 8px; right: 12px; font-size: 11px; color: var(--text-2); opacity: .7; pointer-events: none; }
.empty { display: flex; align-items: center; justify-content: center; height: 300px; }
@media (max-width: 720px) { .cards { grid-template-columns: repeat(2,1fr); } .charts { grid-template-columns: 1fr; } }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal { background: var(--surface); color: var(--text); width: min(640px, 100%); max-height: 80vh; border-radius: 14px; display: flex; flex-direction: column; box-shadow: var(--shadow); overflow: hidden; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--surface-2); }
.modal-head .muted { font-size: 13px; }
.modal-head .btn { margin-left: auto; }
.modal-body { padding: 8px 16px 16px; overflow: auto; }
.modal-body .tbl th, .modal-body .tbl td { padding: 7px 8px; font-size: 13px; }
</style>
