<script setup>
import { ref, onMounted, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { toast } from "../toast.js";
import EChart from "../components/EChart.vue";

// tab: 'month' = 月账单（按年看 12 个月）｜'year' = 年账单（看各年份）
const tab = ref("month");
const year = ref(dayjs().year());
const loading = ref(false);

const monthly = ref({ year: year.value, years: [], summary: { income: 0, expense: 0, balance: 0, count: 0 }, rows: [] });
const yearly = ref({ summary: { income: 0, expense: 0, balance: 0, count: 0 }, rows: [] });

// 年份下拉：有流水的年份 + 当前年（保证总能选到今年）
const yearOptions = computed(() => {
  const s = new Set([...(monthly.value.years || []), dayjs().year()]);
  return [...s].sort((a, b) => b - a);
});

async function loadMonthly() {
  loading.value = true;
  try {
    const { data } = await api.get("/bills/monthly", { params: { year: year.value } });
    monthly.value = data;
  } catch (e) { toast(e.message); } finally { loading.value = false; }
}
async function loadYearly() {
  loading.value = true;
  try {
    const { data } = await api.get("/bills/yearly");
    yearly.value = data;
  } catch (e) { toast(e.message); } finally { loading.value = false; }
}

function switchTab(t) {
  tab.value = t;
  if (t === "month") loadMonthly();
  else loadYearly();
}

onMounted(async () => {
  // 先取月账单（顺带拿到可选年份），年账单切换时再取
  await loadMonthly();
  loadYearly();
});

function fmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 当前 tab 对应的汇总与表格数据
const summary = computed(() => (tab.value === "month" ? monthly.value.summary : yearly.value.summary));
const rows = computed(() => (tab.value === "month" ? monthly.value.rows : yearly.value.rows));
// 月账单只画有数据的月份；年账单画全部年份（按时间正序）
const chartRows = computed(() =>
  tab.value === "month" ? monthly.value.rows : [...yearly.value.rows].reverse()
);

const summaryLabels = computed(() =>
  tab.value === "month"
    ? { balance: `${monthly.value.year} 年结余`, income: `${monthly.value.year} 年收入`, expense: `${monthly.value.year} 年支出` }
    : { balance: "总结余", income: "总收入", expense: "总支出" }
);

// 收支对比 + 结余折线
const chartOpt = computed(() => ({
  tooltip: {
    trigger: "axis",
    formatter: (ps) => {
      const t = ps[0]?.axisValue || "";
      return t + "<br/>" + ps.map((p) => `${p.marker}${p.seriesName} ${fmt(p.data)}`).join("<br/>");
    },
  },
  legend: { data: ["收入", "支出", "结余"], top: 0 },
  grid: { left: 62, right: 20, top: 34, bottom: 28 },
  xAxis: { type: "category", data: chartRows.value.map((r) => r.label) },
  yAxis: { type: "value" },
  series: [
    { name: "收入", type: "bar", data: chartRows.value.map((r) => r.income), itemStyle: { color: "#10b981", borderRadius: [4, 4, 0, 0] } },
    { name: "支出", type: "bar", data: chartRows.value.map((r) => r.expense), itemStyle: { color: "#ef4444", borderRadius: [4, 4, 0, 0] } },
    { name: "结余", type: "line", data: chartRows.value.map((r) => r.balance), smooth: true, itemStyle: { color: "#6366f1" }, lineStyle: { width: 2 } },
  ],
}));

// 表格里的结余条形长度（相对最大绝对值）
const maxAbs = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(r.balance))));
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">账单</h2>
      <div class="row" style="gap:8px;align-items:center">
        <!-- 月账单 / 年账单 互相切换 -->
        <div class="seg">
          <button :class="['seg-btn', { on: tab === 'month' }]" @click="switchTab('month')">月账单</button>
          <button :class="['seg-btn', { on: tab === 'year' }]" @click="switchTab('year')">年账单</button>
        </div>
        <select v-if="tab === 'month'" class="select" style="width:auto" v-model.number="year" @change="loadMonthly">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
        </select>
      </div>
    </div>

    <!-- 汇总三卡 -->
    <div class="grid sum-grid">
      <div class="card sum">
        <div class="muted">{{ summaryLabels.balance }}</div>
        <div class="big" :class="summary.balance >= 0 ? 'income' : 'expense'">{{ fmt(summary.balance) }}</div>
        <div class="muted sub">共 {{ summary.count }} 笔</div>
      </div>
      <div class="card sum">
        <div class="muted">{{ summaryLabels.income }}</div>
        <div class="big income">{{ fmt(summary.income) }}</div>
        <div class="muted sub">收入合计</div>
      </div>
      <div class="card sum">
        <div class="muted">{{ summaryLabels.expense }}</div>
        <div class="big expense">{{ fmt(summary.expense) }}</div>
        <div class="muted sub">支出合计</div>
      </div>
    </div>

    <!-- 收支结余图 -->
    <div class="card" style="margin-top:16px" v-if="chartRows.length">
      <div class="section-title">{{ tab === 'month' ? `${monthly.year} 年每月收支结余` : '各年度收支结余' }}</div>
      <EChart :option="chartOpt" height="320px" />
    </div>

    <!-- 明细表 -->
    <div class="card" style="margin-top:16px">
      <div class="section-title">{{ tab === 'month' ? '月度明细' : '年度明细' }}</div>
      <table class="tbl bill-tbl">
        <thead>
          <tr>
            <th class="c-key">{{ tab === 'month' ? '月份' : '年份' }}</th>
            <th class="num">{{ tab === 'month' ? '月收入' : '年收入' }}</th>
            <th class="num">{{ tab === 'month' ? '月支出' : '年支出' }}</th>
            <th class="num">{{ tab === 'month' ? '月结余' : '年结余' }}</th>
            <th class="c-bar hide-mobile">结余对比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.month || r.year" :class="{ zero: !r.count }">
            <td class="c-key"><b>{{ r.label }}</b><span class="muted cnt" v-if="r.count">{{ r.count }}笔</span></td>
            <td class="num income">{{ r.income ? fmt(r.income) : '—' }}</td>
            <td class="num expense">{{ r.expense ? fmt(r.expense) : '—' }}</td>
            <td class="num"><b :class="r.balance >= 0 ? 'income' : 'expense'">{{ r.count ? fmt(r.balance) : '—' }}</b></td>
            <td class="c-bar hide-mobile">
              <div class="minibar">
                <i :style="{ width: (Math.abs(r.balance) / maxAbs * 100) + '%', background: r.balance >= 0 ? 'var(--income)' : 'var(--expense)' }"></i>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="5" class="muted" style="text-align:center;padding:30px 0">
              {{ loading ? '加载中…' : '还没有流水数据' }}
            </td>
          </tr>
        </tbody>
        <tfoot v-if="rows.length">
          <tr>
            <td class="c-key"><b>合计</b></td>
            <td class="num income"><b>{{ fmt(summary.income) }}</b></td>
            <td class="num expense"><b>{{ fmt(summary.expense) }}</b></td>
            <td class="num"><b :class="summary.balance >= 0 ? 'income' : 'expense'">{{ fmt(summary.balance) }}</b></td>
            <td class="hide-mobile"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.seg { display: inline-flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 3px; }
.seg-btn { border: 0; background: transparent; color: var(--text-2); padding: 7px 16px; font-size: 14px; border-radius: 8px; cursor: pointer; }
.seg-btn.on { background: var(--surface); color: var(--primary); font-weight: 600; box-shadow: var(--shadow); }

.sum-grid { grid-template-columns: repeat(3, 1fr); }
.sum .big { font-size: 24px; font-weight: 800; margin-top: 6px; }
.sum .sub { font-size: 12px; margin-top: 4px; }

.bill-tbl .c-key { width: 130px; white-space: nowrap; }
.bill-tbl .cnt { font-size: 12px; margin-left: 8px; }
.bill-tbl .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.bill-tbl .c-bar { width: 34%; }
.bill-tbl tr.zero td { opacity: .5; }
.bill-tbl tfoot td { border-top: 2px solid var(--border); border-bottom: 0; }
.minibar { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.minibar > i { display: block; height: 100%; border-radius: 999px; }

@media (max-width: 720px) {
  .sum-grid { grid-template-columns: 1fr; }
  .sum .big { font-size: 21px; }
}
</style>
