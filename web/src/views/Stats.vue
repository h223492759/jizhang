<script setup>
import { ref, onMounted, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";

const range = ref("month"); // month | year | custom
const custom = ref({ start: "", end: "" });
const year = ref(String(dayjs().year()));
const facets = ref({ years: [] });

const overview = ref({ income: 0, expense: 0, balance: 0, count: 0 });
const category = ref([]);
const payment = ref([]);
const attribution = ref([]);
const daily = ref([]);
const monthly = ref([]);

const period = computed(() => {
  if (range.value === "month") {
    return { start: dayjs().startOf("month").format("YYYY-MM-DD"), end: dayjs().endOf("month").format("YYYY-MM-DD") };
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
onMounted(async () => {
  const { data } = await api.get("/stats/facets");
  facets.value = data;
  if (data.years.length && !data.years.includes(year.value)) year.value = data.years[0];
  load();
});

const PALETTE = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#64748b"];

function pie(title, data) {
  return {
    title: { text: title, left: "center", textStyle: { fontSize: 14 } },
    tooltip: { trigger: "item", formatter: "{b}: ¥{c} ({d}%)" },
    legend: { bottom: 0, type: "scroll" },
    color: PALETTE,
    series: [{
      type: "pie", radius: ["42%", "68%"], center: ["50%", "46%"],
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
</script>

<template>
  <div>
    <h2 class="page-title">统计分析</h2>

    <!-- 时间范围 -->
    <div class="card range">
      <div class="seg">
        <button :class="{on:range==='month'}" @click="range='month';load()">本月</button>
        <button :class="{on:range==='year'}" @click="range='year';load()">本年</button>
        <button :class="{on:range==='custom'}" @click="range='custom'">自定义</button>
      </div>
      <select v-if="range==='year'" class="select" style="width:auto" v-model="year" @change="load">
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
      <div class="card"><EChart :option="pie('支出分类', category)" v-if="category.length" /><div v-else class="empty muted">暂无支出数据</div></div>
      <div class="card"><EChart :option="pie('支付方式', payment)" v-if="payment.length" /><div v-else class="empty muted">暂无数据</div></div>
      <div class="card"><EChart :option="pie('消费归属', attribution)" v-if="attribution.length" /><div v-else class="empty muted">暂无数据</div></div>
      <div class="card">
        <div class="section-title">每日流水趋势</div>
        <EChart :option="dailyOpt" v-if="daily.length" :height="'260px'" /><div v-else class="empty muted">暂无数据</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">{{ year }} 年每月流水</div>
      <EChart :option="monthlyOpt" :height="'300px'" />
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
.empty { display: flex; align-items: center; justify-content: center; height: 300px; }
@media (max-width: 720px) { .cards { grid-template-columns: repeat(2,1fr); } .charts { grid-template-columns: 1fr; } }
</style>
