<script setup>
import { ref, reactive, onMounted } from "vue";
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

        <!-- 我的常用 -->
        <div class="section-sub">我的常用（{{ sections[type].presets.length }}）</div>
        <table class="tbl" v-if="sections[type].presets.length">
          <thead>
            <tr>
              <th>名称</th>
              <th>默认分类</th>
              <th class="hide-mobile">支付方式</th>
              <th class="hide-mobile">常用金额</th>
              <th style="text-align: right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in sections[type].presets" :key="p.id">
              <td><b>{{ p.name }}</b></td>
              <td><span class="tag" v-if="p.category">{{ p.category }}</span><span class="muted" v-else>—</span></td>
              <td class="hide-mobile muted">{{ p.payment_method || "—" }}</td>
              <td class="hide-mobile muted">{{ p.amount > 0 ? "¥" + p.amount : "—" }}</td>
              <td style="text-align: right; white-space: nowrap">
                <button class="btn btn-sm" @click="edit(type, p)">编辑</button>
                <button class="btn btn-sm btn-danger" @click="remove(type, p)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="muted small-pad">{{ loading ? "加载中…" : "还没有常用名称，在上面添加一个吧" }}</div>

        <!-- 高频 -->
        <div class="section-sub">高频名称（用得最多，点 ☆ 收藏为常用）</div>
        <div class="chips" v-if="sections[type].frequent.length">
          <button class="chip" v-for="p in sections[type].frequent" :key="p.name" @click="pin(type, p)">
            {{ p.name }}<i>×{{ p.count }}</i><em>☆</em>
          </button>
        </div>
        <div v-else class="muted small-pad">同一名称用满 2 次后会出现在这里</div>

        <!-- 最近 -->
        <div class="section-sub">最近用过</div>
        <div class="chips" v-if="sections[type].recent.length">
          <button class="chip" v-for="p in sections[type].recent" :key="p.name" @click="pin(type, p)">
            {{ p.name }}<em>☆</em>
          </button>
        </div>
        <div v-else class="muted small-pad">暂无记录</div>
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
  border-radius: 15px; padding: 6px 12px; font-size: 13px; cursor: pointer;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip i { font-style: normal; opacity: .5; margin-left: 5px; font-size: 11.5px; }
.chip em { font-style: normal; margin-left: 6px; opacity: .6; }
.small-pad { padding: 4px 0 2px; }
@media (max-width: 900px) {
  .cols { grid-template-columns: 1fr; }
  .hide-mobile { display: none; }
}
</style>
