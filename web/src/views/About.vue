<script setup>
import { ref, onMounted } from "vue";
import api from "../api.js";

const meta = ref({ name: "记账本", version: "…" });
const loading = ref(true);

onMounted(async () => {
  try {
    const { data } = await api.get("/meta");
    meta.value = data;
  } catch {
    meta.value = { name: "记账本", version: "dev" };
  } finally {
    loading.value = false;
  }
});

async function copyVersion() {
  try {
    await navigator.clipboard.writeText(meta.value.version);
    toast("已复制版本号：" + meta.value.version);
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}

import { toast } from "../toast.js";
</script>

<template>
  <div class="about">
    <h2 class="page-title">关于</h2>

    <div class="card block">
      <div class="logo">💰</div>
      <div class="name">{{ meta.name }}</div>
      <div class="ver" @click="copyVersion" title="点击复制版本号">
        {{ loading ? "读取中…" : meta.version }}
        <span class="copy">复制</span>
      </div>
      <p class="muted desc">
        一款可私有部署在 NAS 的家庭记账应用，数据保存在你自己的设备上。
      </p>
    </div>

    <div class="card block">
      <div class="row"><span class="k">应用名称</span><span class="v">{{ meta.name }}</span></div>
      <div class="row"><span class="k">版本号</span><span class="v">{{ meta.version }}</span></div>
      <div class="row"><span class="k">数据存储</span><span class="v">本机 SQLite（/app/data）</span></div>
      <div class="row"><span class="k">部署方式</span><span class="v">Docker 单容器</span></div>
    </div>

    <p class="muted foot">版本号格式 vYYMMDD-HHMM，对应镜像构建时间。</p>
  </div>
</template>

<style scoped>
.about { max-width: 640px; }
.block { padding: 22px; margin-bottom: 16px; text-align: center; }
.logo { font-size: 44px; }
.name { font-size: 20px; font-weight: 800; margin-top: 6px; }
.ver {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 16px; font-weight: 700; color: var(--primary);
  background: var(--primary-soft); padding: 6px 12px; border-radius: 999px; cursor: pointer;
  user-select: none;
}
.copy { font-size: 12px; font-weight: 500; color: var(--text-2); }
.desc { margin-top: 14px; line-height: 1.6; }
.row { display: flex; justify-content: space-between; padding: 11px 4px; border-bottom: 1px dashed var(--border); font-size: 14px; }
.row:last-child { border-bottom: none; }
.k { color: var(--text-2); }
.v { font-weight: 600; }
.foot { font-size: 12px; text-align: center; margin-top: 4px; }
</style>
