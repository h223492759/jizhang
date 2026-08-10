<script setup>
import { ref, onMounted, computed } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const tab = ref("expense");
const showDialog = ref(false);
const form = ref({ id: null, name: "", type: "expense", icon: "💰", color: "#6366f1" });

const ICONS = ["🍜","🛍️","🚌","🏠","🎮","💊","📚","📱","🎁","💸","💼","🏆","📈","🧧","🪙","☕","🍔","🚗","✈️","🏥","🎬","👕","🐱","💡","🎓","💰","💳","🍎","🏋️","🎵"];
const COLORS = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#64748b"];

const list = computed(() => store.categories.filter((c) => c.type === tab.value));

async function reload() { await store.fetchCategories(); }
onMounted(reload);

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
async function del(c) {
  if (!confirm(`删除分类「${c.name}」？历史流水不受影响。`)) return;
  await api.delete(`/categories/${c.id}`);
  toast("已删除");
  reload();
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">分类管理</h2>
      <button class="btn btn-primary" @click="add">＋ 新增分类</button>
    </div>

    <div class="seg">
      <button :class="{on:tab==='expense'}" @click="tab='expense'">支出分类</button>
      <button :class="{on:tab==='income'}" @click="tab='income'">收入分类</button>
    </div>

    <div class="grid cat-grid">
      <div v-for="c in list" :key="c.id" class="card cat" @click="edit(c)">
        <div class="cicon" :style="{ background: c.color + '22', color: c.color }">{{ c.icon }}</div>
        <div class="cname">{{ c.name }}</div>
        <button class="del" @click.stop="del(c)">×</button>
      </div>
    </div>

    <div v-if="showDialog" class="modal-mask" @click.self="showDialog=false">
      <div class="modal">
        <h3 class="modal-title">{{ form.id ? "编辑分类" : "新增" + (tab==='expense'?'支出':'收入') + "分类" }}</h3>
        <label class="field"><span>名称</span><input class="input" v-model.trim="form.name" placeholder="分类名称" /></label>
        <label class="field"><span>图标</span>
          <div class="picker">
            <button v-for="i in ICONS" :key="i" :class="['picon',{on:form.icon===i}]" @click="form.icon=i">{{ i }}</button>
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
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: 10px; padding: 4px; margin-bottom: 16px; }
.seg button { border: none; background: transparent; padding: 8px 18px; border-radius: 7px; cursor: pointer; color: var(--text-2); }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.cat-grid { grid-template-columns: repeat(6, 1fr); }
.cat { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px; cursor: pointer; position: relative; }
.cicon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
.cicon.sm { width: 30px; height: 30px; font-size: 17px; display: inline-flex; vertical-align: middle; }
.cname { font-size: 13px; }
.del { position: absolute; top: 6px; right: 8px; border: none; background: transparent; color: var(--text-2); cursor: pointer; font-size: 16px; opacity: 0; }
.cat:hover .del { opacity: 1; }
.picker { display: flex; flex-wrap: wrap; gap: 6px; }
.picon { width: 38px; height: 38px; border: 1px solid var(--border); background: var(--surface-2); border-radius: 9px; font-size: 19px; cursor: pointer; }
.picon.on { border-color: var(--primary); background: var(--primary-soft); }
.pcolor { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.pcolor.on { border-color: var(--text); }
.preview { margin: 6px 0 14px; font-size: 14px; color: var(--text-2); }
@media (max-width: 720px) { .cat-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
