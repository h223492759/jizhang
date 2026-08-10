<script setup>
import { ref, onMounted, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const year = ref(dayjs().year());
const data = ref({ total: { amount: 0, spent: 0, remaining: 0, percent: 0 }, categories: [] });

const showDialog = ref(false);
const form = ref({ category: "", amount: "" });

async function load() {
  const { data: d } = await api.get("/budgets", { params: { year: year.value } });
  data.value = d;
}
onMounted(load);

const usedExpenseCats = computed(() => data.value.categories.map((c) => c.category));
const availableCats = computed(() =>
  store.expenseCats.filter((c) => !usedExpenseCats.value.includes(c.name))
);

function openTotal() {
  form.value = { category: "", amount: data.value.total.amount || "" };
  showDialog.value = true;
}
function openCat() {
  form.value = { category: availableCats.value[0]?.name || "", amount: "" };
  showDialog.value = true;
}
function editCat(c) {
  form.value = { category: c.category, amount: c.amount };
  showDialog.value = true;
}

async function save() {
  if (!(Number(form.value.amount) >= 0)) return toast("请输入金额");
  try {
    await api.post("/budgets", { year: year.value, category: form.value.category, amount: Number(form.value.amount) });
    toast("已保存");
    showDialog.value = false;
    load();
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
function fmt(n) { return "¥" + Number(n||0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}); }
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">预算管理</h2>
      <select class="select" style="width:auto" v-model.number="year" @change="load">
        <option v-for="y in [year-1, year, year+1].filter((v,i,a)=>a.indexOf(v)===i)" :key="y" :value="y">{{ y }}年</option>
      </select>
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
          <span>剩余 <b :class="data.total.remaining>=0?'income':'expense'">{{ fmt(data.total.remaining) }}</b></span>
        </div>
        <div class="bar" style="margin-top:12px"><i :style="{ width: Math.min(100,data.total.percent)+'%', background: barColor(data.total.percent) }"></i></div>
        <div class="muted" style="margin-top:6px;font-size:13px">
          已使用 {{ data.total.percent }}%
          <span v-if="data.total.percent>=100" class="expense"> · ⚠️ 已超支！</span>
          <span v-else-if="data.total.percent>=80" style="color:#f59e0b"> · 接近预算上限</span>
        </div>
      </template>
      <div v-else class="muted" style="padding:8px 0">尚未设置年度总预算，点右上角设置。</div>
    </div>

    <!-- 分类预算 -->
    <div class="head-row" style="margin:20px 0 12px">
      <div class="section-title" style="margin:0">分类预算</div>
      <button class="btn btn-sm btn-primary" :disabled="!availableCats.length" @click="openCat">＋ 添加分类预算</button>
    </div>
    <div class="grid cat-list">
      <div v-for="c in data.categories" :key="c.category" class="card cat-item">
        <div class="cat-top">
          <b>{{ store.categories.find(x=>x.name===c.category)?.icon || '💰' }} {{ c.category }}</b>
          <div>
            <button class="btn btn-sm" @click="editCat(c)">改</button>
            <button class="btn btn-sm btn-danger" @click="delCat(c)">删</button>
          </div>
        </div>
        <div class="bar"><i :style="{ width: Math.min(100,c.percent)+'%', background: barColor(c.percent) }"></i></div>
        <div class="cat-nums muted">
          <span>{{ fmt(c.spent) }} / {{ fmt(c.amount) }}</span>
          <span :class="c.remaining<0?'expense':''">{{ c.remaining>=0 ? '剩'+fmt(c.remaining) : '超'+fmt(-c.remaining) }}</span>
        </div>
      </div>
      <div v-if="!data.categories.length" class="muted empty-tip">还没有分类预算，给常花钱的分类设个上限吧。</div>
    </div>

    <!-- 弹窗 -->
    <div v-if="showDialog" class="modal-mask" @click.self="showDialog=false">
      <div class="modal">
        <h3 class="modal-title">{{ form.category ? '分类预算' : '年度总预算' }}</h3>
        <label class="field" v-if="form.category !== ''">
          <span>分类</span>
          <select class="select" v-model="form.category">
            <option v-for="c in [...(availableCats), ...data.categories.map(x=>({name:x.category,icon:''}))].filter((v,i,a)=>a.findIndex(t=>t.name===v.name)===i)" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ form.category ? form.category+' 年度预算金额' : '年度总预算金额' }}</span>
          <input class="input" type="number" step="1" v-model="form.amount" placeholder="0" />
        </label>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" @click="showDialog=false">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.total-nums { display: flex; gap: 24px; font-size: 15px; flex-wrap: wrap; }
.cat-list { grid-template-columns: repeat(2, 1fr); }
.cat-item { padding: 16px; }
.cat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cat-nums { display: flex; justify-content: space-between; font-size: 13px; margin-top: 8px; }
.empty-tip { grid-column: 1/-1; text-align: center; padding: 30px 0; }
@media (max-width: 720px) { .cat-list { grid-template-columns: 1fr; } }
</style>
