<script setup>
import { ref, onMounted, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import FlowDialog from "../components/FlowDialog.vue";

const store = useStore();
const month = ref(dayjs().format("YYYY-MM"));
const overview = ref({ income: 0, expense: 0, balance: 0, count: 0, byUser: [] });
const calendar = ref({});
const recent = ref([]);
const showDialog = ref(false);
const preset = ref(null);

// 共享账本：按归属人拆分「我 / 其他成员」的记账笔数（导入的也计入 count）
const isShared = computed(() => (store.currentBook?.members || 0) > 1);
const meCount = computed(() => {
  const nick = store.user?.nickname;
  const me = overview.value.byUser?.find((x) => x.name === nick);
  return me?.count || 0;
});
const othersCount = computed(() => Math.max(0, (overview.value.count || 0) - meCount.value));

const monthStart = computed(() => month.value + "-01");
const monthEnd = computed(() => dayjs(monthStart.value).endOf("month").format("YYYY-MM-DD"));

async function load() {
  const [ov, cal, fl] = await Promise.all([
    api.get("/stats/overview", { params: { start: monthStart.value, end: monthEnd.value } }),
    api.get("/stats/calendar", { params: { month: month.value } }),
    api.get("/flows", { params: { start: monthStart.value, end: monthEnd.value, pageSize: 8 } }),
  ]);
  overview.value = ov.data;
  calendar.value = Object.fromEntries(cal.data.map((d) => [d.date, d]));
  recent.value = fl.data.list;
}
onMounted(load);

// 日历渲染
const days = computed(() => {
  const first = dayjs(monthStart.value);
  const start = first.day(); // 周日=0
  const total = first.daysInMonth();
  const arr = [];
  for (let i = 0; i < start; i++) arr.push(null);
  for (let d = 1; d <= total; d++) {
    const date = first.date(d).format("YYYY-MM-DD");
    arr.push({ d, date, ...(calendar.value[date] || {}) });
  }
  return arr;
});
const maxExpense = computed(() =>
  Math.max(1, ...Object.values(calendar.value).map((x) => x.expense || 0))
);
function heat(day) {
  if (!day?.expense) return 0;
  return Math.min(1, day.expense / maxExpense.value);
}

function changeMonth(delta) {
  month.value = dayjs(monthStart.value).add(delta, "month").format("YYYY-MM");
  load();
}

function quickAddOn(date) {
  preset.value = { flow_time: dayjs(date).format("YYYY-MM-DD") };
  showDialog.value = true;
}
function onSaved() {
  load();
}
function fmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function catIcon(name) {
  return store.categories.find((c) => c.name === name)?.icon || "💰";
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">你好，{{ store.user?.nickname }} 👋</h2>
      <button class="btn btn-primary" @click="preset=null; showDialog=true">＋ 记一笔</button>
    </div>

    <!-- 概览卡片 -->
    <div class="grid cards">
      <div class="card stat">
        <div class="muted">本月支出</div>
        <div class="big expense">{{ fmt(overview.expense) }}</div>
      </div>
      <div class="card stat">
        <div class="muted">本月收入</div>
        <div class="big income">{{ fmt(overview.income) }}</div>
      </div>
      <div class="card stat">
        <div class="muted">本月结余</div>
        <div class="big" :class="overview.balance >= 0 ? 'income' : 'expense'">{{ fmt(overview.balance) }}</div>
      </div>
      <div class="card stat" v-if="!isShared">
        <div class="muted">记账笔数（总数）</div>
        <div class="big">{{ overview.totalCount }}</div>
        <div class="sub muted">本月 {{ overview.count }} 笔</div>
      </div>
    </div>

    <!-- 共享账本：按「我 / 其他成员」拆分的记账笔数，放在收入/支出/结余下方 -->
    <div class="card count-split" v-if="isShared">
      <div class="cs-row">
        <span class="muted">记账笔数</span>
        <span class="cs-total">总数 <b>{{ overview.totalCount }}</b> 笔</span>
        <span class="cs-me">我 <b>{{ meCount }}</b> 笔</span>
        <span class="cs-others">其他成员 <b>{{ othersCount }}</b> 笔</span>
        <span class="muted small">（含导入，每笔记 1 次）</span>
      </div>
    </div>

    <!-- 日历看板 -->
    <div class="card" style="margin-top:16px">
      <div class="cal-head">
        <div class="section-title" style="margin:0">📅 消费日历</div>
        <div class="row" style="align-items:center;gap:8px">
          <button class="btn btn-sm" @click="changeMonth(-1)">‹</button>
          <b>{{ month }}</b>
          <button class="btn btn-sm" @click="changeMonth(1)">›</button>
        </div>
      </div>
      <div class="week">
        <span v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{ w }}</span>
      </div>
      <div class="cal">
        <div v-for="(day, i) in days" :key="i" class="cell" :class="{ empty: !day }" @click="day && quickAddOn(day.date)">
          <template v-if="day">
            <span class="dnum" :style="{ background: day.expense ? `rgba(239,68,68,${0.12 + heat(day)*0.5})` : 'transparent' }">{{ day.d }}</span>
            <span v-if="day.expense" class="ce expense">-{{ Number(day.expense).toFixed(0) }}</span>
            <span v-if="day.income" class="ci income">+{{ Number(day.income).toFixed(0) }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- 最近记录 -->
    <div class="card" style="margin-top:16px">
      <div class="cal-head">
        <div class="section-title" style="margin:0">最近记录</div>
        <router-link class="muted" to="/flows" style="font-size:13px">查看全部 ›</router-link>
      </div>
      <div v-if="!recent.length" class="empty-tip muted">本月还没有记录，点右上角「记一笔」开始吧</div>
      <div v-for="f in recent" :key="f.id" class="frow">
        <div class="ficon">{{ catIcon(f.category) }}</div>
        <div class="fmain">
          <div class="fcat">
            <span v-if="f.source === 'ai'" class="ai-tag" title="AI 记账">AI</span>
            {{ f.category }}<span v-if="f.description" class="muted"> · {{ f.description }}</span>
          </div>
          <div class="muted ftime">{{ dayjs(f.flow_time).format("MM-DD") }} · {{ f.attribution || "—" }}</div>
        </div>
        <div class="famt" :class="f.type">{{ f.type === "expense" ? "-" : "+" }}{{ Number(f.amount).toFixed(2) }}</div>
      </div>
    </div>

    <FlowDialog v-model="showDialog" :preset="preset" @saved="onSaved" />
  </div>
</template>

<style scoped>
.ai-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 17px;
  vertical-align: 1px;
}
.head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.cards { grid-template-columns: repeat(3, 1fr); }
.stat .big { font-size: 22px; font-weight: 800; margin-top: 6px; }
.stat .sub { font-size: 13px; margin-top: 2px; }
.count-split { margin-top: 14px; }
.cs-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; font-size: 15px; }
.cs-total b { color: var(--text); }
.cs-me b { color: var(--primary); }
.cs-others b { color: var(--text); }
.cs-row .small { font-size: 12px; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.week { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; color: var(--text-2); font-size: 12px; margin-bottom: 6px; }
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cell { min-height: 58px; border-radius: 8px; padding: 4px; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.cell:hover:not(.empty) { background: var(--surface-2); }
.cell.empty { cursor: default; }
.dnum { font-size: 12px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--text); }
.ce, .ci { font-size: 10.5px; line-height: 1.2; }
.famt { font-weight: 700; }
.frow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); }
.frow:first-of-type { border-top: none; }
.ficon { width: 38px; height: 38px; border-radius: 10px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; font-size: 19px; }
.fmain { flex: 1; min-width: 0; }
.fcat { font-size: 14px; }
.ftime { font-size: 12px; margin-top: 2px; }
.empty-tip { text-align: center; padding: 30px 0; }
@media (max-width: 720px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
  .stat .big { font-size: 19px; }
}
</style>
