<script setup>
import { ref, computed, watch, nextTick } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import PeriodSwitcher from "./PeriodSwitcher.vue";

// 统计页「🔍 搜索流水」两段式交互（用户澄清后实现）：
// 1) 视图 kw：点搜索 → 弹输入框 → 输入关键字，回车或点「搜索」确认
// 2) 视图 list：确认后弹出结果弹窗，展示所有含该关键字的流水（默认全部时间），
//    顶部是通用的「全部时间 / 月 / 年 + PeriodSwitcher 快速 chips」交互，可随时收窄到某月/某年
// 数据接口复用 GET /flows（keyword LIKE description + start/end + page/pageSize 上限 200）
const props = defineProps({ show: Boolean });
const emit = defineEmits(["update:show"]);
const store = useStore();

const view = ref("kw"); // kw（先输关键字） | list（结果弹窗）
const kw = ref("");
const kwInput = ref(null);

// 结果弹窗内时间段：默认全部时间（展示所有命中流水），顶部切月/年收窄
const scope = ref("all"); // all | month | year
const selMonth = ref(dayjs().format("YYYY-MM"));
const selYear = ref(String(dayjs().year()));

// 排序（用户要求搜索弹窗也支持「按时间/按金额」+ 升降序，默认按时间倒序 = 最新在上）
const sortBy = ref("flow_time"); // flow_time | amount（与服务端 /flows 一致）
const order = ref("desc");       // desc | asc

const rows = ref([]);
const total = ref(0);
const sums = ref({ expense: 0, income: 0 });
const page = ref(1);
const loading = ref(false);
const searched = ref(false);
const PAGE_SIZE = 200;

// 时间段（空对象 = 全部时间）
const period = computed(() => {
  if (scope.value === "month") {
    const m = selMonth.value;
    return { start: `${m}-01`, end: dayjs(`${m}-01`).endOf("month").format("YYYY-MM-DD") };
  }
  if (scope.value === "year") {
    return { start: `${selYear.value}-01-01`, end: `${selYear.value}-12-31` };
  }
  return {};
});

async function fetchList(reset = true) {
  if (reset) {
    page.value = 1;
    rows.value = [];
  }
  loading.value = true;
  const params = {
    ...period.value,
    keyword: kw.value.trim(),
    page: page.value,
    pageSize: PAGE_SIZE,
    sortBy: sortBy.value,
    order: order.value,
  };
  try {
    const { data } = await api.get("/flows", { params });
    if (reset) {
      rows.value = data.list;
      total.value = data.total;
      sums.value = { expense: Number(data.expense || 0), income: Number(data.income || 0) };
    } else {
      rows.value.push(...data.list);
    }
    searched.value = true;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}

function loadMore() {
  if (loading.value || rows.value.length >= total.value) return;
  page.value += 1;
  fetchList(false);
}

// 关键字视图 → 确认（回车 / 点搜索）后打开结果弹窗并查询
async function doSearch() {
  const k = kw.value.trim();
  if (!k) {
    toast("请输入名称关键字");
    kwInput.value?.focus();
    return;
  }
  view.value = "list";
  await fetchList(true);
}

// 每次打开：回到关键字输入视图（保留上次关键字，方便快速再搜）
watch(
  () => props.show,
  (v) => {
    if (v) {
      view.value = "kw";
      scope.value = "all";
      searched.value = false;
      nextTick(() => kwInput.value?.focus());
    }
  }
);

const loadedAll = computed(() => !loading.value && total.value > 0 && rows.value.length >= total.value);

function fmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function catIcon(name) {
  return store.categories.find((c) => c.name === name)?.icon || "💰";
}
// 归属缩写（最多 2 字，空则"我"）
function ownerShort(name) {
  const s = (name || "").trim();
  if (!s) return "我";
  return s.length <= 2 ? s : s.slice(-2);
}
// 归属人专属底色（10% 透明度背景，文字保持原色）
function ownerBg(c) {
  if (!c) return "";
  return `${c}1a`;
}
</script>

<template>
  <div v-if="show" class="modal-mask" @click.self="emit('update:show', false)">
    <!-- ── 第 1 步：关键字输入 ───────────────────────────── -->
    <div v-if="view === 'kw'" class="modal kw-modal">
      <div class="modal-head">
        <b>🔍 搜索流水</b>
        <button class="btn btn-sm" @click="emit('update:show', false)">取消</button>
      </div>
      <div class="kw-body">
        <input
          ref="kwInput"
          class="input kw-input"
          v-model="kw"
          placeholder="输入名称关键字，如「美团」「工资」"
          @keyup.enter="doSearch"
        />
        <div class="muted kw-hint">回车或点「搜索」后，弹窗展示所有含该关键字的流水，顶部可按月/年浏览</div>
        <button class="btn btn-primary kw-go" :disabled="!kw.trim()" @click="doSearch">搜索</button>
      </div>
    </div>

    <!-- ── 第 2 步：结果弹窗（顶部为通用月/年切换） ─────────── -->
    <div v-else class="modal">
      <div class="modal-head">
        <div class="sf-title">
          <b>流水「{{ kw.trim() }}」</b>
          <span v-if="searched" class="muted sf-sum">共 {{ total }} 笔 · 支出 {{ fmt(sums.expense) }} · 收入 {{ fmt(sums.income) }}</span>
        </div>
        <!-- 排序（与 Stats 详情弹窗一致：按金额 / 按时间 + ↓/↑） -->
        <div class="seg sm sf-sort">
          <button :class="{ on: sortBy === 'amount' }" @click="sortBy='amount'; fetchList(true)">按金额</button>
          <button :class="{ on: sortBy === 'flow_time' }" @click="sortBy='flow_time'; fetchList(true)">按时间</button>
          <button @click="order = order === 'desc' ? 'asc' : 'desc'; fetchList(true)">{{ order === 'desc' ? '↓ 降序' : '↑ 升序' }}</button>
        </div>
        <div class="head-actions">
          <button class="btn btn-sm" @click="view = 'kw'; nextTick(() => kwInput.value?.focus())">✎ 改关键字</button>
          <button class="btn btn-sm" @click="emit('update:show', false)">关闭</button>
        </div>
      </div>

      <!-- 顶部：现在通用的年/月切换（全部时间默认，可切月/年快速收窄） -->
      <div class="modal-filter sf-filter">
        <div class="seg sm">
          <button :class="{ on: scope === 'all' }" @click="scope = 'all'; fetchList(true)">全部时间</button>
          <button :class="{ on: scope === 'month' }" @click="scope = 'month'; fetchList(true)">月</button>
          <button :class="{ on: scope === 'year' }" @click="scope = 'year'; fetchList(true)">年</button>
        </div>
        <PeriodSwitcher
          v-if="scope === 'month'"
          mode="month"
          :model-value="selMonth"
          @update:model-value="selMonth = $event; fetchList(true)"
        />
        <PeriodSwitcher
          v-else-if="scope === 'year'"
          mode="year"
          :model-value="selYear"
          @update:model-value="selYear = $event; fetchList(true)"
        />
      </div>

      <div class="modal-body sf-body">
        <div v-if="loading" class="muted" style="padding: 24px; text-align: center">加载中…</div>
        <div v-else-if="rows.length" class="sf-list">
          <div v-for="f in rows" :key="f.id" class="sf-row">
            <!-- 左：分类图标块（归属底色） -->
            <div
              class="sf-cat"
              :style="f.attribution_color ? { background: ownerBg(f.attribution_color), color: f.attribution_color } : null"
            >
              <span class="sf-icon">{{ catIcon(f.category) }}</span>
              <span class="sf-catname">{{ f.category }}</span>
              <span v-if="f.attribution" class="sf-owner" :title="f.attribution">· {{ ownerShort(f.attribution) }}</span>
            </div>
            <!-- 右：名称 + 时间 | 金额 -->
            <div class="sf-main">
              <div class="sf-top">
                <span class="sf-name">{{ f.description || f.category }}</span>
                <span class="sf-meta">
                  <span v-if="f.source === 'ai'" class="ai-tag" title="AI 记账">AI</span>
                  <span class="sf-amt" :class="f.type">{{ (f.type === 'expense' ? '-' : '+') + Number(f.amount).toFixed(2) }}</span>
                </span>
              </div>
              <div class="sf-bot">
                <span v-if="f.payment_method" class="muted">支付：{{ f.payment_method }}</span>
                <span class="muted">{{ dayjs(f.flow_time).format('YYYY-MM-DD HH:mm') }}</span>
              </div>
            </div>
          </div>
          <button v-if="!loadedAll" class="btn sf-more" :disabled="loading" @click="loadMore">
            {{ loading ? '加载中…' : `加载更多（已显示 ${rows.length}/${total}）` }}
          </button>
          <div v-else-if="total > PAGE_SIZE" class="muted sf-more-tip">已全部加载（{{ total }} 笔）</div>
        </div>
        <div v-else-if="searched" class="muted" style="padding: 24px; text-align: center">没有匹配的流水</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 弹窗外壳（与统计页明细弹窗一致） */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 16px;
}
.modal {
  background: var(--surface);
  color: var(--text);
  width: min(980px, 100%);
  max-width: min(980px, 100%);
  max-height: 88vh;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow);
  overflow: hidden;
}
/* 关键字输入视图：窄卡居中 */
.kw-modal { width: min(520px, 100%); max-width: min(520px, 100%); }
.modal-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-2);
  flex-wrap: wrap;
}
.sf-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex: 1; }
.sf-title b { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-sum { font-size: 12px; white-space: nowrap; }
.head-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.kw-body { padding: 20px 18px 22px; display: flex; flex-direction: column; gap: 12px; }
.kw-input { width: 100%; font-size: 15px; padding: 10px 12px; }
.kw-hint { font-size: 12px; line-height: 1.6; }
.kw-go { align-self: flex-end; min-width: 110px; }
.modal-filter { display: flex; align-items: center; gap: 10px; padding: 10px 16px 8px; flex-wrap: wrap; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: 10px; padding: 2px; }
.seg button { border: none; background: transparent; padding: 4px 10px; font-size: 12px; border-radius: 6px; cursor: pointer; color: var(--text-2); }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.modal-body { padding: 10px 16px 16px; overflow: auto; }

.sf-list { display: flex; flex-direction: column; gap: 8px; }
.sf-row {
  display: flex;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  align-items: center;
}
.sf-cat { flex: 0 0 118px; display: flex; align-items: center; gap: 6px; min-width: 0; }
.sf-icon { font-size: 20px; }
.sf-catname { font-weight: 700; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-owner { font-size: 11px; opacity: 0.75; margin-left: 2px; white-space: nowrap; }
.sf-main { flex: 1; min-width: 0; }
.sf-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.sf-name { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-meta { display: inline-flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
.sf-amt { font-size: 15px; font-weight: 800; white-space: nowrap; }
.sf-amt.expense { color: var(--expense); }
.sf-amt.income { color: var(--income); }
.sf-bot { display: flex; align-items: center; gap: 14px; margin-top: 3px; font-size: 12px; }
.ai-tag {
  display: inline-block;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 17px;
}
.sf-more { align-self: center; margin-top: 4px; }
.sf-more-tip { align-self: center; margin-top: 4px; font-size: 12px; }
@media (max-width: 640px) {
  .sf-row { flex-direction: column; align-items: flex-start; gap: 6px; }
  .sf-cat { flex-basis: auto; }
}
</style>
