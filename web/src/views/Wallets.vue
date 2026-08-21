<script setup>
import { ref, onMounted, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { toast } from "../toast.js";
import { useStore } from "../store.js";
import EChart from "../components/EChart.vue";
import DateInput from "../components/DateInput.vue";

const store = useStore();

const data = ref({ wallets: [], totalBalance: 0, totalTarget: 0 });
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const { data: d } = await api.get("/wallets");
    data.value = d;
  } catch (e) { toast(e.message); } finally { loading.value = false; }
}
onMounted(load);

function fmt(n) {
  return "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// 支持算式输入，如 "3000+500"
function evalExpr(s) {
  if (s == null || s === "") return NaN;
  const clean = String(s).replace(/[^0-9+\-*/().\s]/g, "");
  if (!clean.trim()) return NaN;
  try {
    const v = Function(`"use strict";return (${clean})`)();
    return typeof v === "number" && isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

const total = computed(() => ({
  balance: Number(data.value.totalBalance) || 0,
  target: Number(data.value.totalTarget) || 0,
  percent:
    (Number(data.value.totalTarget) || 0) > 0
      ? Math.round((Number(data.value.totalBalance) || 0) / Number(data.value.totalTarget) * 100)
      : 0,
}));
const pctClamped = computed(() => Math.max(0, Math.min(100, total.value.percent)));

// 关联分类下拉：取账本全部分类
const categoryOptions = computed(() => store.categories || []);

// 各钱包「已存」余额占比图（专项金分布）：按实际余额（手动+关联）分布，
// 余额 <= 0 的钱包不计入分布（饼图无法表示负值），下方给出提示
const chartOpt = computed(() => {
  const ws = (data.value.wallets || []).filter((w) => Number(w.balance) > 0);
  if (!ws.length) return null;
  return {
    tooltip: { trigger: "item", formatter: (p) => `${p.name}<br/>已存 <b>${fmt(p.value)}</b>（${p.percent}%）` },
    legend: { type: "scroll", bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["42%", "70%"],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderWidth: 0 },
        label: { show: true, formatter: "{b}\n{c}" },
        data: ws.map((w) => ({ name: w.name, value: Number(w.balance) })),
      },
    ],
  };
});
// 余额为 0 / 负的钱包（不计入饼图分布）
const hiddenWallets = computed(() => (data.value.wallets || []).filter((w) => Number(w.balance) <= 0));

// ---------------- 新增 / 编辑钱包 ----------------
const showWallet = ref(false);
const editingWallet = ref(null);
// link_links: 关联行数组 [{cat, from}, ...]（每行一个分类+起始日，支持同钱包多分类不同起始日）
// 兼容旧字段：link_from / link_category（单值）
const walletForm = ref({ name: "", icon: "👛", target: "", initBalance: "", note: "", link_links: [] });
function openAddWallet() {
  editingWallet.value = null;
  walletForm.value = { name: "", icon: "👛", target: "", initBalance: "", note: "", link_links: [{ cat: "", from: "" }] };
  showWallet.value = true;
}
function openEditWallet(w) {
  editingWallet.value = w;
  let links = Array.isArray(w.linkLinks) && w.linkLinks.length
    ? w.linkLinks.map((x) => ({ cat: x.cat || "", from: x.from || "" }))
    : [];
  // 兼容旧字段：单 linkCategory + linkedFrom → 构造 1 行
  if (!links.length && (w.linkCategory || w.linkFrom)) {
    links = [{ cat: w.linkCategory || "", from: w.linkFrom || "" }];
  }
  if (!links.length) links = [{ cat: "", from: "" }];
  walletForm.value = {
    name: w.name,
    icon: w.icon || "👛",
    target: String(w.target || ""),
    initBalance: "",
    note: w.note || "",
    link_links: links,
  };
  showWallet.value = true;
}
function addLinkLink() {
  walletForm.value.link_links.push({ cat: "", from: "" });
}
function removeLinkLink(idx) {
  walletForm.value.link_links.splice(idx, 1);
  if (!walletForm.value.link_links.length) walletForm.value.link_links.push({ cat: "", from: "" });
}
async function saveWallet() {
  if (!walletForm.value.name.trim()) return toast("请填写钱包名称");
  const t = evalExpr(walletForm.value.target || "0");
  if (!isFinite(t) || t < 0) return toast("目标金额请填正数");
  // 清理空行（空分类）
  const cleanLinks = walletForm.value.link_links
    .filter((l) => l.cat && l.cat.trim())
    .map((l) => ({ cat: l.cat.trim(), from: (l.from || "").trim() }));
  // 兼容旧字段：第一行的 from/cat 写到 link_from/link_category
  const first = cleanLinks[0] || { cat: "", from: "" };
  const payload = {
    name: walletForm.value.name.trim(),
    icon: walletForm.value.icon.trim() || "👛",
    target: t,
    note: walletForm.value.note.trim(),
    link_from: first.from || "",
    link_category: cleanLinks.map((l) => l.cat).join(","),
    link_links: cleanLinks,
  };
  try {
    let wid;
    if (editingWallet.value) {
      await api.put(`/wallets/${editingWallet.value.id}`, payload);
      wid = editingWallet.value.id;
    } else {
      const { data: rd } = await api.post("/wallets", payload);
      wid = rd.id;
    }
    // 初始 / 追加已存金额：保存时作为一笔存入，计入已存余额
    const ib = evalExpr(walletForm.value.initBalance || "0");
    if (isFinite(ib) && ib > 0) {
      await api.post(`/wallets/${wid}/txns`, {
        amount: ib,
        direction: "in",
        ymd: dayjs().format("YYYY-MM-DD"),
        note: editingWallet.value ? "追加已存" : "初始已存",
      });
    }
    toast(editingWallet.value ? "已修改" : "已新增钱包");
    showWallet.value = false;
    load();
  } catch (e) { toast(e.message); }
}
async function delWallet(w) {
  if (!confirm(`删除钱包「${w.name}」？其下所有资金记录也会一并删除。`)) return;
  try {
    await api.delete(`/wallets/${w.id}`);
    toast("已删除");
    load();
  } catch (e) { toast(e.message); }
}

// ---------------- 钱包明细（资金记录） ----------------
const showDetail = ref(false);
const detail = ref({ wallet: {}, rows: [], balance: 0 });
// 资金记录 + 月结 合并排序（按日期倒序穿插，不再月结挤在末尾）
const allTxns = computed(() => {
  const d = detail.value;
  if (!d) return [];
  const rows = (d.rows || []).map((t) => ({
    kind: 'manual', id: t.id, ymd: t.ymd || '',
    amount: Number(t.amount || 0), note: t.note || '', op: t.op_user || '',
  }));
  const monthly = (d.monthly || []).map((m) => ({
    kind: 'monthly', id: `m-${m.ymd}-${m.category}-${m.attribution}`,
    ymd: m.ymd || '', amount: Number(m.amount || 0),
    note: `月结 · ${m.category || ''}`, op: m.attribution || '',
  }));
  return [...rows, ...monthly].sort((a, b) => (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : 0));
});
async function openDetail(w) {
  try {
    const { data: d } = await api.get(`/wallets/${w.id}/txns`);
    detail.value = d;
    showDetail.value = true;
  } catch (e) { toast(e.message); }
}
const txnForm = ref({ amount: "", direction: "in", ymd: dayjs().format("YYYY-MM-DD"), note: "" });
function resetTxnForm() {
  txnForm.value = { amount: "", direction: "in", ymd: dayjs().format("YYYY-MM-DD"), note: "" };
}
async function addTxn() {
  const amt = evalExpr(txnForm.value.amount || "0");
  if (!isFinite(amt) || amt <= 0) return toast("金额必须大于 0");
  try {
    await api.post(`/wallets/${detail.value.wallet.id}/txns`, {
      amount: amt,
      direction: txnForm.value.direction,
      ymd: txnForm.value.ymd,
      note: txnForm.value.note.trim(),
    });
    toast("已新增资金");
    resetTxnForm();
    openDetail(detail.value.wallet); // 刷新明细
    load(); // 刷新卡片余额
  } catch (e) { toast(e.message); }
}
async function delTxn(t) {
  if (!confirm("删除这条资金记录？")) return;
  try {
    await api.delete(`/wallets/txns/${t.id}`);
    toast("已删除");
    openDetail(detail.value.wallet);
    load();
  } catch (e) { toast(e.message); }
}
// 修改单笔资金记录：复用 txnForm，editingTxnId 非空即编辑态
const editingTxnId = ref(null);
function editTxn(t) {
  editingTxnId.value = t.id;
  txnForm.value = {
    amount: String(Math.abs(t.amount)),
    direction: t.amount < 0 ? "out" : "in",
    ymd: t.ymd,
    note: t.note || "",
  };
}
function cancelEditTxn() {
  editingTxnId.value = null;
  resetTxnForm();
}
async function saveTxnEdit() {
  const amt = evalExpr(txnForm.value.amount || "0");
  if (!isFinite(amt) || amt <= 0) return toast("金额必须大于 0");
  try {
    await api.put(`/wallets/txns/${editingTxnId.value}`, {
      amount: amt,
      direction: txnForm.value.direction,
      ymd: txnForm.value.ymd,
      note: txnForm.value.note.trim(),
    });
    toast("已修改");
    cancelEditTxn();
    openDetail(detail.value.wallet);
    load();
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div>
    <div class="head-row">
      <h2 class="page-title" style="margin:0">分类钱包</h2>
      <button class="btn btn-sm btn-primary" @click="openAddWallet">＋ 新增钱包</button>
    </div>

    <!-- 总览 -->
    <div class="card" v-if="data.wallets.length">
      <div class="ov-head">
        <div>
          <div class="muted">已存合计</div>
          <div class="ov-num">{{ fmt(total.balance) }}</div>
        </div>
        <div class="ov-now">
          <div class="muted">已存金额</div>
          <div class="ov-tgt">{{ total.balance ? fmt(total.balance) : '0' }}</div>
          <div class="muted small">共 {{ data.wallets.length }} 个钱包</div>
        </div>
      </div>
    </div>

    <!-- 专项金分布（已存余额） -->
    <div class="card" style="margin-top:16px" v-if="chartOpt">
      <div class="section-title">专项金已存余额分布</div>
      <EChart :option="chartOpt" height="300px" />
      <div class="muted small" v-if="hiddenWallets.length" style="margin-top:8px">
        未计入分布（已存 ≤ 0）：{{ hiddenWallets.map((w) => w.name).join("、") }}
      </div>
    </div>

    <!-- 钱包卡片 -->
    <div class="grid wallet-grid" style="margin-top:16px">
      <div v-for="w in data.wallets" :key="w.id" class="card wallet" @click="openDetail(w)">
        <div class="w-top">
          <span class="w-ic">{{ w.icon || '👛' }}</span>
          <b class="w-name">{{ w.name }}</b>
          <span class="muted small w-cnt">{{ w.count }}笔</span>
        </div>
        <div class="w-bal">{{ fmt(w.balance) }}</div>
        <div class="muted small" v-if="w.target">目标 {{ fmt(w.target) }} · 已达成 {{ w.percent }}%</div>
        <div class="muted small" v-else>未设目标</div>
        <div class="bar" style="margin-top:8px;height:6px" v-if="w.target">
          <i :style="{ width: Math.max(0, Math.min(100, w.percent)) + '%', background: w.balance >= w.target ? 'var(--income)' : 'var(--primary)' }"></i>
        </div>
        <div class="w-link" v-if="w.linkLinks && w.linkLinks.length">
          <div v-for="(lk, idx) in w.linkLinks" :key="idx" class="tag-link" style="display:block;margin-bottom:2px">
            🔗 关联 {{ lk.cat }} · 自 {{ lk.from || '（未设日期）' }}
          </div>
          <div class="muted small">关联自动 <b :class="w.linked >= 0 ? 'income' : 'expense'">{{ w.linked >= 0 ? '+' : '−' }}{{ fmt(Math.abs(w.linked)) }}</b>（手动 {{ fmt(w.manualBalance) }}）</div>
        </div>
        <div class="muted small w-meta">存入 {{ fmt(w.total_in) }}｜支出 {{ fmt(w.total_out) }}</div>
        <div class="muted small">最近 {{ w.last_ymd || '—' }}</div>
        <div class="w-foot" @click.stop>
          <button class="btn btn-sm" @click="openEditWallet(w)">修改钱包信息</button>
          <button class="btn btn-sm" @click="openDetail(w)">改</button>
          <button class="btn btn-sm btn-danger" @click="delWallet(w)">删</button>
        </div>
      </div>
      <div v-if="!data.wallets.length" class="muted empty-tip">
        还没有分类钱包。点「＋ 新增钱包」，把养娃、买房、买车等专项金分别建起来，每月发工资后存一笔即可（记录会带日期和金额，自动记操作人）。
      </div>
    </div>

    <!-- 新增 / 编辑钱包弹窗 -->
    <div v-if="showWallet" class="modal-mask" @click.self="showWallet = false">
      <div class="modal" style="max-width:540px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">{{ editingWallet ? '编辑钱包' : '新增分类钱包' }}</h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showWallet = false">取消</button>
            <button class="btn btn-primary" @click="saveWallet">保存</button>
          </div>
        </div>
        <label class="field">
          <span>名称（如 养娃 / 买房 / 买车）</span>
          <input class="input" v-model="walletForm.name" placeholder="养娃" />
        </label>
        <label class="field">
          <span>图标（emoji，可选）</span>
          <input class="input" v-model="walletForm.icon" placeholder="👛" maxlength="4" style="width:80px" />
        </label>
        <label class="field">
          <span>目标金额（可选，不填则不显示进度）</span>
          <input class="input" v-model="walletForm.target" placeholder="如 200000 或 20*10000" />
          <span class="muted small" v-if="isFinite(evalExpr(walletForm.target)) && evalExpr(walletForm.target) > 0">
            = {{ fmt(evalExpr(walletForm.target)) }}
          </span>
        </label>
        <label class="field">
          <span>已存金额（初始 / 追加，选填：保存时记为一笔存入，计入已存余额）</span>
          <input class="input" v-model="walletForm.initBalance" placeholder="如 10000（留空则不入账）" />
          <span class="muted small" v-if="isFinite(evalExpr(walletForm.initBalance)) && evalExpr(walletForm.initBalance) > 0">
            = 将存入 {{ fmt(evalExpr(walletForm.initBalance)) }}
          </span>
        </label>
        <div class="field">
          <span>关联流水分类（可选，多行，每行一个分类+起始日）：自某日起，该分类的收支自动加减到本钱包</span>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
            <div v-for="(lk, idx) in walletForm.link_links" :key="idx" style="display:flex;gap:6px;align-items:center">
              <select class="input" v-model="lk.cat" style="width:auto;min-width:140px">
                <option value="">选择分类</option>
                <option v-for="c in categoryOptions" :key="c.id" :value="c.name">
                  {{ c.name }}{{ c.type === 'income' ? '（收）' : '（支）' }}
                </option>
              </select>
              <DateInput v-model="lk.from" />
              <button type="button" class="btn" style="padding:2px 10px" @click="removeLinkLink(idx)" title="删除该行">×</button>
            </div>
            <button type="button" class="btn" style="align-self:flex-start;padding:2px 12px" @click="addLinkLink">+ 添加一行</button>
          </div>
          <span class="muted small" v-if="walletForm.link_links.length">
            例：养娃基金关联「孩子」自 2026-01-01 + 「礼金（支）」自 2026-06-01 → 各自起始日后自动加减。
          </span>
        </div>
        <label class="field">
          <span>备注（可选）</span>
          <input class="input" v-model="walletForm.note" placeholder="如 每月工资后存 3000" />
        </label>
      </div>
    </div>

    <!-- 钱包明细弹窗 -->
    <div v-if="showDetail" class="modal-mask" @click.self="showDetail = false">
      <div class="modal" style="max-width:720px">
        <div class="modal-head">
          <h3 class="modal-title" style="margin:0">
            <span class="w-ic big">{{ detail.wallet.icon || '👛' }}</span> {{ detail.wallet.name }}
          </h3>
          <div class="row" style="gap:8px">
            <button class="btn" @click="showDetail = false">关闭</button>
          </div>
        </div>

        <div class="detail-sum">
          <div><div class="muted small">当前余额（手动+关联）</div><div class="big" :class="(detail.balance + detail.linkedSum) >= 0 ? 'income' : 'expense'">{{ fmt(detail.balance + detail.linkedSum) }}</div></div>
          <div v-if="detail.wallet.target"><div class="muted small">目标</div><div class="big">{{ fmt(detail.wallet.target) }}</div></div>
          <div><div class="muted small">手动存入</div><div class="big income">{{ fmt(detail.rows.reduce((s,x)=>s+(x.amount>0?x.amount:0),0)) }}</div></div>
          <div v-if="detail.linkCategory"><div class="muted small">关联自动（{{ detail.linkCategory }}）</div><div class="big" :class="detail.linkedSum >= 0 ? 'income' : 'expense'">{{ detail.linkedSum >= 0 ? '+' : '−' }}{{ fmt(Math.abs(detail.linkedSum)) }}</div></div>
        </div>

        <!-- 新增资金 -->
        <div class="add-box">
          <div class="field" style="margin:0">
            <span>日期</span>
            <DateInput v-model="txnForm.ymd" />
          </div>
          <div class="field" style="margin:0">
            <span>金额</span>
            <input class="input" v-model="txnForm.amount" placeholder="如 3000" style="width:150px" />
          </div>
          <div class="field" style="margin:0">
            <span>方向</span>
            <div class="row" style="gap:8px">
              <button class="sw" :class="{ on: txnForm.direction === 'in' }" @click="txnForm.direction = 'in'">存入 +</button>
              <button class="sw out" :class="{ on: txnForm.direction === 'out' }" @click="txnForm.direction = 'out'">支出 −</button>
            </div>
          </div>
          <div class="field" style="margin:0;flex:1">
            <span>备注</span>
            <input class="input" v-model="txnForm.note" placeholder="如 工资转入" />
          </div>
          <button v-if="!editingTxnId" class="btn btn-primary add-btn" @click="addTxn">新增资金</button>
          <template v-else>
            <button class="btn btn-primary add-btn" @click="saveTxnEdit">保存修改</button>
            <button class="btn add-btn" @click="cancelEditTxn">取消</button>
          </template>
        </div>

        <!-- 资金记录 -->
        <div class="section-title" style="margin:18px 0 10px">资金记录（日期 · 金额 · 操作人）</div>
        <table class="tbl txn-tbl">
          <thead>
            <tr>
              <th class="c-d">日期</th>
              <th class="num">金额</th>
              <th>备注</th>
              <th class="c-op hide-mobile">操作人</th>
              <th class="c-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in allTxns" :key="t.id" :class="{ 'row-monthly': t.kind === 'monthly' }">
              <td class="c-d"><b>{{ t.ymd }}</b></td>
              <td class="num" :class="t.amount >= 0 ? 'income' : 'expense'">
                <b>{{ t.amount >= 0 ? '+' : '−' }}{{ fmt(Math.abs(t.amount)) }}</b>
              </td>
              <td class="muted">{{ t.note || '—' }}</td>
              <td class="c-op muted hide-mobile">{{ t.op || '—' }}</td>
              <td class="c-act">
                <template v-if="t.kind === 'manual'">
                  <button class="btn btn-sm" @click="editTxn(t)">改</button>
                  <button class="btn btn-sm btn-danger" @click="delTxn(t)">删</button>
                </template>
                <template v-else>
                  <span class="muted small">自动</span>
                </template>
              </td>
            </tr>
            <tr v-if="!allTxns.length">
              <td colspan="5" class="muted" style="text-align:center;padding:24px 0">还没有资金记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ov-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.ov-num { font-size: 28px; font-weight: 800; margin-top: 4px; color: var(--primary); }
.ov-now { text-align: right; }
.ov-tgt { font-size: 22px; font-weight: 800; margin-top: 4px; }
.small { font-size: 12px; }

.wallet-grid { grid-template-columns: repeat(3, 1fr); }
.wallet { padding: 14px; cursor: pointer; transition: box-shadow .15s, transform .15s; }
.wallet:hover { box-shadow: 0 6px 18px rgba(0,0,0,.08); transform: translateY(-2px); }
.w-top { display: flex; align-items: center; gap: 8px; }
.w-ic { font-size: 20px; }
.w-ic.big { font-size: 22px; margin-right: 4px; }
.w-name { flex: 1; font-size: 15px; }
.w-cnt { white-space: nowrap; }
.w-bal { font-size: 22px; font-weight: 800; margin: 8px 0 2px; }
.w-meta { margin-top: 6px; }
.w-link { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.tag-link { display: inline-block; font-size: 12px; color: var(--primary); background: var(--primary-soft); border-radius: 999px; padding: 2px 9px; margin-bottom: 4px; }
/* 分类多选 chip */
.cat-check {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none;
  border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px;
  font-size: 12px; color: var(--text-2); background: var(--surface);
  transition: all .15s;
}
.cat-check.on { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.w-foot { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
.empty-tip { grid-column: 1/-1; text-align: center; padding: 26px 0; }

.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 0 14px; border-bottom: 1px solid var(--border); margin-bottom: 16px; flex-wrap: wrap; }
.detail-sum { display: flex; gap: 28px; flex-wrap: wrap; padding: 4px 0 4px; }
.detail-sum .big { font-size: 20px; font-weight: 800; margin-top: 2px; }

.add-box { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 12px; background: var(--surface-2); border-radius: 10px; margin-top: 6px; }
.add-box .field { display: flex; flex-direction: column; gap: 4px; }
.add-btn { align-self: flex-end; }
.sw { flex: 1; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 10px; padding: 10px; font-size: 14px; cursor: pointer; min-width: 86px; }
.sw.on { border-color: var(--income); background: var(--primary-soft); color: var(--income); font-weight: 600; }
.sw.out.on { border-color: var(--expense); color: var(--expense); }

.txn-tbl .c-d { width: 110px; white-space: nowrap; }
.txn-tbl .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.txn-tbl .c-op { width: 90px; }
/* 自动月结行：浅色底 + 无操作按钮 */
.txn-tbl tr.row-monthly td { background: var(--surface-2); font-size: 13px; }
.txn-tbl tr.row-monthly td.c-d b { font-weight: 600; }
.txn-tbl .c-act { width: 96px; text-align: right; }

@media (max-width: 1000px) { .wallet-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px) {
  .wallet-grid { grid-template-columns: 1fr; }
  .ov-now { text-align: left; }
  .add-box { gap: 8px; }
}
</style>
