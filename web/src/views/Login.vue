<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const router = useRouter();
const store = useStore();

const mode = ref("login"); // login | register
// 默认按「关闭注册」渲染，避免加载配置前闪一下注册入口
const allowRegister = ref(false);
const form = ref({ username: "", password: "", nickname: "" });
const loading = ref(false);

onMounted(async () => {
  try {
    const { data } = await api.get("/auth/config");
    allowRegister.value = data.allowRegister;
  } catch {}
});

async function submit() {
  if (!form.value.username || !form.value.password) return toast("请输入用户名和密码");
  loading.value = true;
  try {
    const url = mode.value === "login" ? "/auth/login" : "/auth/register";
    const { data } = await api.post(url, form.value);
    localStorage.setItem("token", data.token);
    store.setUser(data.user);
    await store.fetchBooks();
    await store.fetchCategories();
    store.fetchAiStatus();
    toast(mode.value === "login" ? "登录成功" : "注册成功");
    router.push("/dashboard");
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card card">
      <div class="brand">
        <div class="logo">💰</div>
        <h1>记账本</h1>
        <p class="muted">简单 · 好用 · 数据自主可控</p>
      </div>

      <label class="field">
        <span>用户名</span>
        <input class="input" v-model.trim="form.username" placeholder="请输入用户名" @keyup.enter="submit" />
      </label>
      <label class="field" v-if="mode === 'register'">
        <span>昵称（可选）</span>
        <input class="input" v-model.trim="form.nickname" placeholder="显示名称，也是账单归属名" />
      </label>
      <label class="field">
        <span>密码</span>
        <input class="input" type="password" v-model="form.password" placeholder="请输入密码" @keyup.enter="submit" />
      </label>

      <button class="btn btn-primary" style="width: 100%; margin-top: 6px" :disabled="loading" @click="submit">
        {{ loading ? "请稍候…" : mode === "login" ? "登 录" : "注 册" }}
      </button>

      <div class="switch" v-if="allowRegister">
        <span v-if="mode === 'login'">还没有账号？<a @click="mode = 'register'">立即注册</a></span>
        <span v-else>已有账号？<a @click="mode = 'login'">去登录</a></span>
      </div>
      <p class="muted tip" v-if="!allowRegister">本站未开放注册，需要账号请联系管理员创建</p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  min-height: 100%;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: radial-gradient(1200px 600px at 50% -10%, var(--primary-soft), transparent), var(--bg);
}
.auth-card { width: 100%; max-width: 380px; padding: 30px 26px; }
.brand { text-align: center; margin-bottom: 22px; }
.logo { font-size: 42px; }
.brand h1 { margin: 6px 0 2px; font-size: 24px; }
.switch { text-align: center; margin-top: 16px; font-size: 14px; color: var(--text-2); }
.switch a { color: var(--primary); cursor: pointer; }
.tip { text-align: center; font-size: 12px; margin-top: 14px; }
</style>
