import { createRouter, createWebHistory } from "vue-router";

const routes = [
  { path: "/login", name: "login", component: () => import("./views/Login.vue"), meta: { public: true } },
  {
    path: "/",
    component: () => import("./components/Layout.vue"),
    children: [
      { path: "", redirect: "/dashboard" },
      { path: "dashboard", name: "dashboard", component: () => import("./views/Dashboard.vue") },
      { path: "flows", name: "flows", component: () => import("./views/Flows.vue") },
      { path: "stats", name: "stats", component: () => import("./views/Stats.vue") },
      { path: "budgets", name: "budgets", component: () => import("./views/Budgets.vue") },
      { path: "ai", name: "ai", component: () => import("./views/AiView.vue") },
      { path: "import", name: "import", component: () => import("./views/ImportView.vue") },
      { path: "books", name: "books", component: () => import("./views/Books.vue") },
      { path: "categories", name: "categories", component: () => import("./views/Categories.vue") },
      { path: "presets", name: "presets", component: () => import("./views/Presets.vue") },
      { path: "users", name: "users", component: () => import("./views/Users.vue"), meta: { admin: true } },
      { path: "settings", name: "settings", component: () => import("./views/Settings.vue") },
      { path: "about", name: "about", component: () => import("./views/About.vue") },
    ],
  },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const token = localStorage.getItem("token");
  if (!to.meta.public && !token) return { name: "login" };
  if (to.name === "login" && token) return { name: "dashboard" };
  // 管理员专属页面：非管理员直接挡回首页（后端也有二次校验）
  if (to.meta.admin) {
    let role = null;
    try {
      role = JSON.parse(localStorage.getItem("userRole") || "null");
    } catch {}
    if (role && role !== "admin") return { name: "dashboard" };
  }
});

export default router;
