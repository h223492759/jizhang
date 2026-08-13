<script setup>
import { ref, onMounted } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import FlowDialog from "../components/FlowDialog.vue";

const store = useStore();
const filter = ref({ start: "", end: "", type: "", category: "", attribution: "", keyword: "" });
const data = ref({ list: [], total: 0, expense: 0, income: 0 });
const page = ref(1);
const pageSize = 20;
const facets = ref({ years: [], attributions: [] });
const showDialog = ref(false);
const editing = ref(null);

// 排序：金额 / 日期，升序 / 降序
const sortBy = ref("flow_time");
const sortOrder = ref("desc");
// 分类下拉（按当前类型过滤，2 列展示完整）
const catOpen = ref(false);

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
  const { data: d } = await api.get("/flows", { params });
  data.value = d;
}
async function init() {
  const { data: f } = await api.get("/stats/facets");
  facets.value = f;
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
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">流水记录</h2>
      <button class="btn btn-primary" @click="add">＋ 记一笔</button>
    </div>

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

      <!-- 排序 -->
      <div class="seg sort-seg">
        <button :class="{ on: sortBy === 'amount' }" @click="sortBy = 'amount'; doFilter()">金额</button>
        <button :class="{ on: sortBy === 'flow_time' }" @click="sortBy = 'flow_time'; doFilter()">日期</button>
      </div>
      <button class="btn btn-sm" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'; doFilter()">
        {{ sortOrder === "asc" ? "↑ 升序" : "↓ 降序" }}
      </button>

      <button class="btn btn-primary btn-sm" @click="doFilter">筛选</button>
      <button class="btn btn-sm" @click="reset">重置</button>
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
            <td class="hide-mobile muted">{{ f.description || "—" }}</td>
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

    <FlowDialog v-model="showDialog" :flow="editing" @saved="load" />
  </div>
</template>

<style scoped>
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
</style>
