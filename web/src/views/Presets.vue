<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const loading = ref(false);
const types = ["expense", "income"];
const TYPE_META = {
  expense: { label: "支出", icon: "💸" },
  income: { label: "收入", icon: "💰" },
};

// 支出 / 收入 各自独立的一组数据，分别展示
const sections = reactive({
  expense: { presets: [], frequent: [], recent: [] },
  income: { presets: [], frequent: [], recent: [] },
});
const forms = reactive({ expense: blank(), income: blank() });
const editingId = reactive({ expense: null, income: null });

function blank() {
  return { name: "", category: "", payment_method: "", amount: "" };
}
function catsOf(type) {
  return store.categories.filter((c) => c.type === type);
}

async function load() {
  loading.value = true;
  try {
    const [ex, inc] = await Promise.all([
      api.get("/presets", { params: { type: "expense", limit: 30 } }),
      api.get("/presets", { params: { type: "income", limit: 30 } }),
    ]);
    sections.expense = ex.data;
    sections.income = inc.data;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function submit(type) {
  const f = forms[type];
  if (!f.name.trim()) return toast("请填写常用名称");
  const payload = {
    name: f.name.trim(),
    type,
    category: f.category || "",
    payment_method: f.payment_method || "",
    amount: Number(f.amount) || 0,
  };
  try {
    if (editingId[type]) {
      await api.put(`/presets/${editingId[type]}`, payload);
      toast("已更新");
    } else {
      await api.post("/presets", payload);
      toast("已添加");
    }
    forms[type] = blank();
    editingId[type] = null;
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function edit(type, p) {
  editingId[type] = p.id;
  forms[type] = {
    name: p.name,
    category: p.category,
    payment_method: p.payment_method,
    amount: p.amount || "",
  };
}
function cancelEdit(type) {
  editingId[type] = null;
  forms[type] = blank();
}

async function remove(type, p) {
  if (!confirm(`删除常用名称「${p.name}」？（不会影响已有账单）`)) return;
  try {
    await api.delete(`/presets/${p.id}`);
    if (editingId[type] === p.id) cancelEdit(type);
    toast("已删除");
    await load();
  } catch (e) {
    toast(e.message);
  }
}

// 按「分类」二次分组：餐饮一组、日用一组……组内合并 常用/高频/最近 并去重。
const grouped = computed(() => {
  const out = {};
  const push = (type, item, source) => {
    const cat = item.category || "未分类";
    out[type] = out[type] || {};
    const g = (out[type][cat] = out[type][cat] || { category: cat, seen: new Set(), items: [] });
    if (g.seen.has(item.name)) return;
    g.seen.add(item.name);
    g.items.push({ name: item.name, category: cat, source, id: item.id, count: item.count, payment_method: item.payment_method, amount: item.amount });
  };
  for (const t of types) {
    sections[t].presets.forEach((p) => push(t, p, "preset"));
    sections[t].frequent.forEach((p) => push(t, p, "freq"));
    sections[t].recent.forEach((p) => push(t, p, "recent"));
  }
  const res = {};
  for (const t of types) {
    const arr = Object.values(out[t] || {}).map((g) => ({
      category: g.category,
      weight: g.items.reduce((s, it) => s + (it.count || 1), 0),
      items: g.items,
    }));
    arr.sort((a, b) => {
      if (a.category === "未分类") return 1;
      if (b.category === "未分类") return -1;
      return b.weight - a.weight;
    });
    res[t] = arr;
  }
  return res;
});

function presetByName(type, name) {
  return sections[type].presets.find((p) => p.name === name);
}
function onChipClick(type, it) {
  if (it.source === "preset") unpin(type, it); // 再次点击取消收藏
  else pin(type, it); // 高频/最近 → 收藏
}
async function unpin(type, it) {
  const p = presetByName(type, it.name);
  if (!p) return;
  try {
    await api.delete(`/presets/${p.id}`);
    toast("已取消收藏");
    await load();
  } catch (e) { toast(e.message); }
}
function presetTip(it) {
  const parts = [];
  if (it.payment_method) parts.push(it.payment_method);
  if (it.amount > 0) parts.push("¥" + it.amount);
  return parts.join("  ");
}

// 从「高频 / 最近」一键收藏为常用
async function pin(type, item) {
  try {
    await api.post("/presets", {
      name: item.name,
      type,
      category: item.category || "",
      payment_method: item.payment_method || "",
    });
    toast("已加入常用");
    await load();
  } catch (e) {
    toast(e.message);
  }
}
</script>

<template>
  <div>
    <h2 class="page-title">常用名称</h2>

    <div class="card">
      <p class="muted" style="font-size: 13px; margin: 0 0 8px; line-height: 1.7">
        在这里预设常用的名称，<b>记一笔时会按「支出 / 收入」分别显示成可点击的标签</b>，点一下就填好名称，还能自动带出分类、支付方式和常用金额。<br />
        常用名称会<b>按「分类」再分组</b>——「餐饮」里的常用名（如午饭、奶茶）和「日用」里的（如纸巾、洗衣液）是分开统计的，互不影响。<br />
        <b>点击即可收藏（★）</b>，再次点击已收藏的名称则<b>取消收藏</b>。<br />
        下方的「高频」和「最近」由系统根据你的记账习惯自动统计，无需维护，越用越准。
      </p>
    </div>

    <div class="cols">
      <div class="card" v-for="type in types" :key="type">
        <div class="section-title">
          {{ TYPE_META[type].icon }} {{ TYPE_META[type].label }} · 常用名称
        </div>

        <!-- 添加 / 编辑表单 -->
        <div class="row form-row">
          <input class="input" style="flex: 2; min-width: 130px" v-model.trim="forms[type].name" :placeholder="`${TYPE_META[type].label}常用名称，如：${type === 'expense' ? '早饭 / 地铁通勤' : '工资 / 红包'}`" />
          <select class="select" style="flex: 1; min-width: 100px" v-model="forms[type].category">
            <option value="">默认分类（可选）</option>
            <option v-for="c in catsOf(type)" :key="c.id" :value="c.name">{{ c.icon }} {{ c.name }}</option>
          </select>
          <input class="input" style="flex: 1; min-width: 100px" v-model.trim="forms[type].payment_method" placeholder="支付方式" />
          <input class="input" style="flex: 1; min-width: 80px" type="number" step="0.01" v-model="forms[type].amount" placeholder="金额" />
          <button class="btn btn-primary" @click="submit(type)">{{ editingId[type] ? "保存修改" : "+ 添加" }}</button>
          <button class="btn" v-if="editingId[type]" @click="cancelEdit(type)">取消</button>
        </div>

        <!-- 按分类分组的常用名称：餐饮一组、日用一组…… -->
        <div class="section-sub">常用名称（按分类分组，餐饮 / 日用 等各自独立）</div>
        <div v-if="grouped[type].length" class="cat-groups">
          <div class="cat-group" v-for="g in grouped[type]" :key="g.category">
            <div class="cat-group-head">
              <span class="cat-group-name">{{ g.category }}</span>
              <span class="muted small">{{ g.items.length }} 个</span>
            </div>
            <div class="chips">
              <button
                v-for="it in g.items" :key="(it.source === 'preset' ? 'p' : it.source === 'freq' ? 'f' : 'r') + it.name"
                class="chip" :class="{ 'chip-pin': it.source === 'preset' }"
                :title="presetTip(it)"
                @click="onChipClick(type, it)"
              >
                <em v-if="it.source === 'preset'" class="star">★</em>{{ it.name }}
                <i v-if="it.source === 'freq'">×{{ it.count }}</i>
                <em v-else-if="it.source === 'recent'" class="star2">☆</em>
                <i v-if="it.source === 'preset'" class="x" @click.stop="remove(type, presetByName(type, it.name))">×</i>
              </button>
            </div>
          </div>
        </div>
        <div v-else class="muted small-pad">{{ loading ? "加载中…" : "还没有常用名称，记几笔账后会按分类自动汇总" }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; align-items: start; }
.section-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
.section-sub { font-size: 13px; font-weight: 600; color: var(--text-2); margin: 18px 0 8px; }
.form-row { align-items: center; flex-wrap: wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2);
  border-radius: 15px; padding: 6px 12px; font-size: 13px; cursor: pointer; position: relative;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip i { font-style: normal; opacity: .5; margin-left: 5px; font-size: 11.5px; }
.chip em { font-style: normal; margin-left: 6px; opacity: .6; }
.chip .star { color: var(--warning, #f59f00); margin: 0 4px 0 0; opacity: 1; }
.chip .star2 { color: var(--text-2); }
.chip .x { position: absolute; top: -7px; right: -7px; background: var(--expense, #ef4444); color: #fff; border-radius: 50%; width: 16px; height: 16px; line-height: 16px; text-align: center; font-size: 11px; font-style: normal; opacity: .9; }
.chip .x:hover { opacity: 1; }
.chip-pin { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.small-pad { padding: 4px 0 2px; }
.cat-groups { display: flex; flex-direction: column; gap: 14px; margin-top: 4px; }
.cat-group { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: var(--surface-2); }
.cat-group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.cat-group-name { font-weight: 700; font-size: 13.5px; color: var(--text); }
.cat-group-name::before { content: "📂 "; }
.small { font-size: 12px; }
@media (max-width: 900px) {
  .cols { grid-template-columns: 1fr; }
  .hide-mobile { display: none; }
}
</style>
