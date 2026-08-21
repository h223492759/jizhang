<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import api from "../api.js";

const store = useStore();
const router = useRouter();
const route = useRoute();
const ready = ref(false);
const menuOpen = ref(false);
// 版本号：构建时由服务端 /api/meta 下发（如 v260821-1128），显示在顶部「记账本」右侧
const version = ref("");

const allNav = [
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

// 导航自定义（顺序 + 改名）存 localStorage：设置页里可调整
function loadNavCustom() {
  try {
    const order = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || "null");
    const names = JSON.parse(localStorage.getItem(NAV_NAMES_KEY) || "{}");
    return { order, names };
  } catch {
    return { order: null, names: {} };
  }
}
function applyNavCustom() {
  const { order, names } = loadNavCustom();
  let list = [...allNav];
  if (Array.isArray(order) && order.length) {
    const byName = Object.fromEntries(list.map((n) => [n.name, n]));
    const ordered = order.map((nm) => byName[nm]).filter(Boolean);
    const rest = list.filter((n) => !order.includes(n.name));
    list = [...ordered, ...rest];
  }
  return list.map((n) => ({
    ...n,
    label: names[n.name] || n.label,
  }));
}
// 「用户管理」只对管理员显示；顺序/名称按自定义
const nav = computed(() =>
  applyNavCustom().filter((n) => !n.admin || store.user?.role === "admin")
);

onMounted(async () => {
  try {
    await store.bootstrap();
  } catch (e) {
    toast(e.message);
    if (e.message.includes("登录")) router.push("/login");
  }
  ready.value = true;
  // 拉版本号显示在侧边栏「记账本」右侧
  try {
    const { data } = await api.get("/meta");
    if (data?.version) version.value = `v${data.version.replace(/^v/i, "")}`;
  } catch (_) {}
});

async function switchBook(e) {
  store.setBook(Number(e.target.value));
  await store.fetchCategories();
  toast("已切换账本：" + (store.currentBook?.name || ""));
  // 触发当前页刷新
  router.replace({ path: route.path, query: { ...route.query, _t: Date.now() } });
}

function go(name) {
  menuOpen.value = false;
  router.push({ name });
}

function logout() {
  store.logout();
  router.push("/login");
}
</script>

<template>
  <div class="shell" v-if="ready">
    <!-- 侧边栏（桌面） -->
    <aside class="side hide-mobile">
      <div class="side-brand"><img class="brand-logo" src="/logo.png" alt="" /><span>记账本</span><em class="side-ver">{{ version }}</em></div>
      <nav>
        <a v-for="n in nav" :key="n.name" :class="['nav-item', { active: route.name === n.name }]" @click="go(n.name)">
          <span class="ic">{{ n.icon }}</span>{{ n.label }}
        </a>
      </nav>
      <div class="side-foot">
        <div class="who">
          <div class="avatar">{{ (store.user?.nickname || "U").slice(0, 1) }}</div>
          <div>
            <div class="who-name">{{ store.user?.nickname }}</div>
            <a class="muted logout" @click="logout">退出登录</a>
          </div>
        </div>
      </div>
    </aside>

    <!-- 顶栏 -->
    <div class="main">
      <header class="topbar">
        <button class="btn btn-sm menu-btn" @click="menuOpen = !menuOpen">☰</button>
        <select class="select book-select" :value="store.bookId" @change="switchBook">
          <option v-for="b in store.books" :key="b.id" :value="b.id">
            {{ b.name }}{{ b.members > 1 ? ` (共享·${b.members}人)` : "" }}
          </option>
        </select>
        <div class="spacer"></div>
        <button class="btn btn-sm" @click="store.toggleTheme()">
          {{ store.theme === "light" ? "🌙" : "☀️" }}
        </button>
      </header>

      <!-- 移动端抽屉 -->
      <div v-if="menuOpen" class="drawer-mask" @click="menuOpen = false">
        <div class="drawer" @click.stop>
          <div class="side-brand"><img class="brand-logo" src="/logo.png" alt="" /><span>记账本</span><em class="side-ver">{{ version }}</em></div>
          <a v-for="n in nav" :key="n.name" :class="['nav-item', { active: route.name === n.name }]" @click="go(n.name)">
            <span class="ic">{{ n.icon }}</span>{{ n.label }}
          </a>
          <a class="nav-item" @click="logout"><span class="ic">🚪</span>退出登录</a>
        </div>
      </div>

      <main class="content">
        <router-view :key="store.bookId + route.fullPath" />
      </main>

      <!-- 移动端底部导航 -->
      <nav class="tabbar hide-desktop">
        <a v-for="n in nav.slice(0, 5)" :key="n.name" :class="['tab', { active: route.name === n.name }]" @click="go(n.name)">
          <span>{{ n.icon }}</span><em>{{ n.label }}</em>
        </a>
      </nav>
    </div>
  </div>
  <div v-else class="loading">加载中…</div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.side {
  width: 210px; flex-shrink: 0; background: var(--surface);
  border-right: 1px solid var(--border); padding: 18px 12px;
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;
}
.side-brand { font-size: 15px; font-weight: 700; padding: 6px 10px 14px; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.brand-logo { width: 22px; height: 22px; border-radius: 5px; }
/* 版本号小字（记账本右侧） */
.side-ver { font-size: 11px; font-weight: 500; color: var(--text-2, #94a3b8); letter-spacing: 0.2px; margin-left: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-radius: 10px; cursor: pointer; color: var(--text-2); font-size: 14.5px; margin-bottom: 2px;
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.ic { font-size: 17px; }
.side-foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }
.who { display: flex; align-items: center; gap: 10px; padding: 6px; }
.avatar {
  width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700;
}
.who-name { font-size: 14px; font-weight: 600; }
.logout { font-size: 12px; cursor: pointer; }

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.topbar {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px;
  background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20;
}
.book-select { width: auto; min-width: 160px; max-width: 60vw; }
.spacer { flex: 1; }
.menu-btn { display: none; }
.content { padding: 20px; max-width: 1100px; width: 100%; margin: 0 auto; }

.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 60; }
.drawer { width: 230px; height: 100%; background: var(--surface); padding: 18px 12px; }

.tabbar { display: none; }
.loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: var(--text-2); }

.hide-desktop { display: none; }
@media (max-width: 720px) {
  .menu-btn { display: inline-flex; }
  .content { padding: 14px; padding-bottom: 76px; }
  .hide-desktop { display: flex; }
  .tabbar {
    position: fixed; bottom: 0; left: 0; right: 0; height: 60px;
    background: var(--surface); border-top: 1px solid var(--border);
    display: flex; z-index: 40;
  }
  .tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--text-2); cursor: pointer; }
  .tab span { font-size: 19px; }
  .tab em { font-style: normal; font-size: 11px; }
  .tab.active { color: var(--primary); }
}
</style>
