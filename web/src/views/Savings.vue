<script setup>
import { ref, onMounted, computed } from "vue";
import api from "../api.js";
import { toast } from "../toast.js";
import EChart from "../components/EChart.vue";

const data = ref({
  goal: { target: 0, note: "" },
  items: [],
  current: { asset: 0, liability: 0, net: 0, percent: 0, remaining: 0 },
  months: [],
});
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const { data: d } = await api.get("/savings");
    data.value = d;
  } catch (e) { toast(e.message); } finally { loading.value = false; }
}
onMounted(load);

function fmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// 大额简写：1000000 → 100万，便于目标展示
function wan(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000) return (v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + "万";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

// 支持算式输入，如 "50000+2000"
function evalExpr(s) {
  if (s == null || s === "") return NaN;
  const clean = String(s).replace(/[^0-9+\-*/().\s]/g, "");
  if (!clean.trim()) return NaN;
  try {
    const v = Function(`"use strict";return (${clean})`)();
    return typeof v === "number" && isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

// 生效日期：支持整串输入年月日（"20260813" → "2026-08-13"），也接受 "2026-08-13"
// 部分输入（如 "2026-08"）原样保留，便于继续输入
function normAsOf(s) {
  if (!s) return "";
  s = String(s).trim();
  const m = s.replace(/\D/g, "");
  if (m.length === 8) return `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

// ---------------- 设定目标 ----------------
const showGoal = ref(false);
const goalForm = ref({ target: "", note: "" });
function openGoal() {
  goalForm.value = { target: String(data.value.goal.target || ""), note: data.value.goal.note || "" };
  showGoal.value = true;
}
async function saveGoal() {
  const t = evalExpr(goalForm.value.target);
  if (!isFinite(t) || t < 0) return toast("请输入正确的目标金额");
  try {
    await api.put("/savings/goal", { target: t, note: goalForm.value.note });
    toast("目标已保存");
    showGoal.value = false;
    load();
  } catch (e) { toast(e.message); }
}

// ---------------- 资金细则 ----------------
const showItem = ref(false);
const editingItem = ref(null);
const itemForm = ref({ name: "", amount: "", sign: 1, note: "", as_of: "" });
function openAddItem() {
  editingItem.value = null;
  itemForm.value = { name: "", amount: "", sign: 1, note: "", as_of: "" }; // 默认为正
  showItem.value = true;
}
function openEditItem(it) {
  editingItem.value = it;
  itemForm.value = { name: it.name, amount: String(it.amount), sign: it.sign, note: it.note || "", as_of: it.as_of || "" };
  showItem.value = true;
}
async function saveItem() {
  const amt = evalExpr(itemForm.value.amount || "0");
  if (!isFinite(amt) || amt < 0) return toast("金额请填正数，正负用「计入方式」选择");
  if (!itemForm.value.name.trim()) return toast("请填写名称");
  const payload = { name: itemForm.value.name.trim(), amount: amt, sign: itemForm.value.sign, note: itemForm.value.note, as_of: itemForm.value.as_of };
  try {
    if (editingItem.value) await api.put(`/savings/items/${editingItem.value.id}`, payload);
    else await api.post("/savings/items", payload);
    toast("已保存");
    showItem.value = false;
    load();
  } catch (e) { toast(e.message); }
}
async function delItem(it) {
  if (!confirm(`删除资金细则「${it.name}」？`)) return;
  try {
    await api.delete(`/savings/items/${it.id}`);
    toast("已删除");
    load();
  } catch (e) { toast(e.message); }
}

// ---------------- 更新资产和负债（批量填金额） ----------------
const showUpdate = ref(false);
const updForm = ref([]);
function openUpdate() {
  if (!data.value.items.length) return toast("请先新增资金细则");
  updForm.value = data.value.items.map((i) => ({ id: i.id, name: i.name, sign: i.sign, amount: String(i.amount) }));
  showUpdate.value = true;
}
// 弹窗内实时预览本次将得到的净资产
const updPreview = computed(() => {
  let asset = 0, liability = 0;
  for (const it of updForm.value) {
    const v = evalExpr(it.amount || "0");
    if (!isFinite(v)) continue;
    if (it.sign < 0) liability += v; else asset += v;
  }
  return { asset, liability, net: asset - liability };
});
async function saveUpdate() {
  const items = updForm.value
    .map((i) => ({ id: i.id, amount: evalExpr(i.amount || "0") }))
    .filter((i) => isFinite(i.amount) && i.amount >= 0);
  if (!items.length) return toast("没有可保存的金额");
  try {
    await api.post("/savings/items/bulk", { items });
    toast("资产已更新，本月记录已刷新");
    showUpdate.value = false;
    load();
  } catch (e) { toast(e.message); }
}

async function delHistory(m) {
  if (!confirm(`删除 ${m.month} 的历史记录？`)) return;
  try {
    await api.delete(`/savings/history/${m.ymd}`);
    toast("已删除");
    load();
  } catch (e) { toast(e.message); }
}

// ---------------- 历史月柱状图（每月最后一次 vs 目标线） ----------------
const chartOpt = computed(() => {
  const ms = data.value.months || [];
  const target = Number(data.value.goal.target) || 0;
  return {
    tooltip: {
      trigger: "axis",
      formatter: (ps) => {
        const m = ms[ps[0].dataIndex];
        if (!m) return "";
        const gap = target - Number(m.net);
        return `${m.month}（更新于 ${m.ymd}）<br/>
          净资产 <b>${fmt(m.net)}</b><br/>
          资产 ${fmt(m.asset)}｜负债 ${fmt(m.liability)}<br/>
          ${target > 0 ? (gap > 0 ? `距目标还差 <b>${fmt(gap)}</b>` : `已超目标 <b>${fmt(-gap)}</b>`) : ""}`;
      },
    },
    legend: { data: target > 0 ? ["净资产", "目标"] : ["净资产"], top: 0 },
    grid: { left: 68, right: 20, top: 34, bottom: 28 },
    xAxis: { type: "category", data: ms.map((m) => m.month.slice(2)) },
    yAxis: { type: "value" },
    series: [
      {
        name: "净资产",
        type: "bar",
        data: ms.map((m) => Number(m.net)),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          // 达标绿、未达标主色、负数红
          color: (p) => (Number(p.data) < 0 ? "#ef4444" : target > 0 && Number(p.data) >= target ? "#10b981" : "#6366f1"),
        },
        markLine: target > 0 ? {
          silent: true, symbol: "none",
          data: [{ yAxis: target, label: { formatter: `目标 ${wan(target)}`, position: "insideEndTop" }, lineStyle: { color: "#f59e0b", type: "dashed", width: 2 } }],
        } : undefined,
      },
      ...(target > 0 ? [{ name: "目标", type: "line", data: ms.map(() => target), symbol: "none", lineStyle: { color: "#f59e0b", type: "dashed", width: 2 }, itemStyle: { color: "#f59e0b" } }] : []),
    ],
  };
});

const cur = computed(() => data.value.current);
const target = computed(() => Number(data.value.goal.target) || 0);
const pctClamped = computed(() => Math.max(0, Math.min(100, cur.value.percent)));
// 历史表倒序展示（最近的月在上面）
const monthsDesc = computed(() => [...(data.value.months || [])].reverse());
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">存款目标</h2>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" @click="openGoal">{{ target ? '修改目标' : '设定目标' }}</button>
        <button class="btn btn-sm btn-primary" @click="openUpdate">更新资产和负债</button>
      </div>
    </div>

    <!-- 目标进度 -->
    <div class="card">
      <div class="goal-head">
        <div>
          <div class="muted">存款目标</div>
          <div class="goal-num">{{ target ? wan(target) : '未设定' }}</div>
          <div class="muted small" v-if="data.goal.note">{{ data.goal.note }}</div>
        </div>
        <div class="goal-now">
          <div class="muted">当前净资产</div>
          <div class="goal-net" :class="cur.net >= 0 ? 'income' : 'expense'">{{ fmt(cur.net) }}</div>
          <div class="muted small">资产 {{ fmt(cur.asset) }}｜负债 {{ fmt(cur.liability) }}</div>
        </div>
      </div>
      <template v-if="target">
        <div class="bar" style="margin-top:14px;height:10px">
          <i :style="{ width: pctClamped + '%', background: cur.net >= target ? 'var(--income)' : 'var(--primary)' }"></i>
        </div>
        <div class="goal-foot">
          <span>已达成 <b>{{ cur.percent }}%</b></span>
          <span v-if="cur.remaining > 0">距目标还差 <b class="expense">{{ fmt(cur.remaining) }}</b></span>
          <span v-else class="income"><b>🎉 已达成目标！超出 {{ fmt(-cur.remaining) }}</b></span>
        </div>
      </template>
      <div v-else class="muted" style="margin-top:10px">还没有设定目标，点右上角「设定目标」，例如 100 万。</div>
    </div>

    <!-- 资金细则 -->
    <div class="head-row" style="margin:20px 0 12px">
      <div class="section-title" style="margin:0">资金细则（现金 / 微信余额 / 信用卡账单…）</div>
      <button class="btn btn-sm btn-primary" @click="openAddItem">＋ 新增细则</button>
    </div>
    <div class="grid item-grid">
      <div v-for="it in data.items" :key="it.id" class="card item" :class="it.sign < 0 ? 'neg' : 'pos'">
        <div class="item-top">
          <b>{{ it.name }}</b>
          <span class="tag" :class="it.sign < 0 ? 'tag-neg' : 'tag-pos'">{{ it.sign < 0 ? '负债 −' : '资产 +' }}</span>
        </div>
        <div class="item-amt" :class="it.sign < 0 ? 'expense' : ''">
          {{ it.sign < 0 ? '−' : '' }}{{ fmt(it.amount) }}
        </div>
        <div class="muted small" v-if="it.note">{{ it.note }}</div>
        <div class="item-foot">
          <span class="muted small">{{ it.as_of ? '生效 ' + it.as_of : '更新 ' + (it.updated_at || '').slice(0, 10) }}</span>
          <span>
            <button class="btn btn-sm" @click="openEditItem(it)">改</button>
            <button class="btn btn-sm btn-danger" @click="delItem(it)">删</button>
          </span>
        </div>
      </div>
      <div v-if="!data.items.length" class="muted empty-tip">
        还没有资金细则。点「＋ 新增细则」，把现金、微信余额、信用卡账单等逐项加进来（默认计为正，信用卡这类选「负债」）。
      </div>
    </div>

    <!-- 历史月柱状图 -->
    <div class="card" style="margin-top:20px" v-if="data.months.length">
      <div class="section-title">历史月净资产（每月只取该月最后一次更新）</div>
      <EChart :option="chartOpt" height="340px" />
    </div>

    <!-- 历史月表格 -->
    <div class="card" style="margin-top:16px" v-if="data.months.length">
      <div class="section-title">历史记录</div>
      <table class="tbl his-tbl">
        <thead>
          <tr>
            <th class="c-m">月份</th>
            <th class="c-d hide-mobile">最后更新</th>
            <th class="num">资产</th>
            <th class="num">负债</th>
            <th class="num">净资产</th>
            <th class="num" v-if="target">距目标</th>
            <th class="c-op hide-mobile">操作人</th>
            <th class="c-act"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in monthsDesc" :key="m.ymd">
            <td class="c-m"><b>{{ m.month }}</b></td>
            <td class="c-d muted hide-mobile">{{ m.ymd }}</td>
            <td class="num income">{{ fmt(m.asset) }}</td>
            <td class="num expense">{{ m.liability ? fmt(m.liability) : '—' }}</td>
            <td class="num"><b :class="m.net >= 0 ? 'income' : 'expense'">{{ fmt(m.net) }}</b></td>
            <td class="num" v-if="target">
              <span v-if="target - m.net > 0" class="muted">差 {{ fmt(target - m.net) }}</span>
              <span v-else class="income">超 {{ fmt(m.net - target) }}</span>
            </td>
            <td class="c-op muted hide-mobile">{{ m.op_user || '—' }}</td>
            <td class="c-act"><button class="btn btn-sm btn-danger" @click="delHistory(m)">删</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 设定目标弹窗 -->
    <div v-if="showGoal" class="modal-mask" @click.self="showGoal = false">
      <div class="modal" style="max-width:520px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">设定存款目标</h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showGoal = false">取消</button>
            <button class="btn btn-primary" @click="saveGoal">保存</button>
          </div>
        </div>
        <label class="field">
          <span>目标金额（支持算式，如 1000000 或 100*10000）</span>
          <input class="input" v-model="goalForm.target" placeholder="如 1000000" />
          <span class="muted small" v-if="isFinite(evalExpr(goalForm.target))">= {{ fmt(evalExpr(goalForm.target)) }}（{{ wan(evalExpr(goalForm.target)) }}）</span>
        </label>
        <label class="field">
          <span>备注（可选）</span>
          <input class="input" v-model="goalForm.note" placeholder="如 三年内存到 100 万" />
        </label>
      </div>
    </div>

    <!-- 新增/编辑细则弹窗 -->
    <div v-if="showItem" class="modal-mask" @click.self="showItem = false">
      <div class="modal" style="max-width:560px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">{{ editingItem ? '编辑资金细则' : '新增资金细则' }}</h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showItem = false">取消</button>
            <button class="btn btn-primary" @click="saveItem">保存</button>
          </div>
        </div>
        <label class="field">
          <span>名称</span>
          <input class="input" v-model="itemForm.name" placeholder="如 现金 / 微信余额 / 信用卡账单" />
        </label>
        <div class="field">
          <span>计入方式（默认为正）</span>
          <div class="row" style="gap:8px">
            <button class="sw" :class="{ on: itemForm.sign === 1 }" @click="itemForm.sign = 1">＋ 资产（正）</button>
            <button class="sw neg" :class="{ on: itemForm.sign === -1 }" @click="itemForm.sign = -1">− 负债（负）</button>
          </div>
        </div>
        <label class="field">
          <span>金额（填正数，正负由上面选择）</span>
          <input class="input" v-model="itemForm.amount" placeholder="如 50000 或 30000+20000" />
          <span class="muted small" v-if="isFinite(evalExpr(itemForm.amount))">
            计入 {{ itemForm.sign < 0 ? '−' : '+' }}{{ fmt(evalExpr(itemForm.amount)) }}
          </span>
        </label>
        <label class="field">
          <span>备注（可选）</span>
          <input class="input" v-model="itemForm.note" placeholder="如 招行卡" />
        </label>
        <label class="field">
          <span>生效日期（可选：填历史日期可回填该月资产，留空视为当前）</span>
          <input class="input" type="text" :value="itemForm.as_of" @input="e => itemForm.as_of = normAsOf(e.target.value)" style="width:200px" placeholder="如 20260813 或 2026-08-13" />
        </label>
      </div>
    </div>

    <!-- 更新资产和负债弹窗 -->
    <div v-if="showUpdate" class="modal-mask" @click.self="showUpdate = false">
      <div class="modal" style="max-width:640px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">更新资产和负债</h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showUpdate = false">取消</button>
            <button class="btn btn-primary" @click="saveUpdate">保存</button>
          </div>
        </div>
        <div class="muted small" style="margin-bottom:10px">
          不用管时间，随时更新即可。同一个月多次更新，历史里只保留该月最后一次的数据。
        </div>
        <div class="upd-list">
          <div v-for="it in updForm" :key="it.id" class="upd-row">
            <span class="upd-name">
              {{ it.name }}
              <em :class="it.sign < 0 ? 'expense' : 'income'">{{ it.sign < 0 ? '负债' : '资产' }}</em>
            </span>
            <input class="input" v-model="it.amount" placeholder="0" />
          </div>
        </div>
        <div class="preview-box">
          <div class="prev-row"><span>资产合计</span><b class="income">{{ fmt(updPreview.asset) }}</b></div>
          <div class="prev-row"><span>负债合计</span><b class="expense">{{ fmt(updPreview.liability) }}</b></div>
          <div class="prev-row"><span>净资产</span><b :class="updPreview.net >= 0 ? 'income' : 'expense'">{{ fmt(updPreview.net) }}</b></div>
          <div class="prev-row" v-if="target">
            <span>距目标</span>
            <b :class="target - updPreview.net > 0 ? '' : 'income'">
              {{ target - updPreview.net > 0 ? '还差 ' + fmt(target - updPreview.net) : '已超 ' + fmt(updPreview.net - target) }}
            </b>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.goal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.goal-num { font-size: 28px; font-weight: 800; margin-top: 4px; color: var(--primary); }
.goal-now { text-align: right; }
.goal-net { font-size: 24px; font-weight: 800; margin-top: 4px; }
.goal-foot { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; font-size: 14px; }
.small { font-size: 12px; }

.item-grid { grid-template-columns: repeat(4, 1fr); }
.item { padding: 14px; }
.item.neg { border-left: 3px solid var(--expense); }
.item.pos { border-left: 3px solid var(--income); }
.item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.item-amt { font-size: 19px; font-weight: 700; margin: 8px 0 4px; }
.item-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.tag-pos { color: var(--income); }
.tag-neg { color: var(--expense); }
.empty-tip { grid-column: 1/-1; text-align: center; padding: 26px 0; }

.his-tbl .c-m { width: 100px; white-space: nowrap; }
.his-tbl .c-d { width: 110px; white-space: nowrap; }
.his-tbl .c-op { width: 90px; }
.his-tbl .c-act { width: 50px; text-align: right; }
.his-tbl .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 16px; flex-wrap: wrap; }
.sw { flex: 1; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); border-radius: 10px; padding: 10px; font-size: 14px; cursor: pointer; }
.sw.on { border-color: var(--income); background: var(--primary-soft); color: var(--income); font-weight: 600; }
.sw.neg.on { border-color: var(--expense); color: var(--expense); }

.upd-list { max-height: 46vh; overflow: auto; margin-bottom: 12px; }
.upd-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.upd-name { flex: 1; font-size: 14px; }
.upd-name em { font-style: normal; font-size: 11px; margin-left: 6px; }
.upd-row .input { width: 190px; text-align: right; }
.preview-box { padding: 12px; background: var(--surface-2); border-radius: 10px; }
.prev-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }

@media (max-width: 1000px) { .item-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px) {
  .item-grid { grid-template-columns: 1fr; }
  .goal-now { text-align: left; }
  .upd-row .input { width: 130px; }
}
</style>
