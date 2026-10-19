<script setup>
// 自动记账运行日志（安卓端上传，服务端不限条数留存）
//
// 用途：家人反馈「某笔支付没自动记账」时，在这里按时间/设备/关键词回查——
// 安卓端本地只留最近 300 条，日志同步上来后服务端永久保留，才能事后定位原因
// （例如「顶部命中列表词，疑似历史明细，跳过」「0元跳过:营销黑名单匹配」）。
import { ref, computed, onMounted, onUnmounted } from "vue";
import api from "../api.js";
import { toast } from "../toast.js";

const PAGE = 300;
const list = ref([]);
const total = ref(0);
const devices = ref([]); // [{device, platform, app_version, count, last_ts, book_name}]
const loading = ref(false);
const autoRefresh = ref(false);
let timer = null;

const q = ref("");
const device = ref("");
const scope = ref("current"); // current | all（all 仅管理员可见全部账本）
const isAdmin = computed(() => {
  try {
    return JSON.parse(localStorage.getItem("userRole") || "null") === "admin";
  } catch {
    return false;
  }
});

// 空串 = 不按账本过滤（后端只返回当前账号有权限的账本；axios 拦截器会把 bookId 覆盖为该值）
const bookId = computed(() =>
  scope.value === "all" ? "" : localStorage.getItem("bookId") || ""
);

async function load(append = false) {
  loading.value = true;
  try {
    const { data } = await api.get("/logs/client", {
      params: {
        limit: PAGE,
        offset: append ? list.value.length : 0,
        q: q.value.trim(),
        device: device.value,
        bookId: bookId.value,
      },
    });
    const rows = data.list || [];
    list.value = append ? [...list.value, ...rows] : rows;
    total.value = data.total || 0;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadDevices() {
  try {
    const { data } = await api.get("/logs/client/devices", {
      params: { bookId: bookId.value },
    });
    devices.value = data.list || [];
  } catch {
    devices.value = [];
  }
}

function reload() {
  load(false);
  loadDevices();
}

function copyAll() {
  const text = list.value.map((r) => r.line).join("\n");
  if (!text) return toast("没有可复制的日志");
  navigator.clipboard
    .writeText(text)
    .then(() => toast(`已复制 ${list.value.length} 条日志`))
    .catch(() => toast("复制失败，请手动选择"));
}

function toggleAuto() {
  autoRefresh.value = !autoRefresh.value;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (autoRefresh.value) {
    timer = setInterval(() => load(false), 15000);
    toast("已开启自动刷新（15 秒）");
  }
}

/** 日志行拆成 [时间] + 正文，便于对齐阅读 */
function splitLine(line) {
  const m = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*([\s\S]*)$/.exec(line || "");
  return m ? { ts: m[1], body: m[2] } : { ts: "", body: line || "" };
}

function lineClass(body) {
  if (body.startsWith("已记账")) return "ok";
  if (body.includes("跳过") || body.includes("失败")) return "warn";
  return "";
}

onMounted(reload);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">📜 记账日志</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" @click="copyAll">复制当前结果</button>
        <button class="btn btn-sm" :class="{ 'btn-primary': autoRefresh }" @click="toggleAuto">
          {{ autoRefresh ? "停止自动刷新" : "自动刷新" }}
        </button>
        <button class="btn btn-sm" @click="reload">刷新</button>
      </div>
    </div>
    <p class="muted" style="margin-top:2px;font-size:13px">
      安卓端自动记账的运行日志会自动同步到服务器（手机只留最近 300 条，这里不限条数、长期保留）。
      「某笔为什么没记上」可在此按时间/设备/关键词回查：可搜
      <code>跳过</code>、<code>未入账</code>、<code>去重跳过</code>、或商户名。
    </p>

    <div class="card filter-bar">
      <select v-model="scope" class="select" style="width:auto;min-width:120px" @change="reload">
        <option value="current">当前账本</option>
        <option v-if="isAdmin" value="all">全部账本</option>
      </select>
      <select v-model="device" class="select" style="width:auto;min-width:190px" @change="load(false)">
        <option value="">全部设备（{{ devices.length }}）</option>
        <option v-for="d in devices" :key="d.book_id + '-' + d.device" :value="d.device">
          {{ d.device }} · {{ d.book_name || "—" }} · {{ d.count }} 条
        </option>
      </select>
      <input
        v-model="q"
        class="input"
        style="flex:1;min-width:180px"
        placeholder="关键词过滤（如 跳过 / 支付宝 / 某商户名）"
        @keyup.enter="load(false)"
      />
      <button class="btn btn-sm" @click="load(false)">查询</button>
      <span class="muted small">共 {{ total }} 条，已显示 {{ list.length }} 条</span>
    </div>

    <div class="card" style="padding:0;margin-top:12px">
      <div v-if="loading && !list.length" class="empty-tip">加载中…</div>
      <div v-else-if="!list.length" class="empty-tip">
        暂无日志。安卓端「自动记账」页能看到本机日志；同步是自动的（App 打开/回到前台时上传）。
      </div>
      <div v-else class="log-list">
        <div v-for="it in list" :key="it.id" class="log-row">
          <div class="log-meta">
            <span class="log-ts">{{ splitLine(it.line).ts || it.created_at }}</span>
            <span class="tag">{{ it.device }}</span>
            <span class="muted small">{{ it.nickname || "—" }} · {{ it.book_name || "—" }}</span>
          </div>
          <div class="log-body" :class="lineClass(splitLine(it.line).body)">
            {{ splitLine(it.line).body }}
          </div>
        </div>
      </div>
      <div v-if="list.length && list.length < total" style="padding:12px;text-align:center">
        <button class="btn btn-sm" :disabled="loading" @click="load(true)">
          {{ loading ? "加载中…" : "加载更多" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.empty-tip {
  text-align: center;
  padding: 30px 16px;
  color: var(--text-2);
  font-size: 13px;
}
.filter-bar {
  padding: 10px 12px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.small {
  font-size: 12px;
}
.log-list {
  max-height: 64vh;
  overflow: auto;
}
.log-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.log-row:last-child {
  border-bottom: none;
}
.log-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.log-ts {
  color: var(--text-2);
}
.log-body {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.45;
}
.log-body.ok {
  color: var(--income-strong);
}
.log-body.warn {
  color: var(--warn-strong);
}
</style>
