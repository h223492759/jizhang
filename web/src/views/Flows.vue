<script setup>
import { ref, computed, onMounted } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import FlowDialog from "../components/FlowDialog.vue";
import SearchFlowsDialog from "../components/SearchFlowsDialog.vue";

const store = useStore();
const filter = ref({ start: "", end: "", type: "", category: "", attribution: "", keyword: "" });
const data = ref({ list: [], total: 0, expense: 0, income: 0 });
const page = ref(1);
const pageSize = 20;
const facets = ref({ years: [], attributions: [] });
const showDialog = ref(false);
const editing = ref(null);
// 「🔍 搜索流水」弹窗（关键字搜全部流水，顶部可切月/年收窄，复用统计页组件）
const searchOpen = ref(false);

// 排序：金额 / 日期，升序 / 降序
const sortBy = ref("flow_time");
const sortOrder = ref("desc");
// 分类下拉（按当前类型过滤，2 列展示完整）
const catOpen = ref(false);

// 查重：重复分组（同日期+类型+金额+名称+分类+支付方式）
const showDup = ref(false);
const dupGroups = ref([]);
const dupTotal = ref(0);
const dupLoading = ref(false);
async function openDup() {
  dupLoading.value = true;
  showDup.value = true;
  try {
    const { data } = await api.get("/flows/duplicates");
    dupGroups.value = data.groups || [];
    dupTotal.value = data.totalDup || 0;
  } catch (e) {
    toast(e.message);
  } finally {
    dupLoading.value = false;
  }
}
async function delDupItem(g, item) {
  if (!confirm("删除这条重复记录？")) return;
  try {
    await api.delete(`/flows/${item.id}`);
    toast("已删除");
    g.items = g.items.filter((x) => x.id !== item.id);
    g.count--;
    dupGroups.value = dupGroups.value.filter((x) => x.items.length > 1);
    dupTotal.value = dupGroups.value.reduce((s, x) => s + (x.count - 1), 0);
    load();
  } catch (e) {
    toast(e.message);
  }
}

// 日期输入框支持「20260813」整串输入，自动补全为 YYYY-MM-DD
function normDate(s) {
  if (!s) return "";
  s = String(s).trim();
  const m = s.replace(/\D/g, "");
  if (m.length === 8) return `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "";
}
const catOptions = computed(() =>
  store.categories.filter((c) => !filter.value.type || c.type === filter.value.type)
);
function pickCat(name) {
  filter.value.category = name;
  catOpen.value = false;
  doFilter();
}
function setType(t) {
  filter.value.type = t;
  // 切类型后，分类若不在该类型下则清空
  if (filter.value.category && !catOptions.value.some((c) => c.name === filter.value.category))
    filter.value.category = "";
  doFilter();
}

async function load() {
  const params = {
    ...filter.value,
    page: page.value,
    pageSize,
    sortBy: sortBy.value,
    order: sortOrder.value,
  };
  try {
    const { data: d } = await api.get("/flows", { params });
    data.value = d;
  } catch (e) {
    toast(e.message);
  }
}
async function init() {
  // 即便 facets 拉取失败，也要保证流水列表能渲染，避免整页空白
  try {
    const { data: f } = await api.get("/stats/facets");
    facets.value = f;
  } catch (e) {
    toast(e.message);
  }
  await load();
}
onMounted(init);

function doFilter() {
  filter.value.start = normDate(filter.value.start);
  filter.value.end = normDate(filter.value.end);
  page.value = 1;
  load();
}
function reset() {
  filter.value = { start: "", end: "", type: "", category: "", attribution: "", keyword: "" };
  sortBy.value = "flow_time";
  sortOrder.value = "desc";
  doFilter();
}
function edit(f) {
  editing.value = f;
  showDialog.value = true;
}
function add() {
  editing.value = null;
  showDialog.value = true;
}
async function del(f) {
  if (!confirm(`确定删除这条「${f.category} ${f.amount}」记录吗？`)) return;
  try {
    await api.delete(`/flows/${f.id}`);
    toast("已删除");
    load();
  } catch (e) {
    toast(e.message);
  }
}
const totalPages = () => Math.max(1, Math.ceil(data.value.total / pageSize));
function catIcon(name) {
  return store.categories.find((c) => c.name === name)?.icon || "💰";
}

// ---------------- 定期记账 ----------------
const tab = ref("flows");
const recur = ref([]);
const members = ref([]);
const showRecurDialog = ref(false);
const recurForm = ref(blankRecur());
function blankRecur() {
  return {
    id: null,
    type: "expense",
    category: "",
    description: "",
    amount: "",
    payment_method: "",
    freq: "monthly",
    day_of_month: 1,
    month_of_year: 1,
    note: "",
    attribution_uid: null, // 归属：默认按当前账号
  };
}
const recurCats = computed(() =>
  store.categories.filter((c) => c.type === recurForm.value.type)
);

async function loadRecur() {
  try {
    const { data } = await api.get("/recurring");
    recur.value = data;
  } catch (e) {
    toast(e.message);
  }
}
// 账本成员（归属下拉用），默认当前账号
async function loadMembers() {
  try {
    const { data } = await api.get("/flows/attributions");
    members.value = data.members || [];
  } catch {}
}
// 打开「定期记账」：先把到期待生成的模板落成真实流水，再刷新模板列表
async function openRecurTab() {
  tab.value = "recurring";
  loadMembers();
  try {
    const { data } = await api.post("/recurring/generate");
    if (data.generated > 0) toast(`已自动生成 ${data.generated} 笔定期记账`);
  } catch {}
  await loadRecur();
}
function addRecur() {
  recurForm.value = blankRecur();
  recurForm.value.attribution_uid = store.user?.id || null; // 默认按当前账号
  if (recurCats.value[0]) recurForm.value.category = recurCats.value[0].name;
  showRecurDialog.value = true;
}
function editRecur(t) {
  recurForm.value = { ...t, amount: String(t.amount), attribution_uid: t.attribution_uid ?? null };
  showRecurDialog.value = true;
}
async function saveRecur() {
  const amt = Number(recurForm.value.amount);
  if (!amt || amt <= 0) return toast("请输入正确金额");
  try {
    if (recurForm.value.id) {
      await api.put(`/recurring/${recurForm.value.id}`, recurForm.value);
      toast("已更新");
    } else {
      await api.post("/recurring", recurForm.value);
      toast("已添加");
    }
    showRecurDialog.value = false;
    await loadRecur();
  } catch (e) {
    toast(e.message);
  }
}
async function delRecur(t) {
  if (!confirm(`确定删除「${t.category} ${t.amount}」这条定期记账模板吗？`)) return;
  try {
    await api.delete(`/recurring/${t.id}`);
    toast("已删除");
    await loadRecur();
  } catch (e) {
    toast(e.message);
  }
}
async function generateRecur() {
  try {
    const { data } = await api.post("/recurring/generate");
    toast(data.generated > 0 ? `已生成 ${data.generated} 笔` : "暂无可生成的记录");
    await loadRecur();
  } catch (e) {
    toast(e.message);
  }
}
function freqText(t) {
  if (t.freq === "yearly") return `每年 ${t.month_of_year} 月 ${t.day_of_month} 号`;
  return `每月 ${t.day_of_month} 号`;
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">流水记录</h2>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" v-if="tab==='flows'" @click="searchOpen = true">🔍 搜索流水</button>
        <button class="btn btn-primary" v-if="tab==='flows'" @click="add">＋ 记一笔</button>
      </div>
    </div>
    <div class="tabs">
      <button :class="{ on: tab==='flows' }" @click="tab='flows'">流水</button>
      <button :class="{ on: tab==='recurring' }" @click="openRecurTab()">定期记账</button>
    </div>

    <template v-if="tab==='flows'">

    <!-- 筛选 -->
    <div class="card filters">
      <div class="seg type-seg">
        <button :class="{ on: filter.type === '' }" @click="setType('')">全部</button>
        <button :class="{ on: filter.type === 'expense' }" @click="setType('expense')">支出</button>
        <button :class="{ on: filter.type === 'income' }" @click="setType('income')">收入</button>
      </div>
      <input class="input" style="width:130px" v-model="filter.start" placeholder="20260813" @keyup.enter="doFilter" />
      <span class="muted">至</span>
      <input class="input" style="width:130px" v-model="filter.end" placeholder="20260813" @keyup.enter="doFilter" />

      <!-- 分类：自定义 2 列下拉 -->
      <div class="cat-dd" v-if="catOptions.length">
        <button class="select cat-dd-btn" @click="catOpen = !catOpen">
          {{ filter.category || "全部分类" }} <span class="caret">▾</span>
        </button>
        <div v-if="catOpen" class="cat-dd-mask" @click="catOpen = false"></div>
        <div v-if="catOpen" class="cat-dd-panel">
          <button class="cat-opt" :class="{ on: filter.category === '' }" @click="pickCat('')">全部分类</button>
          <button
            v-for="c in catOptions" :key="c.id"
            class="cat-opt" :class="{ on: filter.category === c.name }"
            @click="pickCat(c.name)"
          >{{ c.icon }} {{ c.name }}</button>
        </div>
      </div>

      <select class="select" v-if="facets.attributions.length" v-model="filter.attribution">
        <option value="">全部归属</option>
        <option v-for="a in facets.attributions" :key="a" :value="a">{{ a }}</option>
      </select>
      <input class="input" style="width:150px" v-model.trim="filter.keyword" placeholder="搜索名称" @keyup.enter="doFilter" />

      <div style="flex-basis:100%; height:0"></div>

      <!-- 排序（第二行：金额 / 日期 在 升序降序 之前） -->
      <div class="seg sort-seg">
        <button :class="{ on: sortBy === 'amount' }" @click="sortBy = 'amount'; doFilter()">金额</button>
        <button :class="{ on: sortBy === 'flow_time' }" @click="sortBy = 'flow_time'; doFilter()">日期</button>
      </div>
      <button class="btn btn-sm" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; doFilter()">
        {{ sortOrder === "asc" ? "↑ 升序" : "↓ 降序" }}
      </button>

      <button class="btn btn-primary btn-sm" @click="doFilter">筛选</button>
      <button class="btn btn-sm" @click="reset">重置</button>
      <button class="btn btn-sm" @click="openDup">⚠ 查重</button>
    </div>

    <!-- 汇总 -->
    <div class="row sumbar">
      <span>共 <b>{{ data.total }}</b> 笔</span>
      <span>支出 <b class="expense">¥{{ Number(data.expense).toFixed(2) }}</b></span>
      <span>收入 <b class="income">¥{{ Number(data.income).toFixed(2) }}</b></span>
      <span>结余 <b :class="(data.income-data.expense)>=0?'income':'expense'">¥{{ (data.income - data.expense).toFixed(2) }}</b></span>
    </div>

    <!-- 列表 -->
    <div class="card" style="padding:0;overflow:hidden">
      <div v-if="!data.list.length" class="empty-tip muted">没有符合条件的记录</div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>分类</th><th class="hide-mobile">名称</th><th class="hide-mobile">日期</th><th class="hide-mobile">归属</th><th style="text-align:right">金额</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in data.list" :key="f.id">
            <td><span class="ic">{{ catIcon(f.category) }}</span>{{ f.category }}</td>
            <td class="hide-mobile muted">
              <span v-if="f.source === 'ai'" class="ai-tag" title="AI 记账">AI</span>
              {{ f.description || "—" }}
            </td>
            <td class="hide-mobile muted">{{ dayjs(f.flow_time).format("YYYY-MM-DD") }}</td>
            <td class="hide-mobile">
              <span class="tag" :style="f.attribution_color ? { color: f.attribution_color, borderColor: f.attribution_color } : {}">
                {{ f.attribution || "—" }}
              </span>
            </td>
            <td style="text-align:right" :class="f.type"><b>{{ f.type === "expense" ? "-" : "+" }}{{ Number(f.amount).toFixed(2) }}</b></td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" @click="edit(f)">改</button>
              <button class="btn btn-sm btn-danger" @click="del(f)">删</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="row pager" v-if="data.total > pageSize">
      <button class="btn btn-sm" :disabled="page<=1" @click="page--;load()">上一页</button>
      <span class="muted">{{ page }} / {{ totalPages() }}</span>
      <button class="btn btn-sm" :disabled="page>=totalPages()" @click="page++;load()">下一页</button>
    </div>

    </template>

    <template v-else>
      <div class="row rc-head">
        <div class="muted small">设定每月/每年固定收支，到时间自动生成流水（也可手动点「生成到期记录」）。</div>
        <div class="row" style="gap:8px">
          <button class="btn btn-sm" @click="generateRecur">⟳ 生成到期记录</button>
          <button class="btn btn-primary btn-sm" @click="addRecur">＋ 新增模板</button>
        </div>
      </div>

      <div v-if="!recur.length" class="card empty-tip muted">
        还没有定期记账模板，点「新增模板」添加，例如「每月 1 号 房租 3000」「每年 1 月 1 号 年终奖 20000」。
      </div>

      <div v-else class="recur-grid">
        <div v-for="t in recur" :key="t.id" class="card recur-card">
          <div class="rc-top">
            <span class="tag" :class="t.type">{{ t.type==='expense' ? '支出' : '收入' }}</span>
            <b>{{ store.categories.find(c => c.name === t.category)?.icon || '💰' }} {{ t.category }}</b>
            <span class="rc-amt" :class="t.type">¥{{ Number(t.amount).toFixed(2) }}</span>
          </div>
          <div class="rc-desc muted" v-if="t.description">{{ t.description }}</div>
          <div class="rc-meta muted">
            {{ freqText(t) }} · 下次：{{ t.next_run }}
            <span v-if="t.payment_method"> · {{ t.payment_method }}</span>
          </div>
          <div v-if="t.attribution" class="rc-meta" style="margin-top:4px">
            <span class="rc-owner">归属：{{ t.attribution }}</span>
          </div>
          <div v-if="t.note" class="rc-note muted small">备注：{{ t.note }}</div>
          <div class="row rc-actions">
            <button class="btn btn-sm" @click="editRecur(t)">编辑</button>
            <button class="btn btn-sm btn-danger" @click="delRecur(t)">删除</button>
          </div>
        </div>
      </div>

      <!-- 新增 / 编辑定期记账模板 -->
      <div v-if="showRecurDialog" class="modal-mask" @click.self="showRecurDialog=false">
        <div class="modal" style="max-width:min(560px,96vw)">
          <h3 class="modal-title">{{ recurForm.id ? '编辑定期记账' : '新增定期记账' }}</h3>

          <div class="seg" style="margin-bottom:14px">
            <button :class="{ on: recurForm.type==='expense' }" @click="recurForm.type='expense'">支出</button>
            <button :class="{ on: recurForm.type==='income' }" @click="recurForm.type='income'">收入</button>
          </div>

          <label class="field"><span>分类</span>
            <select class="select" v-model="recurForm.category">
              <option v-for="c in recurCats" :key="c.id" :value="c.name">{{ c.icon }} {{ c.name }}</option>
            </select>
          </label>
          <label class="field"><span>名称（可空，留空用分类名）</span>
            <input class="input" v-model.trim="recurForm.description" placeholder="如：房租 / 工资" />
          </label>
          <label class="field"><span>金额</span>
            <input class="input amount" :class="recurForm.type" type="number" step="0.01" v-model="recurForm.amount" placeholder="0.00" />
          </label>
          <label class="field"><span>周期</span>
            <select class="select" v-model="recurForm.freq">
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
            </select>
          </label>
          <div class="row" style="gap:10px">
            <label class="field" style="flex:1">
              <span>{{ recurForm.freq==='yearly' ? '月份' : '每月几号' }}</span>
              <input class="input" type="number" min="1" :max="recurForm.freq==='yearly' ? 12 : 31" v-model.number="recurForm.month_of_year" v-if="recurForm.freq==='yearly'" />
              <input class="input" type="number" min="1" max="31" v-model.number="recurForm.day_of_month" v-else />
            </label>
            <label class="field" style="flex:1" v-if="recurForm.freq==='yearly'">
              <span>日期（号）</span>
              <input class="input" type="number" min="1" max="31" v-model.number="recurForm.day_of_month" />
            </label>
          </div>
          <label class="field"><span>支付方式（可空）</span>
            <input class="input" v-model.trim="recurForm.payment_method" placeholder="微信 / 支付宝 / 银行卡…" />
          </label>
          <label class="field"><span>归属（默认当前账号，共享账本双方都能看到）</span>
            <select class="select" v-model.number="recurForm.attribution_uid">
              <option :value="null">不指定</option>
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.nickname }}</option>
            </select>
          </label>
          <label class="field"><span>备注（可空）</span>
            <input class="input" v-model.trim="recurForm.note" placeholder="选填" />
          </label>

          <div class="row" style="justify-content:flex-end;margin-top:6px">
            <button class="btn" @click="showRecurDialog=false">取消</button>
            <button class="btn btn-primary" @click="saveRecur">保存</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 查重弹窗 -->
    <div v-if="showDup" class="modal-mask" @click.self="showDup = false">
      <div class="modal" style="max-width:680px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">查重结果</h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showDup = false">关闭</button>
          </div>
        </div>
        <div class="muted small" style="margin-bottom:10px">
          同一天、同类型、同金额、同名称、同分类、同支付方式视为重复。共发现
          <b>{{ dupTotal }}</b> 条可删的重复记录（保留每组最早一条，其余可手动删除）。
        </div>
        <div v-if="dupLoading" class="muted" style="padding:20px 0;text-align:center">加载中…</div>
        <div v-else-if="!dupGroups.length" class="muted empty-tip">没有发现重复记录 🎉</div>
        <div v-else class="dup-list">
          <div v-for="(g, gi) in dupGroups" :key="gi" class="dup-group">
            <div class="dup-key">
              <span class="tag" :class="g.type">{{ g.type === 'expense' ? '支出' : '收入' }}</span>
              <b>{{ g.items[0]?.category }}</b>
              <span class="muted">¥{{ Number(g.items[0]?.amount).toFixed(2) }}</span>
              <span class="muted small">· {{ g.items[0]?.description || '—' }}</span>
              <span class="muted small">· {{ g.items[0]?.flow_time?.slice(0, 10) }}</span>
              <span class="dup-cnt">重复 {{ g.count }} 次</span>
            </div>
            <div v-for="it in g.items" :key="it.id" class="dup-item" :class="{ keep: it.id === g.keepId }">
              <span class="muted small">{{ it.flow_time?.slice(0, 10) }} {{ it.flow_time?.slice(11, 16) }}</span>
              <span class="muted small">{{ it.attribution || '—' }}</span>
              <span class="muted small" v-if="it.id === g.keepId">（保留）</span>
              <button class="btn btn-sm btn-danger" v-if="it.id !== g.keepId" @click="delDupItem(g, it)">删</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <FlowDialog v-model="showDialog" :flow="editing" @saved="load" />
    <SearchFlowsDialog v-model:show="searchOpen" />
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
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filters .input, .filters .select { width: auto; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: 10px; padding: 3px; }
.seg button { border: none; background: transparent; padding: 6px 14px; border-radius: 8px; cursor: pointer; color: var(--text-2); font-size: 13px; }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.type-seg button.on.expense, .type-seg button.on { }
.cat-dd { position: relative; }
.cat-dd-btn { display: inline-flex; align-items: center; gap: 6px; min-width: 130px; cursor: pointer; }
.cat-dd-mask { position: fixed; inset: 0; z-index: 20; }
.cat-dd-panel { position: absolute; top: calc(100% + 6px); left: 0; z-index: 21; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px; box-shadow: var(--shadow); display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 280px; max-height: 280px; overflow: auto; }
.cat-opt { border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 7px 10px; font-size: 13px; cursor: pointer; text-align: left; color: var(--text-2); }
.cat-opt:hover { border-color: var(--primary); color: var(--primary); }
.cat-opt.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.sumbar { margin: 14px 2px; font-size: 14px; color: var(--text-2); gap: 20px; }
.ic { margin-right: 6px; }
.pager { justify-content: center; align-items: center; margin-top: 16px; gap: 14px; }
.empty-tip { text-align: center; padding: 40px 0; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); border-radius: 999px; padding: 7px 18px; font-size: 14px; cursor: pointer; }
.tabs button:hover { border-color: var(--primary); color: var(--primary); }
.tabs button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.rc-head { justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
.recur-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.recur-card { padding: 16px; }
.rc-top { display: flex; align-items: center; gap: 8px; }
.rc-amt { margin-left: auto; font-size: 18px; font-weight: 700; }
.rc-desc { margin-top: 6px; font-size: 14px; }
.rc-meta { margin-top: 6px; font-size: 13px; }
.rc-owner { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 12px; }
.rc-note { margin-top: 4px; }
.rc-actions { margin-top: 12px; gap: 8px; }

.dup-list { max-height: 60vh; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.dup-group { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.dup-key { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.dup-cnt { margin-left: auto; font-size: 12px; color: var(--expense); }
.dup-item { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-top: 1px dashed var(--border); }
.dup-item.keep { opacity: .6; }
</style>
