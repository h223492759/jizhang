<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useRoute } from "vue-router";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import EChart from "../components/EChart.vue";

const store = useStore();
const route = useRoute();
const year = ref(dayjs().year());
const data = ref({ total: { amount: 0, spent: 0, remaining: 0, percent: 0 }, categories: [], spentByCategory: {} });
const years = computed(() => [year.value - 2, year.value - 1, year.value, year.value + 1].filter((v, i, a) => a.indexOf(v) === i));

const showDialog = ref(false);
const mode = ref("cat"); // 'total' | 'cat'
const form = ref({ categories: [], amount: "", expression: "" });

const showCopy = ref(false);
const copyFrom = ref(null);

async function load() {
  const { data: d } = await api.get("/budgets", { params: { year: year.value } });
  data.value = d;
}
onMounted(load);

const usedExpenseCats = computed(() => data.value.categories.map((c) => c.category));
const availableCats = computed(() => store.expenseCats);

// 金额算式实时计算：支持 "1000+200" 这类简单四则，结果即时显示
function evalExpr(s) {
  if (s == null) return NaN;
  const clean = String(s).replace(/[^0-9+\-*/().\s]/g, "");
  if (!clean.trim()) return NaN;
  try {
    const v = Function(`"use strict";return (${clean})`)();
    return typeof v === "number" && isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}
const liveAmount = computed(() => evalExpr(form.value.amount));
// 添加/编辑分类预算时，实时看每个所选分类的「分摊后预算 / 已用 / 剩余（可负）」
// 多分类时输入的是【总额】，后端会平分到各分类，这里预览也要按分摊值算
const livePreview = computed(() => {
  const amt = liveAmount.value;
  if (!isFinite(amt)) return [];
  const count = form.value.categories.length || 1;
  const per = amt / count;
  return form.value.categories.map((cat) => {
    const spent = data.value.spentByCategory?.[cat] || 0;
    return { cat, budget: per, spent, remaining: per - spent };
  });
});

function openTotal() {
  mode.value = "total";
  form.value = { categories: [], amount: String(data.value.total.amount || ""), expression: "" };
  showDialog.value = true;
}
function openCat() {
  mode.value = "cat";
  form.value = { categories: [], amount: "", expression: "" };
  showDialog.value = true;
}
function editCat(c) {
  mode.value = "cat";
  // 保留原始算式（再次修改时算式仍可见）
  form.value = { categories: [c.category], amount: c.expression || String(c.amount), expression: c.expression || "" };
  showDialog.value = true;
}
function toggleCat(cat) {
  const i = form.value.categories.indexOf(cat);
  if (i >= 0) form.value.categories.splice(i, 1);
  else form.value.categories.push(cat);
}

async function save() {
  const amt = liveAmount.value;
  if (!isFinite(amt) || amt < 0) return toast("请输入正确的金额（支持算式，如 1000+200）");
  try {
    const payload = {
      year: year.value,
      amount: amt,
      expression: String(form.value.amount || "").trim(),
    };
    if (mode.value === "total") payload.category = "";
    else payload.categories = form.value.categories;
    await api.post("/budgets", payload);
    toast("已保存");
    showDialog.value = false;
    load();
  } catch (e) { toast(e.message); }
}
// 上移/下移分类预算（同步服务器 sort；安卓端读 sort 显示）
async function moveCat(c, dir) {
  const list = data.value.categories;
  const i = list.findIndex((x) => x.category === c.category);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  // 互换 sort（确保新 sort 与原 sort 不冲突：用两者中位值）
  const a = list[i], b = list[j];
  const sortA = Math.max(1, (a.sort || 0));
  const sortB = Math.max(1, (b.sort || 0));
  // 简单处理：直接交换 sort，并服务端持久化
  const newSortA = sortB;
  const newSortB = sortA;
  // 本地立即反映
  a.sort = newSortA;
  b.sort = newSortB;
  data.value.categories = [...list]; // 触发响应式
  try {
    await api.post('/budgets/reorder', {
      year: Number(route.query.year) || new Date().getFullYear(),
      items: [
        { category: a.category, sort: newSortA },
        { category: b.category, sort: newSortB },
      ],
    });
    toast('已调序');
  } catch (e) { toast(e.message); }
}

async function delCat(c) {
  if (!confirm(`删除「${c.category}」的预算？`)) return;
  await api.delete("/budgets", { params: { year: year.value, category: c.category } });
  toast("已删除");
  load();
}
function barColor(p) {
  if (p >= 100) return "var(--expense)";
  if (p >= 80) return "#f59e0b";
  return "var(--primary)";
}
function fmt(n) { return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// 点击分类预算 → 弹出该分类「当年每月支出」柱状图（复用 /stats/monthly?category=）
const showChart = ref(false);
const chartCat = ref(null);
const chartMonthly = ref([]);
async function openChart(c) {
  chartCat.value = c;
  showChart.value = true;
  chartMonthly.value = [];
  showDetail.value = false;
  detailList.value = [];
  try {
    const { data } = await api.get("/stats/monthly", { params: { year: year.value, category: c.category } });
    chartMonthly.value = data;
  } catch (e) {
    toast(e.message);
  }
}
const chartTotal = computed(() => chartMonthly.value.reduce((s, m) => s + Number(m.expense || 0), 0));
const chartOpt = computed(() => ({
  tooltip: { trigger: "axis", formatter: (p) => `${p[0].axisValue}<br/>支出 ${fmt(p[0].data)}` },
  grid: { left: 55, right: 18, top: 20, bottom: 30 },
  xAxis: { type: "category", data: chartMonthly.value.map((m) => m.month.slice(5) + "月") },
  yAxis: { type: "value" },
  series: [{
    name: "支出", type: "bar", cursor: "pointer",
    data: chartMonthly.value.map((m) => Number(m.expense || 0)),
    itemStyle: { color: "#ef4444", borderRadius: [4, 4, 0, 0] },
  }],
}));

// 点击某根柱子 → 展开该月该分类的明细流水
const showDetail = ref(false);
const detailMonth = ref("");
const detailLoading = ref(false);
const detailList = ref([]);
const detailSum = computed(() => detailList.value.reduce((s, m) => s + Number(m.amount || 0), 0));
async function onChartClick(params) {
  const m = chartMonthly.value[params?.dataIndex];
  if (!m) return;
  const ym = m.month;
  detailMonth.value = `${ym} ${chartCat.value?.category} 明细`;
  showDetail.value = true;
  detailLoading.value = true;
  detailList.value = [];
  try {
    const { data } = await api.get("/flows", {
      params: {
        category: chartCat.value.category,
        start: `${ym}-01`, end: `${ym}-31`,
        pageSize: 200, sortBy: "flow_time", order: "asc",
      },
    });
    detailList.value = data.list || [];
  } catch (e) {
    toast(e.message);
  } finally {
    detailLoading.value = false;
  }
}
function closeDetail() { showDetail.value = false; detailList.value = []; }

// 复制预算
async function doCopy() {
  if (!copyFrom.value) return toast("请选择来源年份");
  try {
    const { data: r } = await api.post("/budgets/copy", { fromYear: copyFrom.value, toYear: year.value });
    toast(`已复制 ${r.copied} 条预算到 ${year.value} 年`);
    showCopy.value = false;
    load();
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">预算管理</h2>
      <div class="row" style="gap:8px">
        <select class="select" style="width:auto" v-model.number="year" @change="load">
          <option v-for="y in years" :key="y" :value="y">{{ y }}年</option>
        </select>
        <button class="btn btn-sm" @click="showCopy = true">复制预算</button>
      </div>
    </div>

    <!-- 年度总预算 -->
    <div class="card total-card">
      <div class="cal-head">
        <div class="section-title" style="margin:0">🎯 {{ year }} 年度总预算</div>
        <button class="btn btn-sm" @click="openTotal">{{ data.total.amount ? "修改" : "设置" }}</button>
      </div>
      <template v-if="data.total.amount">
        <div class="total-nums">
          <span>预算 <b>{{ fmt(data.total.amount) }}</b></span>
          <span>已用 <b class="expense">{{ fmt(data.total.spent) }}</b></span>
          <span>剩余 <b :class="data.total.remaining >= 0 ? 'income' : 'expense'">{{ fmt(data.total.remaining) }}</b></span>
          <span class="muted">剩余 {{ data.total.percent }}%</span>
        </div>
        <div class="bar" style="margin-top:12px"><i :style="{ width: Math.min(100, data.total.percent) + '%', background: barColor(data.total.percent) }"></i></div>
        <div class="muted" style="margin-top:6px;font-size:13px">
          已使用 {{ data.total.percent }}%
          <span v-if="data.total.percent >= 100" class="expense"> · ⚠️ 已超支！</span>
          <span v-else-if="data.total.percent >= 80" style="color:#f59e0b"> · 接近预算上限</span>
        </div>
      </template>
      <div v-else class="muted" style="padding:8px 0">尚未设置年度总预算，点右上角设置。</div>
    </div>

    <!-- 分类预算 -->
    <div class="head-row" style="margin:20px 0 12px">
      <div class="section-title" style="margin:0">分类预算（一行 4 个，含剩余百分比）</div>
      <button class="btn btn-sm btn-primary" @click="openCat">＋ 添加分类预算</button>
    </div>
    <div class="grid cat-list">
      <div v-for="(c, i) in data.categories" :key="c.category" class="card cat-item" @click="openChart(c)" title="点击查看每月支出柱状图">
        <div class="cat-top">
          <b>{{ store.categories.find(x => x.name === c.category)?.icon || '💰' }} {{ c.category }}</b>
          <div class="cat-actions" @click.stop>
            <button class="btn btn-sm icon-btn" :disabled="i === 0" @click="moveCat(c, -1)" title="上移">↑</button>
            <button class="btn btn-sm icon-btn" :disabled="i >= data.categories.length - 1" @click="moveCat(c, 1)" title="下移">↓</button>
            <button class="btn btn-sm" @click="editCat(c)">改</button>
            <button class="btn btn-sm btn-danger" @click="delCat(c)">删</button>
          </div>
        </div>
        <div class="bar"><i :style="{ width: Math.min(100, c.percent) + '%', background: barColor(c.percent) }"></i></div>
        <div class="cat-nums muted">
          <span>{{ fmt(c.spent) }} / {{ fmt(c.amount) }}</span>
          <span :class="c.remaining < 0 ? 'expense' : ''">{{ c.remaining >= 0 ? '剩 ' + fmt(c.remaining) : '超 ' + fmt(-c.remaining) }}</span>
        </div>
        <div class="cat-pct" :class="c.percent >= 100 ? 'over' : ''">剩余 {{ 100 - c.percent }}%</div>
      </div>
      <div v-if="!data.categories.length" class="muted empty-tip">还没有分类预算，给常花钱的分类设个上限吧。</div>
    </div>

    <!-- 添加/编辑预算弹窗 -->
    <div v-if="showDialog" class="modal-mask" @click.self="showDialog = false">
      <div class="modal" style="max-width:780px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">{{ mode === 'total' ? '年度总预算' : (form.categories.length ? '编辑分类预算' : '添加分类预算') }}</h3>
          <div class="row head-btns">
            <button class="btn" @click="showDialog = false">取消</button>
            <button class="btn btn-primary" @click="save">保存</button>
          </div>
        </div>

        <template v-if="mode === 'cat'">
          <div class="field">
            <span>选择分类（可多选，已设预算的置灰）</span>
            <div class="cat-check">
              <button
                v-for="c in availableCats" :key="c.id"
                class="cc" :class="{ on: form.categories.includes(c.name), disabled: usedExpenseCats.includes(c.name) && !form.categories.includes(c.name) }"
                :disabled="usedExpenseCats.includes(c.name) && !form.categories.includes(c.name)"
                @click="toggleCat(c.name)"
              >{{ c.icon }} {{ c.name }}</button>
            </div>
          </div>
        </template>

        <label class="field">
          <span>{{ mode === 'total' ? '年度总预算金额' : (form.categories.length > 1 ? `总预算金额（将平分到 ${form.categories.length} 个分类）` : '该分类的预算金额') }}</span>
          <input class="input" v-model="form.amount" placeholder="如 1000 或 800+200" />
          <span class="muted small" v-if="isFinite(liveAmount) && form.amount !== String(liveAmount)">
            = {{ fmt(liveAmount) }}（算式结果）
          </span>
        </label>

        <!-- 实时显示每个所选分类的「分摊预算 / 已用 / 剩余（可负）」 -->
        <div class="preview-box" v-if="mode === 'cat' && livePreview.length">
          <div class="muted small" style="margin-bottom:6px">
            按当前总额平分后，各分类：
          </div>
          <div v-for="p in livePreview" :key="p.cat" class="prev-row">
            <span>{{ p.cat }}</span>
            <span class="muted">预算 {{ fmt(p.budget) }}</span>
            <span class="muted">已用 {{ fmt(p.spent) }}</span>
            <span :class="p.remaining < 0 ? 'expense' : 'income'">
              剩 {{ p.remaining >= 0 ? fmt(p.remaining) : '-' + fmt(-p.remaining) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 点击分类预算 → 当年每月支出柱状图 -->
    <div v-if="showChart" class="modal-mask" @click.self="showChart = false">
      <div class="modal" style="max-width:880px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">{{ chartCat?.category }} · {{ year }} 年每月支出</h3>
          <button class="btn" @click="showChart = false">关闭</button>
        </div>
        <div class="muted small" style="margin: 2px 0 10px">
          全年合计 {{ fmt(chartTotal) }}
        </div>
        <EChart :option="chartOpt" :height="'340px'" @click="onChartClick" />
        <p class="muted small" style="margin: 6px 0 0">提示：点击任意一根柱子，可查看该月「{{ chartCat?.category }}」的明细流水 ↓</p>

        <!-- 点击柱子后的明细面板 -->
        <div v-if="showDetail" class="chart-detail">
          <div class="cd-head">
            <b>{{ detailMonth }}</b>
            <span class="muted small">共 {{ detailList.length }} 笔 · 支出 {{ fmt(detailSum) }}</span>
            <button class="btn btn-sm" @click="closeDetail">收起</button>
          </div>
          <div v-if="detailLoading" class="muted small" style="padding:10px 0">加载中…</div>
          <div v-else class="cd-list">
            <div v-for="it in detailList" :key="it.id" class="cd-item">
              <span class="cd-date">{{ (it.flow_time || '').slice(5, 10) }}</span>
              <span class="cd-desc">{{ it.description || it.category }}</span>
              <span class="cd-pay muted small">{{ it.payment_method || '未标注' }}</span>
              <span class="cd-amt expense">{{ fmt(it.amount) }}</span>
            </div>
            <div v-if="!detailList.length" class="muted small" style="padding:10px 0">该月无此分类流水</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 复制预算弹窗 -->
    <div v-if="showCopy" class="modal-mask" @click.self="showCopy = false">
      <div class="modal" style="max-width:420px">
        <h3 class="modal-title">复制预算到 {{ year }} 年</h3>
        <p class="muted" style="font-size:13px;margin:0 0 12px">
          选择某一年，把它的「年度总预算 + 分类预算」一次性复制到当前年份（覆盖式）。
        </p>
        <label class="field">
          <span>来源年份</span>
          <select class="select" v-model.number="copyFrom">
            <option :value="null" disabled>请选择…</option>
            <option v-for="y in years.filter(y => y !== year)" :key="y" :value="y">{{ y }}年</option>
          </select>
        </label>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" @click="showCopy = false">取消</button>
          <button class="btn btn-primary" @click="doCopy">复制</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.total-nums { display: flex; gap: 24px; font-size: 15px; flex-wrap: wrap; }
.cat-list { grid-template-columns: repeat(4, 1fr); }
.cat-item { padding: 16px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.cat-item:hover { border-color: var(--primary); box-shadow: var(--shadow); }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 2px; border-bottom: 1px solid var(--border); flex-wrap: wrap; margin-bottom: 16px; }
.modal-head .modal-title { margin: 0; }
.head-btns { gap: 8px; }
.cat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 6px; flex-wrap: wrap; }
.cat-actions { display: inline-flex; gap: 4px; align-items: center; }
.icon-btn { padding: 2px 8px; min-width: 26px; }
.cat-nums { display: flex; justify-content: space-between; font-size: 13px; margin-top: 8px; }
.cat-pct { font-size: 12px; margin-top: 4px; color: var(--text-2); }
.cat-pct.over { color: var(--expense); }
.empty-tip { grid-column: 1/-1; text-align: center; padding: 30px 0; }
.cat-check { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-height: 260px; overflow: auto; }
.cc { border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 8px 10px; font-size: 13px; cursor: pointer; text-align: left; color: var(--text-2); }
.cc.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.cc.disabled { opacity: .45; cursor: not-allowed; }
.preview-box { margin: 4px 0 12px; padding: 10px 12px; background: var(--surface-2); border-radius: 10px; }
.prev-row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 3px 0; }
.chart-detail { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 14px; }
.cd-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.cd-head .btn { margin-left: auto; }
.cd-list { max-height: 46vh; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.cd-item { display: grid; grid-template-columns: 64px 1fr auto auto; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 8px; background: var(--surface-2); font-size: 14px; }
.cd-item:hover { background: var(--surface-3, var(--surface-2)); }
.cd-date { color: var(--text-2); font-variant-numeric: tabular-nums; }
.cd-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-pay { font-size: 12px; }
.cd-amt { font-variant-numeric: tabular-nums; font-weight: 600; }
.small { font-size: 12px; }
@media (max-width: 900px) { .cat-list { grid-template-columns: repeat(2, 1fr); } }
</style>
