<script setup>
import { ref, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import { resolvePieDetail, resolveBarDetail } from "../lib/statsDetail.js";
import DateInput from "../components/DateInput.vue";
import PeriodSwitcher from "../components/PeriodSwitcher.vue";

const store = useStore();

// 类型（支出/收入）与范围（月/年/自定义）：对齐安卓图表页「月/年 + 支出/收入」快速切换
const type = ref("expense"); // expense | income
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

// 每月流水柱状图的年份：月模式跟随 selMonth 的年份；年/自定义模式用 year
const barYear = computed(() =>
  range.value === 'month' ? (selMonth.value || '').slice(0, 4) : year.value
);

async function load() {
  const params = period.value;
  const [ov, cat, attr, day] = await Promise.all([
    api.get("/stats/overview", { params }),
    // 分类/归属饼图跟随 支出/收入 切换（安卓图表同样只显示当前类型）
    api.get("/stats/category", { params: { ...params, type: type.value } }),
    api.get("/stats/attribution", { params: { ...params, type: type.value } }),
    api.get("/stats/daily", { params }),
  ]);
  overview.value = ov.data;
  category.value = cat.data;
  attribution.value = attr.data;
  daily.value = day.data;
  const { data: mon } = await api.get("/stats/monthly", { params: { year: barYear.value } });
  monthly.value = mon;
}

async function init() {
  const { data } = await api.get("/stats/facets");
  facets.value = data;
  if (data.months?.length && !data.months.includes(selMonth.value)) selMonth.value = data.months[0];
  if (data.years.length && !data.years.includes(year.value)) year.value = data.years[0];
  await load();
}
init();

const PALETTE = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#64748b"];

// 饼图标题随 支出/收入 切换（数据源也已切换）
const catTitle = computed(() => (type.value === "income" ? "收入分类" : "支出分类"));
const attrTitle = computed(() => (type.value === "income" ? "收入归属" : "消费归属"));

// 饼图标题即 series.name，点击时 params.seriesName 才能命中维度映射
// colorMap：可选 { 名称: 颜色 }，用于按用户颜色给归属饼图上色
function pie(title, data, colorMap) {
  return {
    title: { text: title, left: "center", top: 0, textStyle: { fontSize: 14 } },
    tooltip: { trigger: "item", formatter: "{b}: ¥{c} ({d}%)" },
    // legend 放上方（用户要求），全部显示不分页；分类多时自然换行多行
    legend: { top: 24, type: "plain", width: "96%", itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    color: PALETTE,
    series: [{
      name: title,
      type: "pie",
      // 饼图水平方向尽量拉长、垂直方向收紧，label 横向更紧凑
      radius: ["18%", "46%"],
      center: ["50%", "56%"],
      cursor: "pointer",
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 4, borderColor: "transparent", borderWidth: 1 },
      // label 名称 + 百分比放一行（紧凑），引线再缩短
      label: { formatter: "{b} {d}%", fontSize: 10.5, edgeDistance: 2 },
      labelLine: { length: 4, length2: 6 },
      data: data.map((d) => ({
        name: d.name,
        value: Number(d.value.toFixed(2)),
        itemStyle: colorMap && colorMap[d.name] ? { color: colorMap[d.name] } : undefined,
      })),
    }],
  };
}

// 归属饼图按「用户颜色」着色
const attrColorMap = computed(() => {
  const m = {};
  for (const a of attribution.value) if (a.color) m[a.name] = a.color;
  return m;
});

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

function catIcon(name) {
  return store.categories.find((c) => c.name === name)?.icon || "💰";
}

// ---------------- 图表点击 → 明细弹窗（弹窗内可快速切换 支出/收入 + 月/年） ----------------
const detail = ref({ open: false, rows: [], total: 0, loading: false, dim: "", name: "" });
const detailType = ref("expense");
const detailRange = ref("month"); // month | year
const detailMonth = ref(dayjs().format("YYYY-MM"));
const detailYear = ref(String(dayjs().year()));
const sortField = ref("amount"); // amount | time
const sortOrder = ref("desc");   // desc | asc

// 图表重渲染 key：切换时间段/类型时强制重建（否则 ECharts 会卡在旧选中状态）
const chartKey = computed(() => `${period.value.start}|${period.value.end}|${type.value}`);
const pieChart = ref(null);
const attrChart = ref(null);
function clearPieLegend() { pieChart.value?.deselectAll(); }
function clearAttrLegend() { attrChart.value?.deselectAll(); }

// 饼图：按维度（分类/归属人）查看明细
async function onPieClick(params) {
  const r = resolvePieDetail(params, period.value, type.value);
  if (!r) return;
  await openDetail(r.query, r.dim, r.name);
}
// 柱状图：按某月 + 收/支 查看明细
async function onBarClick(params) {
  const r = resolveBarDetail(params, monthly.value);
  if (!r) return;
  await openDetail(r.query, "", "");
}

// 弹窗内查询周期（月/年快速切换用）
const detailPeriod = computed(() => {
  if (detailRange.value === "year") {
    return { start: `${detailYear.value}-01-01`, end: `${detailYear.value}-12-31` };
  }
  const m = detailMonth.value;
  return { start: `${m}-01`, end: dayjs(`${m}-01`).endOf("month").format("YYYY-MM-DD") };
});

// 弹窗标题动态生成：维度 · 周期 · 类型
function detailTitle() {
  const t = detailType.value === "income" ? "收入" : "支出";
  const p = detailRange.value === "year"
    ? `${detailYear.value}年`
    : `${detailMonth.value.slice(0, 4)}年${Number(detailMonth.value.slice(5))}月`;
  const base = detail.value.name ? `${detail.value.name}（按${detail.value.dim === "category" ? "分类" : "归属人"}）` : "全部流水";
  return `${base} · ${p} ${t}`;
}

async function openDetail(query, dim, name) {
  // 弹窗初始状态继承主页面当前选择（自定义范围在弹窗内按月模式起步）
  detail.value = { open: true, rows: [], total: 0, loading: false, dim: dim || "", name: name || "" };
  detailType.value = query?.type || type.value;
  detailRange.value = range.value === "year" ? "year" : "month";
  detailMonth.value = selMonth.value;
  detailYear.value = year.value;
  sortField.value = "amount";
  sortOrder.value = "asc"; // 点击图表默认按金额升序
  await fetchDetail();
}

async function fetchDetail() {
  if (!detail.value.open) return;
  detail.value.loading = true;
  const q = {
    ...detailPeriod.value,
    type: detailType.value,
    pageSize: 300,
  };
  if (detail.value.dim && detail.value.name) q[detail.value.dim] = detail.value.name;
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

// 归属人专属底色（10% 透明度背景，文字保持原色）：用于详情行左侧色块
function ownerBg(c) {
  if (!c) return '';
  return `${c}1a`; // 8 位 hex：前 6 位 RGB + 1a（10% alpha）
}
// 归属人缩写（最多 2 字，空则"我"）
function ownerShort(name) {
  const s = (name || '').trim();
  if (!s) return '我';
  return s.length <= 2 ? s : s.slice(-2);
}

// ---------------- 分类排行（对齐安卓「分类排行」列表，数据源同分类饼图） ----------------
const catTotal = computed(() => category.value.reduce((s, c) => s + Number(c.value || 0), 0));
const catMax = computed(() => category.value.reduce((s, c) => Math.max(s, Number(c.value || 0)), 0));
function catPct(c) {
  if (!catTotal.value) return "0%";
  return ((Number(c.value) / catTotal.value) * 100).toFixed(0) + "%";
}
function catBarPct(c) {
  if (!catMax.value) return "0%";
  return (Number(c.value) / catMax.value) * 100 + "%";
}
// 点击排行行 → 明细弹窗（按该分类 + 当前类型过滤，与安卓 CategoryDetailPage 等价）
async function onRankClick(name) {
  await openDetail({ type: type.value }, "category", name);
}
</script>

<template>
  <div>
    <h2 class="page-title">统计分析</h2>

    <!-- 范围 + 类型 快速切换（对齐安卓图表：月/年 + 支出/收入） -->
    <div class="card range">
      <div class="seg">
        <button :class="{on:range==='month'}" @click="range='month';load()">月</button>
        <button :class="{on:range==='year'}" @click="range='year';load()">年</button>
        <button :class="{on:range==='custom'}" @click="range='custom'">自定义</button>
      </div>
      <div class="seg">
        <button :class="{on:type==='expense'}" @click="type='expense';load()">支出</button>
        <button :class="{on:type==='income'}" @click="type='income';load()">收入</button>
      </div>
      <template v-if="range==='month'">
        <PeriodSwitcher mode="month" :model-value="selMonth" @update:model-value="selMonth=$event;load()" />
      </template>
      <template v-else-if="range==='year'">
        <PeriodSwitcher mode="year" :model-value="year" @update:model-value="year=$event;load()" />
      </template>
      <template v-else>
        <DateInput v-model="custom.start" />
        <span class="muted">至</span>
        <DateInput v-model="custom.end" />
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
      <div class="card">
        <div class="chart-toolbar">
          <span class="muted small">💡 点击饼图扇区或下方标注查看明细</span>
          <button v-if="category.length" class="btn btn-mini clear-btn" @click="clearPieLegend">全部取消</button>
        </div>
        <EChart ref="pieChart" :key="'pie-' + chartKey" :option="pie(catTitle, category)" v-if="category.length" @click="onPieClick" :height="'430px'" />
        <div v-if="!category.length" class="empty muted">暂无{{ type==='income'?'收入':'支出' }}数据</div>
      </div>
      <div class="card">
        <div class="chart-toolbar">
          <span class="muted small">💡 点击饼图扇区或下方标注查看明细</span>
          <button v-if="attribution.length" class="btn btn-mini clear-btn" @click="clearAttrLegend">全部取消</button>
        </div>
        <EChart ref="attrChart" :key="'attr-' + chartKey" :option="pie(attrTitle, attribution, attrColorMap)" v-if="attribution.length" @click="onPieClick" :height="'430px'" />
        <div v-if="!attribution.length" class="empty muted">暂无数据</div>
      </div>
      <div class="card daily-card">
        <div class="section-title">流水趋势（悬浮查看当日明细）</div>
        <EChart :key="'daily-' + chartKey" :option="dailyOpt" v-if="daily.length" :height="'280px'" />
        <div v-if="!daily.length" class="empty muted">暂无数据</div>
      </div>
    </div>

    <!-- 分类排行（对齐安卓：图标 + 名称 + 百分比 + 金额 + 进度条，点击行查看该分类明细） -->
    <div class="card rank-card">
      <div class="rank-head">
        <span class="section-title">{{ type==='income'?'收入':'支出' }}分类排行</span>
        <span v-if="category.length" class="muted small">点击分类查看明细</span>
      </div>
      <div v-if="category.length" class="rank-list">
        <div v-for="(c, i) in category" :key="c.name" class="rank-row" @click="onRankClick(c.name)">
          <span class="rank-icon" :style="{ background: PALETTE[i % PALETTE.length] + '1a', color: PALETTE[i % PALETTE.length] }">{{ catIcon(c.name) }}</span>
          <div class="rank-main">
            <div class="rank-line1">
              <span class="rank-name">{{ c.name }} <span class="rank-pct muted">{{ catPct(c) }}</span></span>
              <span class="rank-amt">{{ fmt(c.value) }}</span>
            </div>
            <div class="rank-bar"><i :style="{ width: catBarPct(c), background: PALETTE[i % PALETTE.length] }"></i></div>
          </div>
        </div>
      </div>
      <div v-else class="empty muted" style="height:100px">暂无{{ type==='income'?'收入':'支出' }}数据</div>
    </div>

    <!-- 明细弹窗（支持弹窗内快速切换 支出/收入 + 月/年） -->
    <div v-if="detail.open" class="modal-mask" @click.self="detail.open=false">
      <div class="modal">
        <div class="modal-head">
          <b>{{ detailTitle() }}</b>
          <span class="muted">共 {{ detail.total }} 笔 · 合计 {{ fmt(detailSum) }}</span>
          <div class="seg sm">
            <button :class="{on:sortField==='amount'}" @click="sortField='amount'">按金额</button>
            <button :class="{on:sortField==='time'}" @click="sortField='time'">按时间</button>
            <button @click="sortOrder = sortOrder==='desc'?'asc':'desc'">{{ sortOrder==='desc'?'↓ 降序':'↑ 升序' }}</button>
          </div>
          <button class="btn btn-sm" @click="detail.open=false">关闭</button>
        </div>
        <div class="modal-filter">
          <div class="seg sm">
            <button :class="{on:detailType==='expense'}" @click="detailType='expense';fetchDetail()">支出</button>
            <button :class="{on:detailType==='income'}" @click="detailType='income';fetchDetail()">收入</button>
          </div>
          <div class="seg sm">
            <button :class="{on:detailRange==='month'}" @click="detailRange='month';fetchDetail()">月</button>
            <button :class="{on:detailRange==='year'}" @click="detailRange='year';fetchDetail()">年</button>
          </div>
          <PeriodSwitcher
            v-if="detailRange==='month'"
            mode="month"
            :model-value="detailMonth"
            @update:model-value="detailMonth=$event;fetchDetail()"
          />
          <PeriodSwitcher
            v-else
            mode="year"
            :model-value="detailYear"
            @update:model-value="detailYear=$event;fetchDetail()"
          />
        </div>
        <div class="modal-body">
          <div v-if="detail.loading" class="muted" style="padding:24px;text-align:center">加载中…</div>
          <div v-else-if="sortedRows.length" class="detail-list">
            <div v-for="f in sortedRows" :key="f.id" class="detail-row">
              <!-- 左边底色 = 归属人专属色（参考安卓 ownerColor，多人共享账本一眼分清谁的花销） -->
              <div
                class="dr-cat"
                :style="f.attribution_color ? { background: ownerBg(f.attribution_color), color: f.attribution_color } : null"
              >
                <span class="dr-icon">{{ catIcon(f.category) }}</span>
                <span class="dr-catname">{{ f.category }}</span>
                <span v-if="f.attribution" class="dr-owner-label" :title="f.attribution">· {{ ownerShort(f.attribution) }}</span>
              </div>
              <div class="dr-main">
                <div class="dr-line1">
                  <span class="dr-name">{{ f.description || f.category }}</span>
                  <span class="dr-meta">
                    <span class="dr-pct">{{ pct(f) }}</span>
                    <span class="dr-amt" :class="f.type">{{ (f.type === 'expense' ? '-' : '+') + Number(f.amount).toFixed(2) }}</span>
                  </span>
                </div>
                <div class="dr-bar"><i :class="f.type" :style="{ width: pct(f) }"></i></div>
                <div class="dr-date muted">{{ dayjs(f.flow_time).format('YYYY-MM-DD HH:mm') }}</div>
              </div>
            </div>
          </div>
          <div v-else class="muted" style="padding:24px;text-align:center">没有匹配的流水</div>
        </div>
      </div>
    </div>

    <!-- XX 年每月流水（用户要求移到页面最下面） -->
    <div class="card" style="margin-top:16px">
      <div class="section-title">{{ barYear }} 年每月流水</div>
      <EChart :key="'monthly-' + barYear" :option="monthlyOpt" :height="'320px'" @click="onBarClick" />
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
.clickable-hint::after { content: "点击查看明细"; position: absolute; top: 8px; right: 12px; font-size: 11px; color: var(--text-2); opacity: .7; pointer-events: none; }
.chart-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 4px 0; }
.clear-btn { font-size: 11px; padding: 3px 8px; }
.empty { display: flex; align-items: center; justify-content: center; height: 300px; }
@media (max-width: 720px) { .cards { grid-template-columns: repeat(2,1fr); } .charts { grid-template-columns: 1fr; } .daily-card { grid-column: span 1; } }

/* 分类排行（对齐安卓 _catRows：图标 + 名称/百分比 + 金额 + 进度条） */
.rank-card { margin-top: 16px; }
.rank-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.rank-list { display: flex; flex-direction: column; }
.rank-row { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 10px; cursor: pointer; transition: background .15s; }
.rank-row:hover { background: var(--surface-2); }
.rank-icon { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.rank-main { flex: 1; min-width: 0; }
.rank-line1 { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.rank-name { font-size: 14px; font-weight: 600; color: var(--text); }
.rank-pct { font-size: 12px; margin-left: 6px; }
.rank-amt { font-size: 14px; font-weight: 800; color: var(--text); }
.rank-bar { height: 7px; border-radius: 6px; background: var(--surface); overflow: hidden; margin-top: 6px; }
.rank-bar i { display: block; height: 100%; border-radius: 6px; }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal { background: var(--surface); color: var(--text); width: min(1100px, 100%); max-width: min(1100px, 100%); max-height: 88vh; border-radius: 14px; display: flex; flex-direction: column; box-shadow: var(--shadow); overflow: hidden; }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--surface-2); flex-wrap: wrap; }
.modal-head .muted { font-size: 13px; }
.modal-filter { display: flex; align-items: center; gap: 10px; padding: 10px 16px 6px; flex-wrap: wrap; }
.seg.sm { padding: 2px; }
.seg.sm button { padding: 4px 10px; font-size: 12px; border-radius: 6px; }
.modal-head .btn { margin-left: auto; }
.modal-body { padding: 8px 16px 16px; overflow: auto; }

/* 明细列表：柱状图样式，每条记录 = 左(分类图标+名) + 右(行1 名称+百分比+金额 / 行2 柱状 / 行3 日期) */
.detail-list { display: flex; flex-direction: column; gap: 10px; }
.detail-row { display: flex; gap: 14px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
.dr-owner-label { font-size: 11px; opacity: 0.75; margin-left: 2px; }
.dr-cat { flex: 0 0 112px; display: flex; align-items: center; gap: 6px; justify-content: flex-start; }
.dr-icon { font-size: 22px; }
.dr-catname { font-weight: 700; font-size: 15px; color: var(--text); }
.dr-main { flex: 1; min-width: 0; }
.dr-line1 { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dr-name { font-size: 15px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-meta { display: inline-flex; align-items: baseline; gap: 12px; flex-shrink: 0; }
.dr-pct { font-size: 13px; color: var(--text-2); }
.dr-amt { font-size: 15px; font-weight: 800; }
.dr-amt.expense { color: var(--expense); }
.dr-amt.income { color: var(--income); }
.dr-bar { height: 8px; border-radius: 6px; background: var(--surface); overflow: hidden; margin: 7px 0 6px; }
.dr-bar i { display: block; height: 100%; border-radius: 6px; }
.dr-bar i.expense { background: var(--expense); }
.dr-bar i.income { background: var(--income); }
.dr-date { font-size: 12px; }
@media (max-width: 640px) {
  .detail-row { flex-direction: column; gap: 8px; }
  .dr-cat { flex-basis: auto; }
}
</style>
