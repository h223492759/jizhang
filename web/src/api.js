import axios from "axios";
import router from "./router.js";

const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  const bookId = localStorage.getItem("bookId");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  // 自动附带当前账本ID
  if (bookId) {
    if (cfg.method === "get") {
      cfg.params = { bookId, ...(cfg.params || {}) };
    } else if (!(cfg.data instanceof FormData)) {
      cfg.data = { bookId: Number(bookId), ...(cfg.data || {}) };
    }
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.error || err.message || "请求失败";
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      if (router.currentRoute.value.name !== "login") router.push("/login");
    }
    return Promise.reject(new Error(msg));
  }
);

export default api;
