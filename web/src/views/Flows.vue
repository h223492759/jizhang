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

async function load() {
  const { data: d } = await api.get("/flows", {
    params: { ...filter.value, page: page.value, pageSize },
  });
  data.value = d;
}
async function init() {
  const { data: f } = await api.get("/stats/facets");
  facets.value = f;
  await load();
}
onMounted(init);

function doFilter() {
  page.value = 1;
  load();
}
function reset() {
  filter.value = { start: "", end: "", type: "", category: "", attribution: "", keyword: "" };
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
      <input class="input" type="date" v-model="filter.start" />
      <span class="muted">至</span>
      <input class="input" type="date" v-model="filter.end" />
      <select class="select" v-model="filter.type">
        <option value="">全部类型</option>
        <option value="expense">支出</option>
        <option value="income">收入</option>
      </select>
      <select class="select" v-model="filter.category">
        <option value="">全部分类</option>
        <option v-for="c in store.categories" :key="c.id" :value="c.name">{{ c.icon }} {{ c.name }}</option>
      </select>
      <select class="select" v-if="facets.attributions.length" v-model="filter.attribution">
        <option value="">全部归属</option>
        <option v-for="a in facets.attributions" :key="a" :value="a">{{ a }}</option>
      </select>
      <input class="input" style="width:150px" v-model.trim="filter.keyword" placeholder="搜索名称" @keyup.enter="doFilter" />
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
            <th>分类</th><th class="hide-mobile">名称</th><th class="hide-mobile">时间</th><th class="hide-mobile">归属</th><th style="text-align:right">金额</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in data.list" :key="f.id">
            <td><span class="ic">{{ catIcon(f.category) }}</span>{{ f.category }}</td>
            <td class="hide-mobile muted">{{ f.description || "—" }}</td>
            <td class="hide-mobile muted">{{ dayjs(f.flow_time).format("YYYY-MM-DD HH:mm") }}</td>
            <td class="hide-mobile"><span class="tag">{{ f.attribution || "—" }}</span></td>
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
.filters .input[type=date] { width: 150px; }
.sumbar { margin: 14px 2px; font-size: 14px; color: var(--text-2); gap: 20px; }
.ic { margin-right: 6px; }
.pager { justify-content: center; align-items: center; margin-top: 16px; gap: 14px; }
.empty-tip { text-align: center; padding: 40px 0; }
</style>
