<script setup>
import { ref, onMounted, computed } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const tab = ref("expense");
const showDialog = ref(false);
const form = ref({ id: null, name: "", type: "expense", icon: "💰", color: "#6366f1" });

// 合并删除对话框：删除的分类有数据时，强制选个目标合并再删
const mergeDlg = ref({ open: false, source: null, targetId: "" });

const ICONS = [
  "🍜","🛍️","🚌","🏠","🎮","💊","📚","📱","🎁","💸","💼","🏆","📈","🧧","🪙","☕","🍔","🚗","✈️","🏥","🎬","👕","🐱","💡","🎓","💰","💳","🍎","🏋️","🎵",
  "🥘","🥡","🧋","🥦","🍉","🍰","🍪","🍺","💄","🧴","👟","👜","🧥","💍","🎂","💐","🎉","🤝","🚕","🚄","🅿️","⛽","🔧","💻","📷","🎧","🎨","🚲","🏊","🏕️",
  "🧳","🛏️","🛋️","🪴","🧹","🐶","🐟","🖊️","🎒","🏫","📊","🏦","💹","🧾","👶","🍼","👴","👫","💒","🎊","📺","🎤","🎲","📦","⚙️","🛡️","🎰","📎","⭐","📌","❤️"
];
const COLORS = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#64748b"];

const list = computed(() => store.categories.filter((c) => c.type === tab.value));
const scanning = ref(false);

async function reload() { await store.fetchCategories(); }
onMounted(reload);

async function move(cat, dir) {
  const ordered = store.categories
    .filter((c) => c.type === tab.value)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  const i = ordered.findIndex((c) => c.id === cat.id);
  const j = i + dir;
  if (j < 0 || j >= ordered.length) return;
  const ids = ordered.map((c) => c.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await api.post("/categories/reorder", { ids });
    await store.fetchCategories();
  } catch (e) { toast(e.message); }
}

const usedIcons = computed(
  () => new Set(store.categories.filter((c) => c.id !== form.value.id).map((c) => c.icon))
);
function pickIcon(i) {
  if (usedIcons.value.has(i) && i !== form.value.icon) return;
  form.value.icon = i;
}

function add() {
  form.value = { id: null, name: "", type: tab.value, icon: "💰", color: "#6366f1" };
  showDialog.value = true;
}
function edit(c) {
  form.value = { ...c };
  showDialog.value = true;
}
async function save() {
  if (!form.value.name.trim()) return toast("请输入分类名");
  try {
    if (form.value.id) {
      await api.put(`/categories/${form.value.id}`, form.value);
    } else {
      await api.post("/categories", form.value);
    }
    toast("已保存");
    showDialog.value = false;
    reload();
  } catch (e) { toast(e.message); }
}

// 扫码补全分类：扫流水把出现但 categories 表里没有的分类补上
async function scanCategories() {
  if (!confirm(
    "将扫描本账本所有流水，把出现但分类表里没有的分类补上（已有则跳过）。是否继续？"
  )) return;
  scanning.value = true;
  try {
    const { data } = await api.post("/categories/scan");
    await reload();
    if (!data.added) {
      alert("扫描完成：流水里的分类都已存在，无需补齐。");
    } else {
      const lines = data.items
        .map((x) => `+ ${x.type === "expense" ? "支出" : "收入"}「${x.name}」（${x.count} 条流水）`)
        .join("\n");
      alert(`扫描完成：新增 ${data.added} 个分类\n${lines}`);
    }
  } catch (e) { toast(e.message); }
  finally { scanning.value = false; }
}

// 安全删除：
//   0 数据 → 二次确认后直接删
//   >0 数据 → 弹合并对话框（必须选个目标分类把流水并过去，再删原分类）
async function del(c) {
  const cnt = c.flow_count || 0;
  if (cnt === 0) {
    if (!confirm(`删除分类「${c.name}」？该分类下没有流水。`)) return;
    try {
      await api.delete(`/categories/${c.id}`);
      toast("已删除");
      reload();
    } catch (e) { toast(e.message); }
    return;
  }
  // >0 数据：弹合并对话框
  mergeDlg.value = { open: true, source: c, targetId: "" };
}

async function confirmMerge() {
  const { source, targetId } = mergeDlg.value;
  if (!targetId) return toast("请选择并入哪个分类");
  try {
    await api.delete(`/categories/${source.id}`, { params: { mergeTo: Number(targetId) } });
    toast(`已把 ${source.flow_count} 条流水并入并删除「${source.name}」`);
    mergeDlg.value = { open: false, source: null, targetId: "" };
    reload();
  } catch (e) { toast(e.message); }
}
function cancelMerge() {
  mergeDlg.value = { open: false, source: null, targetId: "" };
}

// 合并对话框里可选的目标（同类型，排除自己）
const mergeTargets = computed(() => {
  if (!mergeDlg.value.source) return [];
  return list.value.filter((c) => c.id !== mergeDlg.value.source.id);
});
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">分类管理</h2>
      <div class="head-actions">
        <button class="btn" :disabled="scanning" @click="scanCategories">
          {{ scanning ? "扫描中…" : "🔍 扫描流水补全分类" }}
        </button>
        <button class="btn btn-primary" @click="add">＋ 新增分类</button>
      </div>
    </div>

    <div class="seg">
      <button :class="{on:tab==='expense'}" @click="tab='expense'">支出分类</button>
      <button :class="{on:tab==='income'}" @click="tab='income'">收入分类</button>
    </div>

    <div class="grid cat-grid">
      <div v-for="c in list" :key="c.id" class="card cat" @click="edit(c)">
        <div class="cicon" :style="{ background: c.color + '22', color: c.color }">{{ c.icon }}</div>
        <div class="cname">{{ c.name }}</div>
        <div v-if="(c.flow_count||0) > 0" class="flow-badge" :title="`该分类下有 ${c.flow_count} 条流水`">
          📊 {{ c.flow_count }} 条流水
        </div>
        <div class="cat-actions">
          <button class="mini" @click.stop="move(c, -1)" title="上移">↑</button>
          <button class="mini" @click.stop="move(c, 1)" title="下移">↓</button>
          <button class="del" @click.stop="del(c)" :title="(c.flow_count||0) > 0 ? `有 ${c.flow_count} 条流水，删除需合并` : '删除'">×</button>
        </div>
      </div>
    </div>

    <!-- 新增/编辑分类对话框 -->
    <div v-if="showDialog" class="modal-mask" @click.self="showDialog=false">
      <div class="modal">
        <h3 class="modal-title">{{ form.id ? "编辑分类" : "新增" + (tab==='expense'?'支出':'收入') + "分类" }}</h3>
        <label class="field"><span>名称</span><input class="input" v-model.trim="form.name" placeholder="分类名称" /></label>
        <label class="field"><span>图标（灰色为其他分类已用，避免重复）</span>
          <div class="picker">
            <button v-for="i in ICONS" :key="i" :class="['picon',{on:form.icon===i, used: usedIcons.has(i) && i!==form.icon}]" @click="pickIcon(i)">{{ i }}</button>
          </div>
        </label>
        <label class="field"><span>颜色</span>
          <div class="picker">
            <button v-for="c in COLORS" :key="c" class="pcolor" :class="{on:form.color===c}" :style="{background:c}" @click="form.color=c"></button>
          </div>
        </label>
        <div class="preview">
          预览：<span class="cicon sm" :style="{ background: form.color+'22', color: form.color }">{{ form.icon }}</span> {{ form.name || "分类名" }}
        </div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" @click="showDialog=false">取消</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <!-- 合并删除对话框（分类下有流水时强制） -->
    <div v-if="mergeDlg.open" class="modal-mask" @click.self="cancelMerge">
      <div class="modal">
        <h3 class="modal-title">删除分类前请合并流水</h3>
        <p class="muted" style="font-size: 13px; line-height: 1.7; margin: 0 0 12px">
          分类「<b>{{ mergeDlg.source?.name }}</b>」下有 <b style="color:var(--expense,#ef4444)">{{ mergeDlg.source?.flow_count }}</b> 条流水。
          删除前必须把这些流水并入另一个{{ tab==='expense'?'支出':'收入' }}分类，才能继续操作。
        </p>
        <label class="field">
          <span>并入分类</span>
          <select class="select" v-model="mergeDlg.targetId">
            <option value="">请选择...</option>
            <option v-for="t in mergeTargets" :key="t.id" :value="t.id">
              {{ t.icon }} {{ t.name }}（{{ t.flow_count || 0 }} 条流水）
            </option>
          </select>
        </label>
        <p v-if="mergeTargets.length === 0" class="muted" style="font-size: 12px; color: var(--expense, #ef4444)">
          当前类型下没有其他分类可选，请先新建一个分类再来删除。
        </p>
        <div class="row" style="justify-content:flex-end; margin-top: 8px">
          <button class="btn" @click="cancelMerge">取消</button>
          <button class="btn btn-primary" :disabled="!mergeDlg.targetId || mergeTargets.length === 0" @click="confirmMerge">并入并删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: 10px; padding: 4px; margin-bottom: 16px; }
.seg button { border: none; background: transparent; padding: 8px 18px; border-radius: 7px; cursor: pointer; color: var(--text-2); }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.cat-grid { grid-template-columns: repeat(6, 1fr); }
.cat { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 8px; cursor: pointer; position: relative; }
.cicon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
.cicon.sm { width: 30px; height: 30px; font-size: 17px; display: inline-flex; vertical-align: middle; }
.cname { font-size: 13px; }
.flow-badge { font-size: 11px; color: var(--text-2); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 2px 8px; }
.cat-actions { position: absolute; top: 6px; right: 8px; display: flex; gap: 2px; }
.del { border: none; background: transparent; color: var(--text-2); cursor: pointer; font-size: 16px; line-height: 1; opacity: 0; }
.mini { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); cursor: pointer; font-size: 11px; width: 18px; height: 18px; border-radius: 5px; line-height: 1; opacity: 0; }
.cat:hover .del, .cat:hover .mini { opacity: 1; }
.picker { display: flex; flex-wrap: wrap; gap: 6px; max-height: 180px; overflow-y: auto; padding-right: 4px; }
.picon { width: 38px; height: 38px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 9px; font-size: 19px; cursor: pointer; }
.picon.on { border-color: var(--primary); background: var(--primary-soft); }
.picon.used { opacity: .4; filter: grayscale(1); cursor: not-allowed; }
.pcolor { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.pcolor.on { border-color: var(--text); }
.preview { margin: 6px 0 14px; font-size: 14px; color: var(--text-2); }
@media (max-width: 720px) { .cat-grid { grid-template-columns: repeat(4, 1fr); } }
</style>