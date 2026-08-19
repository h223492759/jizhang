<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const nickname = ref(store.user?.nickname || "");
const pwd = ref({ oldPassword: "", newPassword: "" });

const isAdmin = computed(() => store.user?.role === "admin");

// ---------------- AI 记账设置（支持多个模型） ----------------
const aiModels = ref([]); // [{id,name,provider,baseUrl,apiKey,model,imageModel,isDefault}]
const aiStatus = ref({ enabled: false });
const aiSaving = ref(false);

// 常见服务商预设（均为 OpenAI 兼容 /chat/completions 接口）
const PROVIDER_GROUPS = [
  { group: "国内服务商", items: [
    { key: "zhipu", label: "智谱 AI（BigModel）", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", imageModel: "glm-4v-flash" },
    { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imageModel: "" },
    { key: "qwen", label: "通义千问（DashScope）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", imageModel: "qwen-vl-plus" },
    { key: "moonshot", label: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", imageModel: "" },
    { key: "siliconflow", label: "硅基流动 SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3", imageModel: "" },
    { key: "baichuan", label: "百川智能", baseUrl: "https://api.baichuan-ai.com/v1", model: "Baichuan4", imageModel: "" },
    { key: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", model: "abab6.5s-chat", imageModel: "" },
    { key: "stepfun", label: "阶跃星辰 StepFun", baseUrl: "https://api.stepfun.com/v1", model: "step-1.5-flash", imageModel: "" },
    { key: "doubao", label: "火山方舟（豆包）", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "", imageModel: "" },
  ]},
  { group: "海外 & 兼容", items: [
    { key: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", imageModel: "gpt-4o-mini" },
    { key: "openrouter", label: "OpenRouter（聚合多家）", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", imageModel: "" },
    { key: "gemini", label: "Google Gemini（兼容端点）", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-flash", imageModel: "gemini-1.5-flash" },
    { key: "ollama", label: "本地 Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3", imageModel: "" },
  ]},
  { group: "其他", items: [
    { key: "custom", label: "自定义 / 其他 OpenAI 兼容接口", baseUrl: "", model: "", imageModel: "" },
  ]},
];
const PROVIDER_MAP = Object.fromEntries(PROVIDER_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i])));

async function loadAi() {
  if (!isAdmin.value) return;
  try {
    const { data } = await api.get("/settings/ai");
    aiModels.value = data.models || [];
    aiStatus.value = { enabled: data.enabled };
  } catch {}
}
onMounted(loadAi);

// 选服务商预设 → 自动填好地址与模型
function applyProvider(m) {
  const p = PROVIDER_MAP[m.provider];
  if (p) {
    m.baseUrl = p.baseUrl;
    m.model = p.model;
    m.imageModel = p.imageModel;
  }
}
// 「添加模型」改为弹出独立弹窗填写，避免页面内联展开过长
const showAddModel = ref(false);
function blankModel() {
  return { name: "", provider: "", baseUrl: "", apiKey: "", model: "", imageModel: "", isDefault: false };
}
const newModel = ref(blankModel());
function addModel() {
  newModel.value = blankModel();
  newModel.value.isDefault = aiModels.value.length === 0;
  showAddModel.value = true;
}
function confirmAddModel() {
  const m = newModel.value;
  if (!m.name.trim()) return toast("请填写模型名称");
  if (!m.baseUrl.trim()) return toast("请填写 API 地址");
  if (m.isDefault) aiModels.value.forEach((x) => (x.isDefault = false));
  aiModels.value.push({
    id: "",
    name: m.name.trim(),
    provider: m.provider,
    baseUrl: m.baseUrl.trim(),
    apiKey: m.apiKey.trim(),
    model: m.model.trim(),
    imageModel: m.imageModel.trim(),
    isDefault: m.isDefault,
  });
  showAddModel.value = false;
  saveAi();
}
function removeModel(i) {
  aiModels.value.splice(i, 1);
  if (aiModels.value.length && !aiModels.value.some((m) => m.isDefault))
    aiModels.value[0].isDefault = true;
}
function setDefault(i) {
  aiModels.value.forEach((m, idx) => (m.isDefault = idx === i));
}

async function saveAi() {
  if (!aiModels.value.length) return toast("请至少添加一个模型");
  if (!aiModels.value.some((m) => m.baseUrl.trim())) return toast("请为每个模型填写 API 地址");
  aiSaving.value = true;
  try {
    await api.put("/settings/ai", { models: aiModels.value.map((m) => ({ ...m })) });
    toast("AI 记账设置已保存");
    await loadAi();
    store.fetchAiStatus();
  } catch (e) {
    toast(e.message);
  } finally {
    aiSaving.value = false;
  }
}

async function saveNickname() {
  if (!nickname.value.trim()) return toast("昵称不能为空");
  try {
    const { data } = await api.put("/auth/me", { nickname: nickname.value.trim() });
    store.setUser(data.user);
    toast("昵称已保存，历史账单归属已同步更新");
  } catch (e) { toast(e.message); }
}
async function savePwd() {
  if (!pwd.value.oldPassword || !pwd.value.newPassword) return toast("请填写完整");
  try {
    await api.put("/auth/me", pwd.value);
    pwd.value = { oldPassword: "", newPassword: "" };
    toast("密码已修改");
  } catch (e) { toast(e.message); }
}

// ---------------- 导航栏自定义（顺序 + 改名，存 localStorage） ----------------
const ALL_NAV = [
  { name: "dashboard", label: "首页", icon: "🏠" },
  { name: "flows", label: "流水", icon: "📒" },
  { name: "stats", label: "统计", icon: "📊" },
  { name: "budgets", label: "预算", icon: "🎯" },
  { name: "ai", label: "AI记账", icon: "✨" },
  { name: "import", label: "导入", icon: "📥" },
  { name: "books", label: "账本", icon: "📚" },
  { name: "categories", label: "分类", icon: "🏷️" },
  { name: "presets", label: "常用名称", icon: "🔖" },
  { name: "bills", label: "账单", icon: "🧾" },
  { name: "savings", label: "存款目标", icon: "🏁" },
  { name: "wallets", label: "分类钱包", icon: "👝" },
  { name: "users", label: "用户管理", icon: "👥", admin: true },
  { name: "settings", label: "设置", icon: "⚙️" },
];
const NAV_ORDER_KEY = "jizhang_nav_order";
const NAV_NAMES_KEY = "jizhang_nav_names";
const navItems = ref([]);
function loadNav() {
  let order = [];
  let names = {};
  try {
    order = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || "[]");
    names = JSON.parse(localStorage.getItem(NAV_NAMES_KEY) || "{}");
  } catch {}
  const byName = Object.fromEntries(ALL_NAV.map((n) => [n.name, n]));
  const ordered = order.map((nm) => byName[nm]).filter(Boolean);
  const rest = ALL_NAV.filter((n) => !order.includes(n.name));
  navItems.value = [...ordered, ...rest].map((n) => ({
    ...n,
    label: names[n.name] || n.label,
  }));
}
function saveNav() {
  localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(navItems.value.map((n) => n.name)));
  const names = {};
  for (const n of navItems.value) names[n.name] = n.label;
  localStorage.setItem(NAV_NAMES_KEY, JSON.stringify(names));
  toast("导航栏已保存（刷新后生效）");
}
function navMove(i, dir) {
  const to = i + dir;
  if (to < 0 || to >= navItems.value.length) return;
  const arr = [...navItems.value];
  [arr[i], arr[to]] = [arr[to], arr[i]];
  navItems.value = arr;
}
function navReset() {
  localStorage.removeItem(NAV_ORDER_KEY);
  localStorage.removeItem(NAV_NAMES_KEY);
  loadNav();
  toast("已恢复默认导航");
}
onMounted(loadNav);

// ---------------- 关于信息（合并到外观 & 关于） ----------------
const aboutMeta = ref({ name: "记账本", version: "…" });
async function loadAbout() {
  try {
    const { data } = await api.get("/meta");
    aboutMeta.value = data;
  } catch {
    aboutMeta.value = { name: "记账本", version: "dev" };
  }
}
async function copyVersion() {
  try {
    await navigator.clipboard.writeText(aboutMeta.value.version);
    toast("已复制版本号：" + aboutMeta.value.version);
  } catch {}
}
onMounted(loadAbout);
</script>

<template>
  <div>
    <h2 class="page-title">设置</h2>

    <div class="card">
      <div class="section-title">个人资料</div>
      <label class="field" style="max-width:320px">
        <span>昵称（也是账单归属显示名）</span>
        <input class="input" v-model.trim="nickname" />
      </label>
      <button class="btn btn-primary" @click="saveNickname">保存昵称</button>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">修改密码</div>
      <label class="field" style="max-width:320px"><span>原密码</span><input class="input" type="password" v-model="pwd.oldPassword" /></label>
      <label class="field" style="max-width:320px"><span>新密码</span><input class="input" type="password" v-model="pwd.newPassword" /></label>
      <button class="btn btn-primary" @click="savePwd">修改密码</button>
    </div>

    <!-- AI 记账设置：仅管理员可配置（全局生效，支持多个模型） -->
    <div class="card" style="margin-top:16px" v-if="isAdmin">
      <div class="section-title">AI 记账设置</div>
      <p class="muted" style="font-size:13px;margin:0 0 14px;line-height:1.7">
        可添加<b>多个模型</b>（例如你自有其它厂商的 Key）。列表里每条是一个模型，点「＋ 新增模型」继续添加；勾选「默认」的那条用于记账。<br />
        已内置多家服务商预设（智谱 / DeepSeek / 通义 / Kimi / 硅基流动 / 百川 / MiniMax / 阶跃 / 火山方舟 / OpenAI / OpenRouter / Gemini / 本地 Ollama 等），<b>选一个会自动填好地址与模型</b>；也可选「自定义」填任意 OpenAI 兼容接口。<br />
        例：<b>智谱</b>免费模型文本 <code>glm-4-flash</code>、图片 <code>glm-4v-flash</code>，在
        <a href="https://open.bigmodel.cn" target="_blank" rel="noreferrer">开放平台</a> 拿到 Key 填下方即可。
      </p>

      <div class="model-card" v-for="(m, i) in aiModels" :key="i">
        <div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
          <input class="input" style="flex:1;min-width:140px" v-model.trim="m.name" placeholder="模型名称，如 智谱" />
          <label class="radio"><input type="radio" :checked="m.isDefault" @change="setDefault(i)" /> 默认</label>
          <button class="btn btn-sm btn-danger" @click="removeModel(i)">删除</button>
        </div>
        <div class="row form-row" style="margin-top:8px">
          <select class="select" style="min-width:200px" v-model="m.provider" @change="applyProvider(m)">
            <option value="">自定义 / 其他</option>
            <optgroup v-for="g in PROVIDER_GROUPS" :key="g.group" :label="g.group">
              <option v-for="p in g.items" :key="p.key" :value="p.key">{{ p.label }}</option>
            </optgroup>
          </select>
          <label class="field" style="flex:2;min-width:220px">
            <span>API 地址（Base URL）</span>
            <input class="input" v-model.trim="m.baseUrl" placeholder="https://open.bigmodel.cn/api/paas/v4" />
          </label>
        </div>
        <div class="row form-row" style="margin-top:8px">
          <label class="field" style="flex:2;min-width:200px">
            <span>API Key{{ m.apiKey === '******' ? '（已保存，留空保持不变）' : '' }}</span>
            <input class="input" type="password" v-model="m.apiKey" placeholder="API Key" />
          </label>
          <label class="field" style="flex:1;min-width:140px">
            <span>文本模型</span>
            <input class="input" v-model.trim="m.model" placeholder="glm-4-flash" />
          </label>
          <label class="field" style="flex:1;min-width:140px">
            <span>图片/视觉模型</span>
            <input class="input" v-model.trim="m.imageModel" placeholder="glm-4v-flash" />
          </label>
        </div>
      </div>

      <button class="btn btn-sm" style="margin-top:6px" @click="addModel">＋ 新增模型</button>

      <div class="row" style="align-items:center;gap:14px;margin-top:14px">
        <span class="tag" :style="{ color: aiStatus.enabled ? 'var(--income)' : 'var(--text-2)' }">
          {{ aiStatus.enabled ? "● 已启用" : "○ 未启用" }}
        </span>
        <button class="btn btn-primary" :disabled="aiSaving" @click="saveAi">{{ aiSaving ? "保存中…" : "保存 AI 设置" }}</button>
      </div>
    </div>

    <!-- 新增 AI 模型弹窗 -->
    <div v-if="showAddModel" class="modal-mask" @click.self="showAddModel = false">
      <div class="modal" style="max-width:640px">
        <h3 class="modal-title">新增 AI 模型</h3>
        <label class="field" style="max-width:none"><span>模型名称</span>
          <input class="input" v-model.trim="newModel.name" placeholder="如 智谱 / 我自己的 Key" />
        </label>
        <label class="field" style="max-width:none">
          <span>服务商预设（选一个自动填好地址与模型）</span>
          <select class="select" v-model="newModel.provider" @change="applyProvider(newModel)">
            <option value="">自定义 / 其他</option>
            <optgroup v-for="g in PROVIDER_GROUPS" :key="g.group" :label="g.group">
              <option v-for="p in g.items" :key="p.key" :value="p.key">{{ p.label }}</option>
            </optgroup>
          </select>
        </label>
        <label class="field" style="max-width:none"><span>API 地址（Base URL）</span>
          <input class="input" v-model.trim="newModel.baseUrl" placeholder="https://open.bigmodel.cn/api/paas/v4" />
        </label>
        <label class="field" style="max-width:none"><span>API Key</span>
          <input class="input" type="password" v-model="newModel.apiKey" placeholder="API Key" />
        </label>
        <div class="row form-row">
          <label class="field" style="flex:1;min-width:200px"><span>文本模型</span>
            <input class="input" v-model.trim="newModel.model" placeholder="glm-4-flash" />
          </label>
          <label class="field" style="flex:1;min-width:200px"><span>图片 / 视觉模型</span>
            <input class="input" v-model.trim="newModel.imageModel" placeholder="glm-4v-flash" />
          </label>
        </div>
        <label class="radio" style="margin:2px 0 12px"><input type="checkbox" v-model="newModel.isDefault" /> 设为默认模型（用于记账）</label>
        <div class="row" style="align-items:center;justify-content:flex-end;gap:8px">
          <button class="btn" @click="showAddModel = false">取消</button>
          <button class="btn btn-primary" @click="confirmAddModel">添加</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">导航栏管理</div>
      <p class="muted" style="font-size:13px;margin:0 0 10px">
        调整左侧导航的顺序与名称（保存后刷新侧边栏生效；「用户管理」仅管理员可见）。
      </p>
      <div class="nav-manage">
        <div v-for="(n, i) in navItems" :key="n.name" class="nav-manage-row">
          <span class="nav-ic">{{ n.icon }}</span>
          <input class="input" style="flex:1;min-width:120px" v-model.trim="n.label" placeholder="名称" />
          <span class="muted small" style="width:88px">{{ n.name }}</span>
          <span class="row" style="gap:4px">
            <button class="btn btn-sm" :disabled="i === 0" @click="navMove(i, -1)">↑</button>
            <button class="btn btn-sm" :disabled="i === navItems.length - 1" @click="navMove(i, 1)">↓</button>
          </span>
        </div>
      </div>
      <div class="row" style="align-items:center;gap:8px;margin-top:10px">
        <button class="btn btn-primary" @click="saveNav">保存导航</button>
        <button class="btn" @click="navReset">恢复默认</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">外观 & 关于</div>
      <div class="row" style="align-items:center;gap:14px">
        <span class="muted">主题</span>
        <button class="btn" @click="store.toggleTheme()">{{ store.theme === "light" ? "🌙 切换到深色" : "☀️ 切换到浅色" }}</button>
      </div>
      <div class="row" style="align-items:center;gap:14px;margin-top:12px">
        <span class="muted">应用</span>
        <span class="about-app">
          <img class="about-logo" src="/logo.png" alt="" />
          <b>{{ aboutMeta.name }}</b>
          <code class="about-ver" title="点击复制版本号" @click="copyVersion">{{ aboutMeta.version }}</code>
        </span>
      </div>
      <div class="row" style="align-items:center;gap:14px;margin-top:12px">
        <span class="muted">AI 服务</span>
        <span class="tag" :style="{ color: store.aiEnabled ? 'var(--income)' : 'var(--text-2)' }">
          {{ store.aiEnabled ? "已启用" : "未配置（使用本地规则）" }}
        </span>
      </div>
      <div class="row" style="align-items:center;gap:14px;margin-top:12px">
        <span class="muted">自助注册</span>
        <span class="tag">已关闭 · 账号由管理员创建</span>
      </div>
      <p class="muted" style="font-size:13px;margin-top:14px;line-height:1.7">
        记账本 · 自建版　|　数据存储于本机 SQLite，完全私有可控。<br />
        新增账号请管理员到「用户管理」页操作；端口等配置改 docker-compose 环境变量后重启容器。<br />
        版本号格式 vYYMMDD-HHMM，对应镜像构建时间。
      </p>
    </div>
  </div>
</template>

<style scoped>
.form-row { align-items: flex-end; flex-wrap: wrap; gap: 12px; }
.form-row .field { margin-bottom: 0; }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.nav-manage { border: 1px solid var(--border); border-radius: 10px; padding: 4px 10px; }
.nav-manage-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.nav-manage-row:last-child { border-bottom: none; }
.nav-ic { font-size: 15px; width: 22px; text-align: center; }
.about-app { display: inline-flex; align-items: center; gap: 8px; }
.about-logo { width: 26px; height: 26px; border-radius: 6px; }
.about-ver { cursor: pointer; user-select: none; }
</style>
