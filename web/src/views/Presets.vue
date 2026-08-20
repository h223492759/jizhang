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

// 三态模型：
//   presets = 已收藏（★），存在 presets 表
//   frequent = 未收藏建议（×N），读物化表 preset_suggest（保存后/每日重建）
//   hidden  = 已取消显示（点 × 进入，置底灰色展示，可恢复）
// 点击 chip：已收藏 ↔ 未收藏 切换；右上角 ×：取消显示。隐藏的点击 = 恢复。
const sections = reactive({
  expense: { presets: [], frequent: [], recent: [] },
  income: { presets: [], frequent: [], recent: [] },
});
const forms = reactive({ expense: blank(), income: blank() });

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
      api.get("/presets", { params: { type: "expense", limit: 500 } }),
      api.get("/presets", { params: { type: "income", limit: 500 } }),
    ]);
    sections.expense = ex.data;
    sections.income = inc.data;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}
// 静默刷新：不切 loading 标志（避免"加载中"闪烁），用于 chip 点击后的局部更新
async function silentReload() {
  try {
    const [ex, inc] = await Promise.all([
      api.get("/presets", { params: { type: "expense", limit: 500 } }),
      api.get("/presets", { params: { type: "income", limit: 500 } }),
    ]);
    sections.expense = ex.data;
    sections.income = inc.data;
  } catch (e) { toast(e.message); }
}
onMounted(load);

async function submit(type) {
  const f = forms[type];
  if (!f.name.trim()) return toast("请填写常用名称");
  try {
    await api.post("/presets", {
      name: f.name.trim(),
      type,
      category: f.category || "",
      payment_method: f.payment_method || "",
      amount: Number(f.amount) || 0,
    });
    toast("已加入收藏");
    forms[type] = blank();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

// 一批量取消收藏：把某类型下所有 ★ 全部移回 ×N 未收藏建议区
// （不是删除，流水不受影响）。用于一次性清理历史扫描残留。
async function unpinAll(type) {
  const count = sections[type].presets.length;
  if (count === 0) return toast("该类型下没有已收藏名称");
  if (!confirm(
    `确认取消「${TYPE_META[type].label}」下全部 ${count} 个已收藏名称？\n这些名称会移回「未收藏建议」区（不会删除任何流水），需要时再单独点 ★ 即可重新加入收藏。`
  )) return;
  try {
    await api.delete("/presets/all", { params: { type } });
    toast("已全部取消收藏");
    await silentReload();
  } catch (e) {
    toast(e.message);
  }
}

// 点击 chip 切换状态（乐观更新 + 静默刷新，避免"加载中"闪烁）
async function toggle(type, it) {
  // 乐观更新：先在本地把 chip 移到目标状态
  if (it.source === "preset") {
    // ★ → ×N：从 presets 移除，加到 frequent
    sections[type].presets = sections[type].presets.filter((p) => p.id !== it.id);
    sections[type].frequent = [...sections[type].frequent, {
      name: it.name, count: 1, category: it.category, payment_method: it.payment_method, avg_amount: it.amount || 0,
    }];
    toast("已取消收藏");
  } else {
    // ×N → ★：从 frequent 移除，加到 presets（id 占位，刷新后会更新）
    sections[type].frequent = sections[type].frequent.filter((p) => p.name !== it.name);
    const maxSort = sections[type].presets.reduce((m, p) => Math.max(m, p.sort || 0), 0);
    sections[type].presets = [...sections[type].presets, {
      id: 0, name: it.name, type, category: it.category, payment_method: it.payment_method, amount: it.avg_amount || 0, sort: maxSort + 1,
    }];
    toast("已加入收藏");
  }
  // 静默刷新拿到真实数据（count / id）
  try {
    if (it.source === "preset") {
      await api.delete("/presets/" + it.id);
    } else {
      await api.post("/presets", {
        name: it.name, type,
        category: it.category || "",
        payment_method: it.payment_method || "",
      });
    }
    silentReload();
  } catch (e) { toast(e.message); }
}

// 第三态：取消显示（隐藏），进入置底「已取消显示」区（乐观更新 + 静默刷新）
async function hide(type, it) {
  // 乐观更新：从 presets/frequent 移除，加到 hidden
  if (it.source === "preset") sections[type].presets = sections[type].presets.filter((p) => p.id !== it.id);
  else sections[type].frequent = sections[type].frequent.filter((p) => p.name !== it.name);
  if (!sections[type].hidden) sections[type].hidden = [];
  if (!sections[type].hidden.some((h) => h.name === it.name)) {
    sections[type].hidden = [...sections[type].hidden, { name: it.name, category: it.category || "" }];
  }
  toast("已取消显示");
  try {
    await api.post("/presets/hide", { name: it.name, type });
    silentReload();
  } catch (e) { toast(e.message); }
}

// 恢复显示：从隐藏区移除（乐观更新 + 静默刷新）
async function restore(type, h) {
  // 乐观更新：从 hidden 移除
  if (sections[type].hidden) {
    sections[type].hidden = sections[type].hidden.filter((x) => x.name !== h.name);
  }
  toast("已恢复显示");
  try {
    await api.post("/presets/unhide", { name: h.name, type });
    silentReload();
  } catch (e) { toast(e.message); }
}

// 立即刷新建议：手动触发当前账本的 preset_suggest 重建（正常由流水保存/每日扫描触发）
const rescanning = ref(false);
async function rescan() {
  rescanning.value = true;
  try {
    await api.post("/presets/rescan");
    await load();
    toast("已刷新建议");
  } catch (e) {
    toast(e.message);
  } finally {
    rescanning.value = false;
  }
}

// 扫描流水 → 重建未收藏建议（×N）。把流水里所有名称（出现 ≥1 次）重新列进
// 「未收藏建议」区并显示频次；★ 收藏 / 取消显示仍须手动，扫描绝不自动收藏。
// 用于恢复"常用名称不见"：只要名称还在流水里，扫一遍就全部回来了。
const scanning = ref(false);
async function scan() {
  if (
    !confirm(
      "将扫描本账本所有流水，把所有出现过的名称重建到「未收藏建议」区（×N，带频次）？\n已收藏（★）和已取消显示的不受影响；需要收藏的名称之后请手动点 ★。"
    )
  )
    return;
  scanning.value = true;
  try {
    const { data } = await api.post("/presets/scan");
    await load();
    alert(
      "扫描完成：\n流水中共发现 " +
        data.scanned +
        " 个名称，已全部显示在下方「未收藏建议」区\n当前已收藏 " +
        data.pinned +
        " 个、已取消显示 " +
        data.hidden +
        " 个\n需要收藏的名称，点 ★ 即可加入。"
    );
  } catch (e) {
    toast(e.message);
  } finally {
    scanning.value = false;
  }
}

function presetTip(it) {
  const parts = [];
  if (it.payment_method) parts.push(it.payment_method);
  if (it.amount > 0) parts.push("¥" + it.amount);
  return parts.join("  ");
}

// 按「分类」分组，每组内同时包含已收藏（★）、未收藏（×N）和已取消显示：
// 已收藏排前，未收藏按频次降序；同名已存在则跳过（防重复）。
// 已取消显示（hidden）放到每个分类组内部末尾，用细分隔线分开 —— 跟着分类走。
const grouped = computed(() => {
  const out = {};
  const push = (type, item, source) => {
    const cat = item.category || "未分类";
    out[type] = out[type] || {};
    const grp = (out[type][cat] = out[type][cat] || { category: cat, items: [], hidden: [] });
    if (source === "hidden") {
      if (grp.hidden.some((x) => x.name === item.name)) return;
      grp.hidden.push({ name: item.name, category: cat });
    } else {
      if (grp.items.some((x) => x.name === item.name)) return;
      grp.items.push({
        name: item.name,
        category: cat,
        source,
        id: item.id,
        count: item.count,
        payment_method: item.payment_method,
        amount: item.amount,
      });
    }
  };
  for (const t of types) {
    sections[t].presets.forEach((p) => push(t, p, "preset"));
    sections[t].frequent.forEach((p) => push(t, p, "freq"));
    (sections[t].hidden || []).forEach((h) => push(t, h, "hidden"));
  }
  const res = {};
  for (const t of types) {
    const arr = Object.values(out[t] || {});
    arr.forEach((g) => {
      g.items.sort((a, b) => {
        if (a.source !== b.source) return a.source === "preset" ? -1 : 1;
        return (b.count || 0) - (a.count || 0);
      });
    });
    const orderMap = {};
    store.categories.forEach((c, i) => { orderMap[c.name] = i; });
    arr.sort((a, b) => {
      if (a.category === "未分类") return 1;
      if (b.category === "未分类") return -1;
      return (orderMap[a.category] ?? 1e9) - (orderMap[b.category] ?? 1e9);
    });
    res[t] = arr;
  }
  return res;
});
</script>

<template>
  <div>
    <h2 class="page-title">常用名称</h2>

    <div class="card">
      <p class="muted" style="font-size: 13px; margin: 0 0 8px; line-height: 1.7">
        在这里管理「常用名称」。<b>记一笔时会按「支出 / 收入」分别显示成可点击的标签</b>，点一下就填好名称并带出分类、支付方式和常用金额。<br />
        常用名称按「分类」分组，每个名称有<b>三种状态</b>：
        <b>★ 已收藏</b>（点击可<b>取消收藏</b>）
        /
        <b>×N 未收藏</b>（实时统计的使用频次，点击可<b>加入收藏</b>）
        /
        <b>点右上角 × 取消显示</b>（进入最下方「已取消显示」，点击可恢复）。<br />
        流水里的最近名称在「记一笔」弹窗里推荐。
      </p>
      <div class="toolbar">
        <button class="btn btn-primary" :disabled="scanning" @click="scan">
          {{ scanning ? "扫描中…" : "🔍 扫描流水" }}
        </button>
        <span class="muted small">把流水里所有出现过的名称重建到「未收藏建议」区（带频次）；收藏/取消显示仍手动</span>
        <button class="btn" :disabled="rescanning" @click="rescan">
          {{ rescanning ? "刷新中…" : "🔄 立即刷新建议" }}
        </button>
        <span class="muted small">建议默认由「流水保存后 / 每日一次」自动更新；点这个立即手动重建当前账本</span>
      </div>
    </div>

    <div class="cols">
      <div class="card" v-for="type in types" :key="type">
        <div class="section-title-row">
          <div class="section-title">
            {{ TYPE_META[type].icon }} {{ TYPE_META[type].label }} · 常用名称
          </div>
          <button class="btn btn-mini" :disabled="!sections[type].presets.length" @click="unpinAll(type)">
            全部取消收藏
          </button>
        </div>

        <!-- 添加表单 -->
        <div class="row form-row">
          <input class="input" style="flex: 2; min-width: 130px" v-model.trim="forms[type].name" :placeholder="`${TYPE_META[type].label}常用名称，如：${type === 'expense' ? '早饭 / 地铁通勤' : '工资 / 红包'}`" />
          <select class="select" style="flex: 1; min-width: 100px" v-model="forms[type].category">
            <option value="">默认分类（可选）</option>
            <option v-for="c in catsOf(type)" :key="c.id" :value="c.name">{{ c.icon }} {{ c.name }}</option>
          </select>
          <input class="input" style="flex: 1; min-width: 100px" v-model.trim="forms[type].payment_method" placeholder="支付方式" />
          <input class="input" style="flex: 1; min-width: 80px" type="number" step="0.01" v-model="forms[type].amount" placeholder="金额" />
          <button class="btn btn-primary" @click="submit(type)">+ 加入收藏</button>
        </div>

        <!-- 按分类分组的常用名称：每组内 ★ 在前，×N 在后；点击切换；已取消显示跟在分类底部 -->
        <div class="section-sub">常用名称（按分类分组；点击切换收藏状态，右上角 × 取消显示）</div>
        <div v-if="grouped[type].length" class="cat-groups">
          <div class="cat-group" v-for="g in grouped[type]" :key="g.category">
            <div class="cat-group-head">
              <span class="cat-group-name">{{ g.category }}</span>
              <span class="muted small">
                {{ g.items.length }} 个
                <template v-if="g.hidden.length">· 已隐藏 {{ g.hidden.length }}</template>
              </span>
            </div>
            <div class="chips">
              <span
                v-for="it in g.items" :key="it.source + (it.id || '') + it.name"
                class="chip" :class="{ 'chip-pin': it.source === 'preset', 'chip-freq': it.source === 'freq' }"
                :title="presetTip(it) + (it.source === 'preset' ? '（点击取消收藏）' : '（点击加入收藏）')"
                @click="toggle(type, it)"
              >
                <em v-if="it.source === 'preset'" class="star">★</em>
                <i v-if="it.source === 'freq'" class="cnt">×{{ it.count }}</i>
                {{ it.name }}
                <button type="button" class="x" title="取消显示" @click.stop="hide(type, it)">×</button>
              </span>
            </div>
            <!-- 已取消显示（跟着这个分类走，用细分隔线分开，点击恢复） -->
            <div v-if="g.hidden.length" class="hidden-in-group">
              <div class="hidden-divider">已取消显示（{{ g.hidden.length }}）</div>
              <div class="chips">
                <span
                  v-for="h in g.hidden" :key="'h-' + g.category + '-' + h.name"
                  class="chip chip-hidden" :title="'点击恢复显示'"
                  @click="restore(type, h)"
                >{{ h.name }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="muted small-pad">{{ loading ? "加载中…" : "还没有常用名称。在上方表单添加，或记几笔账后看下方未收藏建议。" }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; align-items: start; }
.section-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.btn-mini { font-size: 12px; padding: 4px 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 6px; cursor: pointer; }
.btn-mini:hover:not(:disabled) { border-color: var(--expense, #ef4444); color: var(--expense, #ef4444); }
.btn-mini:disabled { opacity: .4; cursor: not-allowed; }
.section-sub { font-size: 13px; font-weight: 600; color: var(--text-2); margin: 18px 0 8px; }
.form-row { align-items: center; flex-wrap: wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2);
  border-radius: 15px; padding: 6px 12px; font-size: 13px;
  display: inline-flex; align-items: center; gap: 2px;
  font-family: inherit; cursor: pointer; position: relative;
}
.chip:hover { border-color: var(--primary); }
.chip .star { color: var(--warning, #f59f00); margin-right: 4px; font-style: normal; }
.chip .cnt { font-style: normal; opacity: .55; margin-right: 5px; font-size: 11.5px; }
.chip .x {
  position: absolute; top: -7px; right: -7px; background: var(--expense, #ef4444); color: #fff;
  border: none; padding: 0; border-radius: 50%; width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-style: normal; cursor: pointer; line-height: 1;
  box-shadow: 0 1px 3px rgba(0,0,0,.3);
  transition: transform .15s;
}
.chip .x:hover { transform: scale(1.15); }
.chip-pin { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
/* chip-freq 使用默认（中性）样式，与 chip-pin 形成对照 */
.chip-hidden {
  border-style: dashed; color: var(--text-2); opacity: .55;
}
.chip-hidden:hover { border-color: var(--text-2); opacity: .9; }
/* 已取消显示嵌入每个分类组内部：细分隔线 + 略缩进 */
.hidden-in-group { margin-top: 10px; padding-top: 4px; }
.hidden-divider { font-size: 11px; color: var(--text-2); margin: 6px 0 4px; display: flex; align-items: center; gap: 6px; }
.hidden-divider::before { content: ""; flex: 0 0 8px; border-top: 1px dashed var(--border); }
.hidden-divider::after { content: ""; flex: 1; border-top: 1px dashed var(--border); }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); }
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