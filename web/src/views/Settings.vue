<script setup>
import { ref } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const nickname = ref(store.user?.nickname || "");
const pwd = ref({ oldPassword: "", newPassword: "" });

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
        新增账号请管理员到「用户管理」页操作；AI、端口等配置改 docker-compose 环境变量后重启容器。
      </p>
    </div>
  </div>
</template>
