<script setup>
import { ref, computed, onMounted, watch } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const type = ref("expense");
const data = ref({ presets: [], frequent: [], recent: [] });
const loading = ref(false);

const cats = computed(() => store.categories.filter((c) => c.type === type.value));

const form = ref(blank());
function blank() {
  return { name: "", category: "", payment_method: "", amount: "" };
}
const editingId = ref(null);

async function load() {
  loading.value = true;
  try {
    const { data: d } = await api.get("/presets", {
      params: { type: type.value, limit: 30 },
    });
    data.value = d;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(type, () => {
  reset();
  load();
});

function reset() {
  form.value = blank();
  editingId.value = null;
}

async function submit() {
  const f = form.value;
  if (!f.name.trim()) return toast("请填写常用名称");
  const payload = {
    name: f.name.trim(),
    type: type.value,
    category: f.category || "",
    payment_method: f.payment_method || "",
    amount: Number(f.amount) || 0,
  };
  try {
    if (editingId.value) {
      await api.put(`/presets/${editingId.value}`, payload);
      toast("已更新");
    } else {
      await api.post("/presets", payload);
      toast("已添加");
    }
    reset();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function edit(p) {
  editingId.value = p.id;
  form.value = {
    name: p.name,
    category: p.category,
    payment_method: p.payment_method,
    amount: p.amount || "",
  };
}

async function remove(p) {
  if (!confirm(`删除常用名称「${p.name}」？（不会影响已有账单）`)) return;
  try {
    await api.delete(`/presets/${p.id}`);
    if (editingId.value === p.id) reset();
    toast("已删除");
    await load();
  } catch (e) {
    toast(e.message);
  }
}

// 从「高频 / 最近」一键收藏为常用
async function pin(item) {
  try {
    await api.post("/presets", {
      name: item.name,
      type: type.value,
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
      <p class="muted" style="font-size: 13px; margin: 0 0 14px; line-height: 1.7">
        在这里预设常用的消费名称，记一笔时会显示成可点击的标签，点一下就填好名称，还能自动带出分类、支付方式和常用金额。<br />
        下方的「高频」和「最近」由系统根据你的记账习惯自动统计，无需维护，越用越准。
      </p>

      <div class="seg">
        <button :class="{ on: type === 'expense' }" @click="type = 'expense'">支出</button>
        <button :class="{ on: type === 'income' }" @click="type = 'income'">收入</button>
      </div>

      <div class="row form-row">
        <input class="input" style="flex: 2; min-width: 140px" v-model.trim="form.name" placeholder="常用名称，如：早饭 / 地铁通勤" />
        <select class="select" style="flex: 1; min-width: 110px" v-model="form.category">
          <option value="">默认分类（可选）</option>
          <option v-for="c in cats" :key="c.id" :value="c.name">{{ c.icon }} {{ c.name }}</option>
        </select>
        <input class="input" style="flex: 1; min-width: 110px" v-model.trim="form.payment_method" placeholder="支付方式（可选）" />
        <input class="input" style="flex: 1; min-width: 90px" type="number" step="0.01" v-model="form.amount" placeholder="常用金额" />
        <button class="btn btn-primary" @click="submit">{{ editingId ? "保存修改" : "+ 添加" }}</button>
        <button class="btn" v-if="editingId" @click="reset">取消</button>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="section-title">我的常用（{{ data.presets.length }}）</div>
      <table class="tbl" v-if="data.presets.length">
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
          <tr v-for="p in data.presets" :key="p.id">
            <td><b>{{ p.name }}</b></td>
            <td><span class="tag" v-if="p.category">{{ p.category }}</span><span class="muted" v-else>—</span></td>
            <td class="hide-mobile muted">{{ p.payment_method || "—" }}</td>
            <td class="hide-mobile muted">{{ p.amount > 0 ? "¥" + p.amount : "—" }}</td>
            <td style="text-align: right; white-space: nowrap">
              <button class="btn btn-sm" @click="edit(p)">编辑</button>
              <button class="btn btn-sm btn-danger" @click="remove(p)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted">{{ loading ? "加载中…" : "还没有常用名称，在上面添加一个吧" }}</div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="section-title">高频名称（用得最多，点 ☆ 收藏为常用）</div>
      <div class="chips" v-if="data.frequent.length">
        <button class="chip" v-for="p in data.frequent" :key="p.name" @click="pin(p)">
          {{ p.name }}<i>×{{ p.count }}</i><em>☆</em>
        </button>
      </div>
      <div v-else class="muted">同一名称用满 2 次后会出现在这里</div>

      <div class="section-title" style="margin-top: 20px">最近用过</div>
      <div class="chips" v-if="data.recent.length">
        <button class="chip" v-for="p in data.recent" :key="p.name" @click="pin(p)">
          {{ p.name }}<em>☆</em>
        </button>
      </div>
      <div v-else class="muted">暂无记录</div>
    </div>
  </div>
</template>

<style scoped>
.seg { display: flex; background: var(--surface-2); border-radius: 10px; padding: 4px; margin-bottom: 14px; max-width: 260px; }
.seg button { flex: 1; border: none; background: transparent; padding: 8px; border-radius: 8px; cursor: pointer; color: var(--text-2); font-size: 14px; }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.form-row { align-items: center; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2);
  border-radius: 15px; padding: 6px 12px; font-size: 13px; cursor: pointer;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip i { font-style: normal; opacity: .5; margin-left: 5px; font-size: 11.5px; }
.chip em { font-style: normal; margin-left: 6px; opacity: .6; }
@media (max-width: 720px) {
  .hide-mobile { display: none; }
}
</style>
