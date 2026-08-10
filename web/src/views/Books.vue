<script setup>
import { ref, onMounted } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const newName = ref("");
const membersDialog = ref(false);
const activeBook = ref(null);
const members = ref([]);
const inviteName = ref("");

async function refresh() {
  await store.fetchBooks();
}
onMounted(refresh);

async function create() {
  if (!newName.value.trim()) return toast("请输入账本名称");
  try {
    await api.post("/books", { bookId: undefined, name: newName.value.trim() });
    newName.value = "";
    toast("已创建");
    refresh();
  } catch (e) { toast(e.message); }
}
async function rename(b) {
  const name = prompt("重命名账本", b.name);
  if (!name || name === b.name) return;
  await api.put(`/books/${b.id}`, { name });
  toast("已重命名");
  refresh();
}
async function remove(b) {
  if (b.role !== "owner") return toast("只有拥有者可删除");
  if (!confirm(`删除账本「${b.name}」将清除其所有流水、分类、预算，确定吗？`)) return;
  try {
    await api.delete(`/books/${b.id}`);
    toast("已删除");
    if (store.bookId === b.id) store.setBook(null);
    await refresh();
    await store.fetchCategories();
  } catch (e) { toast(e.message); }
}
async function use(b) {
  store.setBook(b.id);
  await store.fetchCategories();
  toast("已切换到：" + b.name);
}

async function openMembers(b) {
  activeBook.value = b;
  const { data } = await api.get(`/books/${b.id}/members`);
  members.value = data;
  membersDialog.value = true;
}
async function invite() {
  if (!inviteName.value.trim()) return;
  try {
    await api.post(`/books/${activeBook.value.id}/members`, { username: inviteName.value.trim() });
    inviteName.value = "";
    const { data } = await api.get(`/books/${activeBook.value.id}/members`);
    members.value = data;
    toast("已添加成员");
    refresh();
  } catch (e) { toast(e.message); }
}
async function kick(m) {
  if (!confirm(`移除成员「${m.nickname}」？`)) return;
  await api.delete(`/books/${activeBook.value.id}/members/${m.id}`);
  const { data } = await api.get(`/books/${activeBook.value.id}/members`);
  members.value = data;
  refresh();
}
</script>

<template>
  <div>
    <h2 class="page-title">账本管理</h2>

    <div class="card">
      <div class="section-title">新建账本</div>
      <div class="row">
        <input class="input" style="max-width:280px" v-model.trim="newName" placeholder="账本名称，如「日常」「装修」" @keyup.enter="create" />
        <button class="btn btn-primary" @click="create">创建</button>
      </div>
    </div>

    <div class="grid book-list">
      <div v-for="b in store.books" :key="b.id" class="card book-item" :class="{ active: b.id === store.bookId }">
        <div class="book-top">
          <b class="bname">📚 {{ b.name }}</b>
          <span v-if="b.id === store.bookId" class="tag" style="color:var(--primary)">当前</span>
        </div>
        <div class="muted book-meta">{{ b.flows }} 笔记录 · {{ b.members }} 位成员 · {{ b.role === "owner" ? "拥有者" : "成员" }}</div>
        <div class="row book-actions">
          <button class="btn btn-sm" @click="use(b)" :disabled="b.id===store.bookId">切换</button>
          <button class="btn btn-sm" v-if="b.role==='owner'" @click="rename(b)">改名</button>
          <button class="btn btn-sm" @click="openMembers(b)">共享成员</button>
          <button class="btn btn-sm btn-danger" v-if="b.role==='owner'" @click="remove(b)">删除</button>
        </div>
      </div>
    </div>

    <!-- 成员弹窗 -->
    <div v-if="membersDialog" class="modal-mask" @click.self="membersDialog=false">
      <div class="modal">
        <h3 class="modal-title">共享成员 · {{ activeBook.name }}</h3>
        <div v-if="activeBook.role==='owner'" class="row" style="margin-bottom:14px">
          <input class="input" v-model.trim="inviteName" placeholder="输入对方用户名邀请" @keyup.enter="invite" />
          <button class="btn btn-primary" @click="invite">邀请</button>
        </div>
        <div v-for="m in members" :key="m.id" class="mrow">
          <div class="avatar-sm">{{ (m.nickname||'U').slice(0,1) }}</div>
          <div style="flex:1">
            <div>{{ m.nickname }} <span class="muted">@{{ m.username }}</span></div>
            <div class="muted small">{{ m.role === "owner" ? "拥有者" : "成员" }}</div>
          </div>
          <button v-if="activeBook.role==='owner' && m.role!=='owner'" class="btn btn-sm btn-danger" @click="kick(m)">移除</button>
        </div>
        <p class="muted small" style="margin-top:12px">共享账本里，每个人新增的流水会自动归属到本人名下，可在统计里查看「消费归属」。</p>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn" @click="membersDialog=false">关闭</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-list { grid-template-columns: repeat(3, 1fr); margin-top: 16px; }
.book-item { display: flex; flex-direction: column; gap: 8px; }
.book-item.active { border-color: var(--primary); }
.book-top { display: flex; align-items: center; justify-content: space-between; }
.bname { font-size: 16px; }
.book-meta { font-size: 13px; }
.book-actions { margin-top: 6px; }
.mrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); }
.avatar-sm { width: 32px; height: 32px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.small { font-size: 12px; }
@media (max-width: 720px) { .book-list { grid-template-columns: 1fr; } }
</style>
