<script setup>
import { ref, onMounted } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import FlowDialog from "../components/FlowDialog.vue";

const store = useStore();
const text = ref("");
const parsing = ref(false);
const result = ref(null);
const showDialog = ref(false);
const preset = ref(null);
// 已记账结果：确认后直接落库，展示「删除记账 / 修改记账」
const created = ref(null);
const editOpen = ref(false);

// 月度分析
const month = ref(dayjs().format("YYYY-MM"));
const analyzing = ref(false);
const analysis = ref("");
const analysisSummary = ref(null);

const examples = ["午饭 35", "打车回家花了 28 块", "发工资 12000", "超市购物 156.5 微信", "收到红包 200"];

async function parse() {
  if (!text.value.trim()) return toast("说点什么，比如「午饭35」");
  parsing.value = true;
  result.value = null;
  try {
    const { data } = await api.post("/ai/parse", { text: text.value.trim() });
    result.value = data;
  } catch (e) { toast(e.message); }
  finally { parsing.value = false; }
}

function confirmResult() {
  if (!result.value) return;
  if (!result.value.amount || Number(result.value.amount) <= 0)
    return toast("金额无效，无法记账");
  const payload = {
    type: result.value.type,
    amount: Number(result.value.amount),
    category: result.value.category,
    payment_method: result.value.payment_method || "",
    description: result.value.description || result.value.category || "",
    flow_time: dayjs().format("YYYY-MM-DD"),
  };
  api
    .post("/flows", payload)
    .then(({ data }) => {
      created.value = { id: data.id, ...payload };
      result.value = null;
      text.value = "";
      toast("记账成功");
    })
    .catch((e) => toast(e.message));
}
function deleteCreated() {
  if (!created.value) return;
  api
    .delete(`/flows/${created.value.id}`)
    .then(() => {
      toast("已删除");
      created.value = null;
    })
    .catch((e) => toast(e.message));
}
function editCreated() {
  editOpen.value = true;
}
function onEditSaved() {
  editOpen.value = false;
  created.value = null;
  toast("已修改");
}
function onSaved() {
  result.value = null;
  text.value = "";
}

// 图片记账（小票 / 账单截图识别）
const imgPreview = ref("");
const imgText = ref("");
const imgParsing = ref(false);
function onImg(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { imgPreview.value = reader.result; };
  reader.readAsDataURL(file);
}
async function parseImage() {
  if (!imgPreview.value) return toast("请先选择一张小票 / 账单图片");
  imgParsing.value = true;
  try {
    const { data } = await api.post("/ai/parse-image", {
      image: imgPreview.value,
      text: imgText.value.trim(),
    });
    preset.value = {
      type: data.type,
      amount: data.amount,
      category: data.category,
      payment_method: data.payment_method,
      description: data.description,
      flow_time: dayjs().format("YYYY-MM-DD"),
    };
    showDialog.value = true;
    imgPreview.value = "";
    imgText.value = "";
  } catch (e) { toast(e.message); }
  finally { imgParsing.value = false; }
}

async function analyze() {
  analyzing.value = true;
  analysis.value = "";
  try {
    const { data } = await api.get("/ai/analyze", { params: { month: month.value } });
    analysis.value = data.analysis;
    analysisSummary.value = data.summary;
  } catch (e) { toast(e.message); }
  finally { analyzing.value = false; }
}
</script>

<template>
  <div>
    <h2 class="page-title">✨ AI 记账</h2>

    <div class="card">
      <div class="section-title">一句话记账</div>
      <p class="muted" style="margin-top:-6px;font-size:13px">
        {{ store.aiEnabled ? "已接入 AI 大模型，识别更聪明" : "未配置 AI，使用本地规则识别（配置 AI_BASE_URL 后更智能）" }}
      </p>
      <div class="row" style="gap:8px">
        <input class="input" v-model="text" placeholder="例如：午饭 35 / 发工资 12000 / 打车 28 微信" @keyup.enter="parse" />
        <button class="btn btn-primary" :disabled="parsing" @click="parse">{{ parsing ? "识别中…" : "识别" }}</button>
      </div>
      <div class="chips">
        <span v-for="e in examples" :key="e" class="chip" @click="text=e;parse()">{{ e }}</span>
      </div>

      <!-- 识别结果 -->
      <div v-if="result" class="result">
        <div class="rline">
          <span class="tag" :class="result.type">{{ result.type === "expense" ? "支出" : "收入" }}</span>
          <b class="ramt" :class="result.type">¥{{ Number(result.amount).toFixed(2) }}</b>
          <span class="tag">{{ result.category }}</span>
          <span v-if="result.payment_method" class="tag">{{ result.payment_method }}</span>
          <span class="muted small">来源：{{ result.source === "ai" ? "AI模型" : "本地规则" }}</span>
        </div>
        <div v-if="result.description" class="muted">名称：{{ result.description }}</div>
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn" @click="result=null">取消</button>
          <button class="btn btn-primary" @click="confirmResult">确认并记账</button>
        </div>
      </div>

      <!-- 已记账结果：可直接删除 / 修改 -->
      <div v-if="created" class="result done">
        <div class="rline">
          <span class="tag" :class="created.type">{{ created.type === "expense" ? "支出" : "收入" }}</span>
          <b class="ramt" :class="created.type">¥{{ Number(created.amount).toFixed(2) }}</b>
          <span class="tag">{{ store.categories.find(c => c.name === created.category)?.icon || "💰" }} {{ created.category }}</span>
          <span v-if="created.payment_method" class="tag">{{ created.payment_method }}</span>
          <span class="muted small">已记账 ✓</span>
        </div>
        <div v-if="created.description" class="muted">名称：{{ created.description }}</div>
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn" @click="deleteCreated">删除记账</button>
          <button class="btn btn-primary" @click="editCreated">修改记账</button>
        </div>
      </div>
    </div>

    <!-- 月度分析 -->
    <div class="card" style="margin-top:16px">
      <div class="cal-head">
        <div class="section-title" style="margin:0">📊 月度智能分析</div>
        <div class="row" style="gap:8px;align-items:center">
          <input class="input" style="width:150px" type="month" v-model="month" />
          <button class="btn btn-primary btn-sm" :disabled="analyzing" @click="analyze">{{ analyzing ? "分析中…" : "生成分析" }}</button>
        </div>
      </div>
      <div v-if="analysisSummary" class="sum-row">
        <span>收入 <b class="income">¥{{ analysisSummary.income.toFixed(2) }}</b></span>
        <span>支出 <b class="expense">¥{{ analysisSummary.expense.toFixed(2) }}</b></span>
        <span>结余 <b :class="analysisSummary.balance>=0?'income':'expense'">¥{{ analysisSummary.balance.toFixed(2) }}</b></span>
      </div>
      <pre v-if="analysis" class="analysis">{{ analysis }}</pre>
      <div v-else-if="!analyzing" class="muted" style="padding:10px 0">选择月份，点「生成分析」查看消费洞察与省钱建议。</div>
    </div>

    <!-- 图片记账 -->
    <div class="card" style="margin-top:16px">
      <div class="section-title">📷 图片记账（小票 / 账单截图识别）</div>
      <p class="muted" style="margin-top:-6px;font-size:13px">
        {{ store.aiEnabled ? "上传一张小票或账单截图，AI 自动识别金额、分类与名称" : "未配置 AI 视觉模型（请在「设置 → AI 记账」里填写图片模型与密钥）" }}
      </p>
      <div class="row" style="gap:10px;align-items:flex-start;flex-wrap:wrap">
        <label class="upload-box">
          <input type="file" accept="image/*" @change="onImg" hidden />
          <div v-if="!imgPreview" class="upload-inner">＋ 选择图片</div>
          <img v-else :src="imgPreview" class="preview" alt="preview" />
        </label>
        <div style="flex:1;min-width:200px">
          <input class="input" v-model.trim="imgText" placeholder="补充说明（可选），如：这是公司报销" style="width:100%" />
          <button class="btn btn-primary" style="margin-top:8px" :disabled="imgParsing || !store.aiEnabled" @click="parseImage">
            {{ imgParsing ? "识别中…" : "识别并记账" }}
          </button>
          <button class="btn" style="margin-top:8px;margin-left:8px" v-if="imgPreview" @click="imgPreview=''">重选</button>
        </div>
      </div>
    </div>

    <FlowDialog v-model="showDialog" :preset="preset" @saved="onSaved" />
    <FlowDialog v-model="editOpen" :flow="created" @saved="onEditSaved" />
  </div>
</template>

<style scoped>
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.chip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; font-size: 13px; cursor: pointer; color: var(--text-2); }
.chip:hover { border-color: var(--primary); color: var(--primary); }
.result { margin-top: 16px; padding: 14px; border-radius: 12px; background: var(--surface-2); }
.result.done { border: 1px solid color-mix(in srgb, var(--income) 45%, transparent); background: color-mix(in srgb, var(--income) 8%, var(--surface-2)); }
.rline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ramt { font-size: 20px; }
.tag.expense { color: var(--expense); }
.tag.income { color: var(--income); }
.small { font-size: 12px; }
.sum-row { display: flex; gap: 22px; margin-bottom: 12px; font-size: 14px; flex-wrap: wrap; }
.analysis { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.8; background: var(--surface-2); padding: 16px; border-radius: 12px; margin: 0; }
.upload-box { width: 140px; height: 140px; border: 2px dashed var(--border); border-radius: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--surface-2); flex-shrink: 0; }
.upload-box:hover { border-color: var(--primary); }
.upload-inner { color: var(--text-2); font-size: 14px; }
.preview { width: 100%; height: 100%; object-fit: cover; }
</style>
