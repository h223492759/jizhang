<script setup>
import { ref, onMounted } from "vue";
import api from "../api.js";
import { toast } from "../toast.js";

const list = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get("/flows/trash");
    list.value = data.list || [];
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}

const fmtMoney = (v) =>
  Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function restore(it) {
  if (!confirm(`恢复这笔流水？\n「${it.description || it.category}」¥${fmtMoney(it.amount)}\n恢复后将重新出现在流水列表中（共享账本全员同步可见）。`)) return;
  try {
    await api.post(`/flows/trash/${it.id}/restore`);
    toast("已恢复");
    load();
  } catch (e) {
    toast(e.message);
  }
}

async function purge(it) {
  if (!confirm(`彻底删除这笔流水？\n「${it.description || it.category}」¥${fmtMoney(it.amount)}\n此操作不可恢复！`)) return;
  try {
    await api.delete(`/flows/trash/${it.id}`);
    toast("已彻底删除");
    load();
  } catch (e) {
    toast(e.message);
  }
}

async function emptyTrash() {
  if (!list.value.length) return;
  if (!confirm(`清空回收站全部 ${list.value.length} 条？此操作不可恢复！`)) return;
  try {
    for (const it of [...list.value]) await api.delete(`/flows/trash/${it.id}`);
    toast("回收站已清空");
    load();
  } catch (e) {
    toast(e.message);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">🗑️ 回收站</h2>
      <div>
        <button class="btn" v-if="list.length" @click="emptyTrash" style="color:var(--danger,#e05a5a)">清空回收站</button>
      </div>
    </div>
    <p class="muted" style="margin-top:2px;font-size:13px">
      删除的流水会保留在此，可恢复或彻底删除。共享账本中全员可见，删除/恢复对所有成员生效。
    </p>

    <div class="card" style="padding:0;margin-top:12px">
      <div v-if="loading" class="empty-tip">加载中…</div>
      <div v-else-if="!list.length" class="empty-tip">回收站是空的 🎉</div>
      <table class="tbl" v-else>
        <thead>
          <tr>
            <th>时间</th>
            <th>分类</th>
            <th>名称</th>
            <th style="text-align:right">金额</th>
            <th class="hide-mobile">归属</th>
            <th>删除人</th>
            <th>删除时间</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in list" :key="it.id">
            <td class="muted">{{ (it.flow_time || "").slice(0, 16) }}</td>
            <td>
              <span class="tag" :class="it.type">{{ it.type === "expense" ? "支出" : "收入" }}</span>
              {{ it.category }}
            </td>
            <td class="ellip" style="max-width:180px">{{ it.description || it.category }}</td>
            <td style="text-align:right" :class="it.type"><b>{{ fmtMoney(it.amount) }}</b></td>
            <td class="hide-mobile muted">{{ it.attribution || "—" }}</td>
            <td>
              {{ it.deleted_by }}
              <span v-if="it.deleted_by_uid" class="muted small">(成员)</span>
            </td>
            <td class="muted">{{ (it.deleted_at || "").slice(0, 16) }}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" @click="restore(it)">恢复</button>
              <button class="btn btn-sm btn-danger" @click="purge(it)">彻底删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
