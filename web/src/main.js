import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router.js";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// 初始化主题
const saved = localStorage.getItem("theme") || "light";
document.documentElement.setAttribute("data-theme", saved);
