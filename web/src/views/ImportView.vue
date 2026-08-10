<script setup>
import { ref } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { toast } from "../toast.js";

const source = ref("auto");
const file = ref(null);
const items = ref([]);
const headers = ref([]);
const mapping = ref({});
const loading = ref(false);
const importing = ref(false);

// 通用 CSV 模式下，需要把“系统字段”映射到 CSV 的列名
const MAP_FIELDS = [
  { key: "time", label: "时间列", hint: "必选" },
  { key: "amount", label: "金额列", hint: "必选" },
  { key: "io", label: "收支/方向列", hint: "可空，留空按金额正负判断" },
  { key: "category", label: "分类列", hint: "可空" },
  { key: "payment", label: "支付方式/账户列", hint: "可空" },
  { key: "description", label: "备注/摘要列", hint: "可空" },
  { key: "attribution", label: "归属人列", hint: "可空" },
];

function onFile(e) {
  file.value = e.target.files[0] || null;
  items.value = [];
  headers.value = [];
  mapping.value = {};
}

async function preview() {
  if (!file.value) return toast("请选择 CSV 文件");
  loading.value = true;
  try {
    const fd = new FormData();
    fd.append("file", file.value);
    fd.append("source", source.value);
    fd.append("bookId", localStorage.getItem("bookId"));
    if (source.value === "generic" && Object.keys(mapping.value).length) {
      const m = {};
      for (const [k, v] of Object.entries(mapping.value)) if (v) m[k] = v;
      if (Object.keys(m).length) fd.append("mapping", JSON.stringify(m));
    }
    const { data } = await api.post("/import/preview", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    items.value = data.items;
    headers.value = data.headers || [];
    if (source.value === "generic" && !Object.keys(mapping.value).length && data.detectedMapping) {
      mapping.value = { ...data.detectedMapping };
    }
    if (!data.items.length)
      toast(source.value === "generic" ? "未解析到数据，请手动映射列后再试" : "没有解析到有效账单，请确认文件格式");
    else toast(`解析到 ${data.count} 条`);
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}

function applyMapping() {
  preview();
}

function removeItem(i) {
  items.value.splice(i, 1);
}

async function confirm() {
  if (!items.value.length) return;
  importing.value = true;
  try {
    const { data } = await api.post("/import/confirm", { items: items.value });
    toast(`成功导入 ${data.imported} 条`);
    items.value = [];
    file.value = null;
  } catch (e) {
    toast(e.message);
  } finally {
    importing.value = false;
  }
}

// 数据导出
async function exportData() {
  try {
    const { data } = await api.get("/import/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.book || "账本"}_${dayjs().format("YYYYMMDD_HHmm")}.json`;
    a.click();
    toast("已导出");
  } catch (e) {
    toast(e.message);
  }
}

async function importData(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const { data: r } = await api.post("/import/import-json", { data });
    toast(`导入完成：流水 ${r.flows} 条，分类 ${r.categories}，预算 ${r.budgets}`);
  } catch (err) {
    toast("导入失败：" + err.message);
  } finally {
    e.target.value = "";
  }
}

const expenseCount = () => items.value.filter((x) => x.type === "expense").length;
const incomeCount = () => items.value.filter((x) => x.type === "income").length;
</script>

<template>
  <div>
    <h2 class="page-title">导入 / 导出</h2>

    <div class="card">
      <div class="section-title">📥 导入账单（CSV）</div>
      <div class="row" style="align-items:center;gap:10px">
        <select class="select" style="width:auto" v-model="source">
          <option value="auto">自动识别（支付宝/微信）</option>
          <option value="alipay">支付宝</option>
          <option value="wechat">微信</option>
          <option value="generic">通用 CSV（自定义列）</option>
        </select>
        <input type="file" accept=".csv,text/csv" @change="onFile" />
        <button class="btn btn-primary" :disabled="loading" @click="preview">{{ loading ? "解析中…" : "解析预览" }}</button>
      </div>
      <p class="muted tips">
        支付宝 App「账单 → 开具交易流水证明 → 用于个人对账」、微信「支付 → 钱包 → 账单 → 下载账单」导出 CSV，
        解压后上传即可。其它记账软件请选「通用 CSV（自定义列）」，在下方把列对应好即可导入。
        文件编码/表头会自动识别。
      </p>

      <!-- 通用 CSV：列映射面板 -->
      <div v-if="source === 'generic' && headers.length" class="card" style="margin-top:12px">
        <div class="section-title">🔧 列映射（把你的 CSV 列对应到系统字段）</div>
        <div class="row" style="flex-wrap:wrap;gap:14px">
          <div v-for="f in MAP_FIELDS" :key="f.key" class="map-field">
            <label>
              {{ f.label }}
              <span v-if="f.hint" class="muted" style="font-size:11px">（{{ f.hint }}）</span>
            </label>
            <select class="select" v-model="mapping[f.key]">
              <option value="">（不映射）</option>
              <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="loading" @click="applyMapping" style="margin-top:12px">
          {{ loading ? "解析中…" : "应用映射并预览" }}
        </button>
      </div>

      <template v-if="items.length">
        <div class="row prev-sum">
          <span>共 <b>{{ items.length }}</b> 条</span>
          <span>支出 <b class="expense">{{ expenseCount() }}</b></span>
          <span>收入 <b class="income">{{ incomeCount() }}</b></span>
          <div class="spacer"></div>
          <button class="btn btn-primary" :disabled="importing" @click="confirm">{{ importing ? "导入中…" : `确认导入 ${items.length} 条` }}</button>
        </div>
        <div class="prev-table card" style="padding:0">
          <table class="tbl">
            <thead><tr><th>时间</th><th>类型</th><th>分类</th><th class="hide-mobile">备注</th><th class="hide-mobile">支付方式</th><th style="text-align:right">金额</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(it,i) in items" :key="i">
                <td class="muted">{{ dayjs(it.flow_time).format("MM-DD HH:mm") }}</td>
                <td :class="it.type">{{ it.type === "expense" ? "支出" : "收入" }}</td>
                <td><input class="input mini" v-model="it.category" /></td>
                <td class="hide-mobile muted ellip">{{ it.description }}</td>
                <td class="hide-mobile muted">{{ it.payment_method }}</td>
                <td style="text-align:right" :class="it.type"><b>{{ Number(it.amount).toFixed(2) }}</b></td>
                <td><button class="btn btn-sm btn-danger" @click="removeItem(i)">×</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">💾 账本数据备份</div>
      <p class="muted" style="margin-top:-4px;font-size:13px">导出当前账本全部数据为 JSON，可用于备份或迁移到其它账本。</p>
      <div class="row">
        <button class="btn" @click="exportData">导出当前账本</button>
        <label class="btn">导入JSON到当前账本<input type="file" accept=".json" style="display:none" @change="importData" /></label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tips { font-size: 13px; margin-top: 12px; line-height: 1.7; }
.prev-sum { margin: 16px 0 10px; align-items: center; gap: 18px; font-size: 14px; }
.spacer { flex: 1; }
.mini { padding: 5px 8px; font-size: 13px; width: 90px; }
.ellip { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prev-table { max-height: 420px; overflow: auto; }
.map-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.map-field .select { width: 160px; }
</style>
