<script setup>
import { ref, onMounted } from "vue";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

const store = useStore();
const list = ref([]);
const loading = ref(false);

const showAdd = ref(false);
const addForm = ref({ username: "", password: "", nickname: "", role: "user" });

const editing = ref(null); // 正在编辑的用户
const editForm = ref({ nickname: "", role: "user", password: "", color: "#7c8cff" });
const USER_COLORS = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#0ea5e9","#a855f7","#22c55e"];

// 历史归属修复
const unbound = ref([]);
const bindTo = ref({}); // { 归属文本: 用户ID }

async function load() {
  loading.value = true;
  try {
    const [u, a] = await Promise.all([
      api.get("/admin/users"),
      api.get("/admin/users/attributions/unbound"),
    ]);
    list.value = u.data;
    unbound.value = a.data;
    const map = {};
    for (const x of a.data) map[x.name] = bindTo.value[x.name] || "";
    bindTo.value = map;
  } catch (e) {
    toast(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function bind(item) {
  const userId = Number(bindTo.value[item.name]);
  if (!userId) return toast("请先选择要归属到的用户");
  const target = list.value.find((u) => u.id === userId);
  if (!confirm(`把 ${item.count} 条归属为「${item.name}」的历史账单，认定为用户「${target?.nickname}」的记录？\n绑定后该用户再改昵称，这些账单会自动跟着更新。`))
    return;
  try {
    const { data } = await api.post("/admin/users/attributions/bind", {
      from: item.name,
      userId,
    });
    toast(`已修复 ${data.updated} 条，归属更新为「${data.nickname}」`);
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function openAdd() {
  addForm.value = { username: "", password: "", nickname: "", role: "user" };
  showAdd.value = true;
}

async function submitAdd() {
  const f = addForm.value;
  if (!f.username || !f.password) return toast("用户名和密码必填");
  if (f.password.length < 6) return toast("密码至少 6 位");
  try {
    await api.post("/admin/users", { ...f });
    toast("用户已创建");
    showAdd.value = false;
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function openEdit(u) {
  editing.value = u;
  editForm.value = { username: u.username, nickname: u.nickname, role: u.role, password: "", color: u.color || "#7c8cff" };
}

async function submitEdit() {
  const payload = {};
  if (editForm.value.username !== editing.value.username)
    payload.username = editForm.value.username;
  if (editForm.value.nickname !== editing.value.nickname)
    payload.nickname = editForm.value.nickname;
  if (editForm.value.role !== editing.value.role) payload.role = editForm.value.role;
  if (editForm.value.password) payload.password = editForm.value.password;
  // 颜色有改动才提交（避免无谓写入）
  if ((editForm.value.color || "").toLowerCase() !== (editing.value.color || "").toLowerCase())
    payload.color = editForm.value.color;
  if (!Object.keys(payload).length) {
    editing.value = null;
    return;
  }
  try {
    await api.put(`/admin/users/${editing.value.id}`, payload);
    toast("已保存");
    // 改的是自己 → 同步刷新本地用户信息
    if (editing.value.id === store.user?.id) await store.fetchMe();
    editing.value = null;
    await load();
  } catch (e) {
    toast(e.message);
  }
}

async function remove(u) {
  const tip =
    `确定删除用户「${u.nickname}」？\n\n` +
    `· 他独有的账本及其全部流水会被一并删除\n` +
    `· 有其他成员的共享账本会自动移交给最早加入的成员\n` +
    `· 共享账本里他的历史流水会保留，归属显示为文字「${u.nickname}」\n\n` +
    `此操作不可撤销。`;
  if (!confirm(tip)) return;
  try {
    const { data } = await api.delete(`/admin/users/${u.id}`);
    toast(`已删除，删除账本 ${data.removedBooks} 个 / 移交 ${data.movedBooks} 个`);
    await load();
  } catch (e) {
    toast(e.message);
  }
}
</script>

<template>
  <div>
    <div class="row" style="align-items: center; justify-content: space-between">
      <h2 class="page-title" style="margin: 0">用户管理</h2>
      <button class="btn btn-primary btn-sm" @click="openAdd">+ 新增用户</button>
    </div>

    <div class="card" style="margin-top: 16px">
      <p class="muted" style="font-size: 13px; margin: 0 0 12px; line-height: 1.7">
        本站已关闭自助注册，账号统一由管理员在此创建。<br />
        新用户会自动获得一个属于自己的默认账本和默认分类；如需一起记账，请到「账本」页把他加为共享成员。
      </p>

      <table class="tbl" v-if="list.length">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>昵称（账单归属名）</th>
            <th>角色</th>
            <th class="hide-mobile">账本</th>
            <th class="hide-mobile">流水</th>
            <th class="hide-mobile">创建时间</th>
            <th style="text-align: right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td class="muted">{{ u.id }}</td>
            <td>{{ u.username }}</td>
            <td>
              <span class="swatch" :style="{ background: u.color || '#7c8cff' }"></span>
              {{ u.nickname }}
              <span class="tag" v-if="u.id === store.user?.id" style="margin-left: 6px">我</span>
            </td>
            <td>
              <span class="tag" :style="{ color: u.role === 'admin' ? 'var(--primary)' : 'var(--text-2)' }">
                {{ u.role === "admin" ? "管理员" : "普通用户" }}
              </span>
            </td>
            <td class="hide-mobile muted">{{ u.books }}</td>
            <td class="hide-mobile muted">{{ u.flows }}</td>
            <td class="hide-mobile muted">{{ (u.created_at || "").slice(0, 10) }}</td>
            <td style="text-align: right; white-space: nowrap">
              <button class="btn btn-sm" @click="openEdit(u)">编辑</button>
              <button
                class="btn btn-sm btn-danger"
                v-if="u.id !== store.user?.id"
                @click="remove(u)"
              >删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="muted">{{ loading ? "加载中…" : "暂无用户" }}</div>
    </div>

    <!-- 历史归属修复 -->
    <div class="card" style="margin-top: 16px" v-if="unbound.length">
      <div class="section-title">⚠️ 历史归属待认领（{{ unbound.length }}）</div>
      <p class="muted" style="font-size: 13px; margin: 0 0 12px; line-height: 1.7">
        下面这些账单的归属人还只是一串<b>文字</b>，没有绑定到具体用户，所以改昵称时不会跟着变。<br />
        指认它属于谁并绑定后，以后这个人再改昵称，历史账单会自动同步。<br />
        如果是「老婆」「爸妈」这类并非系统用户的名字，保持原样不管即可。
      </p>
      <table class="tbl">
        <thead>
          <tr>
            <th>归属文字</th>
            <th>条数</th>
            <th class="hide-mobile">涉及账本</th>
            <th class="hide-mobile">时间范围</th>
            <th style="min-width: 200px">认定为</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in unbound" :key="a.name">
            <td><b>{{ a.name }}</b></td>
            <td>{{ a.count }}</td>
            <td class="hide-mobile muted">{{ a.books }}</td>
            <td class="hide-mobile muted">
              {{ (a.first_time || "").slice(0, 10) }} ~ {{ (a.last_time || "").slice(0, 10) }}
            </td>
            <td>
              <div class="row" style="gap: 6px; flex-wrap: nowrap">
                <select class="select" v-model="bindTo[a.name]" style="min-width: 110px">
                  <option value="">选择用户…</option>
                  <option v-for="u in list" :key="u.id" :value="u.id">{{ u.nickname }}</option>
                </select>
                <button class="btn btn-sm btn-primary" @click="bind(a)">绑定</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新增用户 -->
    <div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
      <div class="modal">
        <h3 class="modal-title">新增用户</h3>
        <label class="field"><span>用户名（登录用）</span><input class="input" v-model.trim="addForm.username" placeholder="英文或数字" /></label>
        <label class="field"><span>初始密码（至少 6 位）</span><input class="input" v-model="addForm.password" placeholder="创建后可让他自己修改" /></label>
        <label class="field"><span>昵称（账单归属显示名，需唯一）</span><input class="input" v-model.trim="addForm.nickname" placeholder="留空则与用户名相同" /></label>
        <label class="field">
          <span>角色</span>
          <select class="select" v-model="addForm.role">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <div class="row" style="justify-content: flex-end; margin-top: 4px">
          <button class="btn" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" @click="submitAdd">创建</button>
        </div>
      </div>
    </div>

    <!-- 编辑用户 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3 class="modal-title">编辑：{{ editing.username }}</h3>
        <label class="field">
          <span>用户名（登录账号，可改）</span>
          <input class="input" v-model.trim="editForm.username" placeholder="字母数字 _ . -" />
        </label>
        <label class="field">
          <span>昵称</span>
          <input class="input" v-model.trim="editForm.nickname" />
        </label>
        <p class="muted" style="font-size: 12px; margin: -6px 0 12px">
          改昵称后，该用户名下的历史账单归属会自动同步为新昵称。
        </p>
        <label class="field">
          <span>角色</span>
          <select class="select" v-model="editForm.role">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <label class="field">
          <span>归属颜色（流水与统计饼图按此区分）</span>
          <div class="picker">
            <button
              v-for="c in USER_COLORS" :key="c"
              class="pcolor" :class="{ on: (editForm.color||'').toLowerCase() === c.toLowerCase() }"
              :style="{ background: c }" @click="editForm.color = c"
            ></button>
            <input class="input color-input" type="color" v-model="editForm.color" />
          </div>
        </label>
        <label class="field">
          <span>重置密码（留空则不修改）</span>
          <input class="input" v-model="editForm.password" placeholder="至少 6 位" />
        </label>
        <div class="row" style="justify-content: flex-end; margin-top: 4px">
          <button class="btn" @click="editing = null">取消</button>
          <button class="btn btn-primary" @click="submitEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 720px) {
  .hide-mobile { display: none; }
}
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: middle; border: 1px solid var(--border); }
.picker { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pcolor { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.pcolor.on { border-color: var(--text); }
.color-input { width: 40px; height: 30px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; cursor: pointer; }
</style>
