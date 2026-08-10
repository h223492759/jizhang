import { defineStore } from "pinia";
import api from "./api.js";

export const useStore = defineStore("main", {
  state: () => ({
    user: null,
    books: [],
    bookId: Number(localStorage.getItem("bookId")) || null,
    categories: [],
    theme: localStorage.getItem("theme") || "light",
    aiEnabled: false,
  }),
  getters: {
    currentBook: (s) => s.books.find((b) => b.id === s.bookId) || null,
    expenseCats: (s) => s.categories.filter((c) => c.type === "expense"),
    incomeCats: (s) => s.categories.filter((c) => c.type === "income"),
  },
  actions: {
    // 统一入口：顺便把角色缓存到 localStorage，供路由守卫做管理员页面拦截
    setUser(u) {
      this.user = u;
      if (u?.role) localStorage.setItem("userRole", JSON.stringify(u.role));
      else localStorage.removeItem("userRole");
    },
    async fetchMe() {
      const { data } = await api.get("/auth/me");
      this.setUser(data.user);
    },
    async fetchBooks() {
      const { data } = await api.get("/books");
      this.books = data;
      if (!this.bookId || !data.find((b) => b.id === this.bookId)) {
        this.setBook(data[0]?.id || null);
      }
    },
    setBook(id) {
      this.bookId = id;
      if (id) localStorage.setItem("bookId", id);
      else localStorage.removeItem("bookId");
    },
    async fetchCategories() {
      if (!this.bookId) return;
      const { data } = await api.get("/categories");
      this.categories = data;
    },
    async fetchAiStatus() {
      try {
        const { data } = await api.get("/ai/status");
        this.aiEnabled = data.enabled;
      } catch {}
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      localStorage.setItem("theme", this.theme);
      document.documentElement.setAttribute("data-theme", this.theme);
    },
    logout() {
      localStorage.removeItem("token");
      localStorage.removeItem("userRole");
      this.user = null;
      this.books = [];
      this.categories = [];
    },
    async bootstrap() {
      await this.fetchMe();
      await this.fetchBooks();
      await this.fetchCategories();
      this.fetchAiStatus();
    },
  },
});
