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
    ? { balance: "年结余", income: "年收入", expense: "年支出" }
    : { balance: "总结余", income: "总收入", expense: "总支出" }
);

// 月份数字（去掉「月」字），年份只显示数字
const monthNum = (r) => Number(String(r.month || "0").slice(5));
const rowLabel = (r) => (tab.value === "month" ? monthNum(r) : r.year);

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
  xAxis: { type: "category", data: chartRows.value.map((r) => rowLabel(r)) },
  yAxis: { type: "value" },
  series: [
    { name: "收入", type: "bar", data: chartRows.value.map((r) => r.income), itemStyle: { color: "#10b981", borderRadius: [4, 4, 0, 0] } },
    { name: "支出", type: "bar", data: chartRows.value.map((r) => r.expense), itemStyle: { color: "#ef4444", borderRadius: [4, 4, 0, 0] } },
    { name: "结余", type: "line", data: chartRows.value.map((r) => r.balance), smooth: true, itemStyle: { color: "#6366f1" }, lineStyle: { width: 2 } },
  ],
}));

// ---------------- 月/年总结分析弹窗（区域 1~7） ----------------
const showMonth = ref(false);
const monthDetail = ref(null);
const monthLoading = ref(false);
const showAllExp = ref(false);
const detailIsYear = ref(false);
async function openMonth(ym) {
  if (!ym) return;
  monthLoading.value = true;
  showMonth.value = true;
  detailIsYear.value = false;
  try {
    const { data } = await api.get("/bills/month-detail", { params: { ym } });
    monthDetail.value = data;
    showAllExp.value = false;
  } catch (e) {
    toast(e.message);
  } finally {
    monthLoading.value = false;
  }
}
function onChartClick(p) {
  const row = chartRows.value[p.dataIndex];
  if (!row) return;
  if (tab.value === "month") {
    if (row.month) openMonth(row.month);
  } else {
    if (row.year) openYear(row.year);
  }
}
async function openYear(y) {
  if (!y) return;
  monthLoading.value = true;
  showMonth.value = true;
  detailIsYear.value = true;
  try {
    const { data } = await api.get("/bills/year-detail", { params: { year: y } });
    monthDetail.value = data;
    showAllExp.value = false;
  } catch (e) {
    toast(e.message);
  } finally {
    monthLoading.value = false;
  }
}
function mdFmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const md = computed(() => monthDetail.value || {});
// 区域 2：上月结余 / 月收入 / 月支出 / 月结余（年视图为 上年结余/年收入/年支出/年结余）横向柱状
const balBarOpt = computed(() => {
  const d = md.value;
  if (!d.thisMonth) return null;
  const order = detailIsYear.value
    ? ["上年结余", "年收入", "年支出", "年结余"]
    : ["上月结余", "月收入", "月支出", "月结余"];
  const vals = [d.lastMonthBalance, d.thisMonth.income, d.thisMonth.expense, d.thisMonth.balance];
  const colors = ["#868e96", "#10b981", "#ef4444", "#6366f1"];
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `${ps[0].name} ${mdFmt(ps[0].value)}` },
    grid: { left: 76, right: 60, top: 10, bottom: 14 },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: order },
    series: [{ type: "bar", data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: "right", formatter: (p) => mdFmt(p.value), fontSize: 11 } }],
  };
});
// 区域 3：支出分类饼图
const pieOpt = computed(() => {
  const cats = md.value.expenseByCategory || [];
  if (!cats.length) return null;
  return {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>${mdFmt(p.value)}（${p.percent}%）` },
    legend: { type: "scroll", bottom: 0 },
    series: [{ type: "pie", radius: ["42%", "70%"], avoidLabelOverlap: true, itemStyle: { borderRadius: 6, borderWidth: 0 }, label: { show: true, formatter: "{b}\n{c}" }, data: cats.map((c) => ({ name: c.category, value: c.amount })) }],
  };
});
// 区域 5 / 7：对比柱状（高亮选中月）
const compareBar = (key, curYm, incColor, dimColor) => {
  const arr = md.value[key] || [];
  if (!arr.length) return null;
  return {
    tooltip: { trigger: "axis", formatter: (ps) => `${ps[0].axisValue}<br/>${mdFmt(ps[0].value)}` },
    grid: { left: 64, right: 20, top: 12, bottom: 22 },
    xAxis: { type: "category", data: arr.map((a) => a.label) },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: arr.map((a) => ({ value: a[key === "expenseCompare" ? "expense" : "income"], itemStyle: { color: a.ym === curYm ? incColor : dimColor, borderRadius: [4, 4, 0, 0] } })) }],
  };
};
const expenseCompareOpt = computed(() => compareBar("expenseCompare", md.value.ym, "#ef4444", "#f3a3a3"));
const incomeCompareOpt = computed(() => compareBar("incomeCompare", md.value.ym, "#10b981", "#9ad9b8"));

// 变化项着色：支出增=红(坏) 减=绿(好)；收入增=绿(好) 减=红(坏)
const changeColor = (dir, isExpense) => (isExpense ? (dir === "up" ? "expense" : "income") : (dir === "up" ? "income" : "expense"));
const arrow = (dir) => (dir === "up" ? "▲" : "▼");
const expChanges = computed(() => md.value.expenseChangeVsPrev || []);
const incChanges = computed(() => md.value.incomeChangeVsPrev || []);


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
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
    </div>

    <!-- 汇总三卡 -->
    <div class="grid sum-grid">
      <div class="card sum">
        <div class="muted">{{ summaryLabels.balance }}</div>
        <div class="big" :class="summary.balance >= 0 ? 'income' : 'expense'">{{ fmt(summary.balance) }}</div>
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

    <!-- 收支结余图（月账单可点击查看当月总结分析） -->
    <div class="card" style="margin-top:16px" v-if="chartRows.length">
      <div class="section-title">
        {{ tab === 'month' ? '每月收支结余' : '各年度收支结余' }}
        <span class="muted small" v-if="tab === 'month'">（点击柱状图或下方明细可看当月分析）</span>
      </div>
      <div class="chart-click">
        <EChart :option="chartOpt" height="320px" @click="onChartClick" />
      </div>
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
          <tr v-for="r in rows" :key="r.month || r.year" :class="{ zero: !r.count, clickable: true }" @click="tab === 'month' ? openMonth(r.month) : openYear(r.year)">
            <td class="c-key"><b>{{ rowLabel(r) }}</b></td>
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

    <!-- 月总结分析弹窗（区域 1~7） -->
    <div v-if="showMonth" class="modal-mask" @click.self="showMonth = false">
      <div class="modal month-modal" style="max-width:1100px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">{{ md.year }} 年<template v-if="!detailIsYear"> {{ md.month }} 月</template> · {{ detailIsYear ? '年度' : '账单' }}总结分析</h3>
          <button class="btn" @click="showMonth = false">关闭</button>
        </div>
        <div v-if="monthLoading" class="muted" style="padding:30px 0;text-align:center">加载中…</div>
        <div v-else-if="md.ym" class="md-body">
          <!-- ① -->
          <div class="region">
            <div class="region-t">① 这是 {{ md.year }} 年<template v-if="!detailIsYear"> {{ md.month }} 月</template>账单</div>
            <div class="muted">这是你开始记账的第 <b>{{ md.startDayCount }}</b> 天（自 {{ md.firstFlow }} 起）</div>
          </div>
          <!-- ② -->
          <div class="region">
            <div class="region-t">② 本月结余 / 上月结余 / 收支</div>
            <div class="kv"><span>本月结余</span><b :class="md.thisMonth.balance >= 0 ? 'income' : 'expense'">{{ mdFmt(md.thisMonth.balance) }}</b></div>
            <div class="kv"><span>上月结余</span><b>{{ mdFmt(md.lastMonthBalance) }}</b></div>
            <div class="kv"><span>月收入</span><b class="income">{{ mdFmt(md.thisMonth.income) }}</b></div>
            <div class="kv"><span>月支出</span><b class="expense">{{ mdFmt(md.thisMonth.expense) }}</b></div>
            <EChart v-if="balBarOpt" :option="balBarOpt" height="170px" />
          </div>
          <!-- ③ -->
          <div class="region">
            <div class="region-t">③ 支出类别分布</div>
            <EChart v-if="pieOpt" :option="pieOpt" height="280px" />
            <div v-else class="muted">本月无支出</div>
            <div class="region-t sub">最高支出（{{ showAllExp ? '全部' : '前 3' }}）</div>
            <table class="tbl mini">
              <thead><tr><th>日期</th><th>分类</th><th class="num">金额</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="e in (showAllExp ? md.topExpenses : md.topExpenses.slice(0, 3))" :key="e.id">
                  <td class="muted">{{ (e.flow_time || '').slice(0, 10) }}</td>
                  <td>{{ e.category }}</td>
                  <td class="num expense">{{ mdFmt(e.amount) }}</td>
                  <td class="muted">{{ e.description || e.category }}</td>
                </tr>
              </tbody>
            </table>
            <button class="btn btn-sm" v-if="md.topExpenses.length > 3" @click="showAllExp = !showAllExp">{{ showAllExp ? '收起' : '查看更多' }}</button>
          </div>
          <!-- ④ -->
          <div class="region">
            <div class="region-t">④ 支出趋势</div>
            <div class="kv"><span>{{ detailIsYear ? '单月最高支出' : '单日最高支出' }}</span><b class="expense">{{ mdFmt(md.highestDayExpense.amount) }}</b><span class="muted">（{{ md.highestDayExpense.date }}）</span></div>
            <div class="kv"><span>{{ detailIsYear ? '月均支出' : '日均支出' }}</span><b class="expense">{{ mdFmt(md.dailyAvgExpense) }}</b></div>
            <div class="kv"><span>{{ detailIsYear ? '年支出' : '本月支出' }}</span><b class="expense">{{ mdFmt(md.thisMonth.expense) }}</b></div>
          </div>
          <!-- ⑤ -->
          <div class="region">
            <div class="region-t">{{ detailIsYear ? '⑤ 各月支出对比' : '⑤ 月支出对比' }}</div>
            <EChart v-if="expenseCompareOpt" :option="expenseCompareOpt" height="200px" />
            <div class="region-t sub">对比上月 · 支出变化 Top3</div>
            <div v-if="expChanges.length" class="changes">
              <div v-for="c in expChanges" :key="c.category" class="change" :class="changeColor(c.dir, true)">
                <span class="c-name">{{ c.category }}</span>
                <span class="arrow">{{ arrow(c.dir) }}</span>
                <span class="c-amt">{{ mdFmt(Math.abs(c.delta)) }}</span>
                <span class="muted small">（上月 {{ mdFmt(c.prev) }} → 本月 {{ mdFmt(c.cur) }}）</span>
              </div>
            </div>
            <div v-else class="muted small">与上月无显著变化</div>
          </div>
          <!-- ⑥ -->
          <div class="region">
            <div class="region-t">⑥ 月收入</div>
            <div class="kv"><span>本月收入</span><b class="income">{{ mdFmt(md.monthIncome) }}</b></div>
            <table class="tbl mini">
              <thead><tr><th>日期</th><th>分类</th><th class="num">金额</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="e in md.topIncomes" :key="e.id">
                  <td class="muted">{{ (e.flow_time || '').slice(0, 10) }}</td>
                  <td>{{ e.category }}</td>
                  <td class="num income">{{ mdFmt(e.amount) }}</td>
                  <td class="muted">{{ e.description || e.category }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- ⑦ -->
          <div class="region">
            <div class="region-t">{{ detailIsYear ? '⑦ 各月收入对比' : '⑦ 月收入对比' }}</div>
            <EChart v-if="incomeCompareOpt" :option="incomeCompareOpt" height="200px" />
            <div class="region-t sub">对比上月 · 收入变化 Top3</div>
            <div v-if="incChanges.length" class="changes">
              <div v-for="c in incChanges" :key="c.category" class="change" :class="changeColor(c.dir, false)">
                <span class="c-name">{{ c.category }}</span>
                <span class="arrow">{{ arrow(c.dir) }}</span>
                <span class="c-amt">{{ mdFmt(Math.abs(c.delta)) }}</span>
                <span class="muted small">（上月 {{ mdFmt(c.prev) }} → 本月 {{ mdFmt(c.cur) }}）</span>
              </div>
            </div>
            <div v-else class="muted small">与上月无显著变化</div>
          </div>
        </div>
      </div>
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

.chart-click { cursor: pointer; }
.bill-tbl tr.clickable { cursor: pointer; }
.bill-tbl tr.clickable:hover { background: var(--surface-2); }
.month-modal { max-height: 88vh; overflow: auto; }
.region { padding: 12px 0; border-bottom: 1px dashed var(--border); }
.region:last-child { border-bottom: 0; }
.region-t { font-weight: 700; margin-bottom: 8px; }
.region-t.sub { font-weight: 600; font-size: 13px; margin-top: 12px; color: var(--text-2); }
.kv { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
.kv > span:first-child { width: 84px; color: var(--text-2); font-size: 13px; }
.kv > b { font-size: 16px; }
.mini { font-size: 13px; margin-top: 6px; }
.mini th, .mini td { padding: 6px 8px; }
.changes { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.change { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; border-radius: 8px; background: var(--surface-2); }
.change .c-name { font-weight: 600; }
.change .arrow { font-size: 12px; }
.change .c-amt { font-weight: 700; font-variant-numeric: tabular-nums; }
.change.income { color: var(--income); }
.change.expense { color: var(--expense); }

@media (max-width: 720px) {
  .sum-grid { grid-template-columns: 1fr; }
  .sum .big { font-size: 21px; }
}
</style>
