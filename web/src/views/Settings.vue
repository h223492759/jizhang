<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const nickname = ref(store.user?.nickname || "");
const pwd = ref({ oldPassword: "", newPassword: "" });

const isAdmin = computed(() => store.user?.role === "admin");

// ---------------- AI 记账设置 ----------------
const aiForm = reactive({ provider: "", baseUrl: "", apiKey: "", model: "", imageModel: "" });
const aiStatus = ref({ enabled: false });
const aiSaving = ref(false);

// 常见服务商预设（智谱免费文本 glm-4-flash、免费视觉 glm-4v-flash）
const PROVIDERS = {
  zhipu: { label: "智谱 AI（BigModel）", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", imageModel: "glm-4v-flash" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", imageModel: "gpt-4o-mini" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imageModel: "" },
  qwen: { label: "通义千问（DashScope）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", imageModel: "qwen-vl-plus" },
  custom: { label: "自定义 / 其他 OpenAI 兼容", baseUrl: "", model: "", imageModel: "" },
};

function onProvider() {
  const p = PROVIDERS[aiForm.provider];
  if (p) {
    aiForm.baseUrl = p.baseUrl;
    aiForm.model = p.model;
    aiForm.imageModel = p.imageModel;
  }
}

async function loadAi() {
  if (!isAdmin.value) return;
  try {
    const { data } = await api.get("/settings/ai");
    aiForm.provider = data.provider || "";
    aiForm.baseUrl = data.baseUrl || "";
    aiForm.apiKey = data.apiKey || ""; // 已保存时返回 "******" 占位
    aiForm.model = data.model || "";
    aiForm.imageModel = data.imageModel || "";
    aiStatus.value = { enabled: data.enabled };
  } catch {}
}
onMounted(loadAi);

async function saveAi() {
  if (!aiForm.baseUrl.trim()) return toast("请填写 API 地址");
  aiSaving.value = true;
  try {
    await api.put("/settings/ai", {
      provider: aiForm.provider,
      baseUrl: aiForm.baseUrl.trim(),
      apiKey: aiForm.apiKey,
      model: aiForm.model.trim(),
      imageModel: aiForm.imageModel.trim(),
    });
    toast("AI 记账设置已保存");
    aiStatus.value = { enabled: true };
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

    <!-- AI 记账设置：仅管理员可配置（全局生效） -->
    <div class="card" style="margin-top:16px" v-if="isAdmin">
      <div class="section-title">AI 记账设置</div>
      <p class="muted" style="font-size:13px;margin:0 0 14px;line-height:1.7">
        配置后可在「AI 记账」页用一句话或一张小票截图自动记账。<br />
        例如使用<b>智谱</b>的免费模型：文本用 <code>glm-4-flash</code>、图片/视觉用 <code>glm-4v-flash</code>，在
        <a href="https://open.bigmodel.cn" target="_blank" rel="noreferrer">开放平台</a> 拿到 API Key 填到下方即可。
      </p>

      <div class="row form-row">
        <label class="field" style="flex:1;min-width:200px">
          <span>服务商（预设）</span>
          <select class="select" v-model="aiForm.provider" @change="onProvider">
            <option value="">自定义</option>
            <option v-for="(v, k) in PROVIDERS" :key="k" :value="k">{{ v.label }}</option>
          </select>
        </label>
        <label class="field" style="flex:2;min-width:240px">
          <span>API 地址（Base URL）</span>
          <input class="input" v-model.trim="aiForm.baseUrl" placeholder="https://open.bigmodel.cn/api/paas/v4" />
        </label>
      </div>

      <div class="row form-row">
        <label class="field" style="flex:2;min-width:240px">
          <span>API Key</span>
          <input class="input" type="password" v-model="aiForm.apiKey" placeholder="已保存则显示 ••••，留空保持不变" />
        </label>
        <label class="field" style="flex:1;min-width:160px">
          <span>文本模型</span>
          <input class="input" v-model.trim="aiForm.model" placeholder="glm-4-flash" />
        </label>
        <label class="field" style="flex:1;min-width:160px">
          <span>图片/视觉模型</span>
          <input class="input" v-model.trim="aiForm.imageModel" placeholder="glm-4v-flash" />
        </label>
      </div>

      <div class="row" style="align-items:center;gap:14px;margin-top:4px">
        <span class="tag" :style="{ color: aiStatus.enabled ? 'var(--income)' : 'var(--text-2)' }">
          {{ aiStatus.enabled ? "● 已启用" : "○ 未启用" }}
        </span>
        <button class="btn btn-primary" :disabled="aiSaving" @click="saveAi">{{ aiSaving ? "保存中…" : "保存 AI 设置" }}</button>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">外观 & 关于</div>
      <div class="row" style="align-items:center;gap:14px">
        <span class="muted">主题</span>
        <button class="btn" @click="store.toggleTheme()">{{ store.theme === "light" ? "🌙 切换到深色" : "☀️ 切换到浅色" }}</button>
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
        新增账号请管理员到「用户管理」页操作；端口等配置改 docker-compose 环境变量后重启容器。
      </p>
    </div>
  </div>
</template>

<style scoped>
.form-row { align-items: flex-end; flex-wrap: wrap; gap: 12px; }
.form-row .field { margin-bottom: 0; }
code { background: var(--surface-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
</style>
