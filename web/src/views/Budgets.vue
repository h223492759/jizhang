<script setup>
import { ref, onMounted, computed, watch } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
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
// 添加/编辑分类预算时，实时看每个所选分类的已用 / 剩余（可负）
const livePreview = computed(() => {
  const amt = liveAmount.value;
  if (!isFinite(amt)) return [];
  return form.value.categories.map((cat) => {
    const spent = data.value.spentByCategory?.[cat] || 0;
    return { cat, spent, remaining: amt - spent };
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
      <div v-for="c in data.categories" :key="c.category" class="card cat-item">
        <div class="cat-top">
          <b>{{ store.categories.find(x => x.name === c.category)?.icon || '💰' }} {{ c.category }}</b>
          <div>
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
      <div class="modal">
        <h3 class="modal-title">{{ mode === 'total' ? '年度总预算' : (form.categories.length ? '编辑分类预算' : '添加分类预算') }}</h3>

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
          <span>{{ mode === 'total' ? '年度总预算金额' : '每个分类的预算金额' }}</span>
          <input class="input" v-model="form.amount" placeholder="如 1000 或 800+200" />
          <span class="muted small" v-if="isFinite(liveAmount) && form.amount !== String(liveAmount)">
            = {{ fmt(liveAmount) }}（算式结果）
          </span>
        </label>

        <!-- 实时显示每个所选分类的已用 / 剩余（可负） -->
        <div class="preview-box" v-if="mode === 'cat' && livePreview.length">
          <div class="muted small" style="margin-bottom:6px">按当前金额，各分类剩余：</div>
          <div v-for="p in livePreview" :key="p.cat" class="prev-row">
            <span>{{ p.cat }}</span>
            <span class="muted">已用 {{ fmt(p.spent) }}</span>
            <span :class="p.remaining < 0 ? 'expense' : 'income'">
              剩余 {{ p.remaining >= 0 ? fmt(p.remaining) : '-' + fmt(-p.remaining) }}
            </span>
          </div>
        </div>

        <div class="row" style="justify-content:flex-end">
          <button class="btn" @click="showDialog = false">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
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
.cat-item { padding: 16px; }
.cat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
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
.small { font-size: 12px; }
@media (max-width: 900px) { .cat-list { grid-template-columns: repeat(2, 1fr); } }
</style>
