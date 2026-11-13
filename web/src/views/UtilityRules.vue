<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import api from "../api.js";
import { toast } from "../toast.js";
import { plainIcon } from "../lib/catIcon.js";

const router = useRouter();
const TYPES = [
  { type: "water", label: "水费", unit: "m³", span: 2, icon: "💧" },
  { type: "electric", label: "电费", unit: "kWh", span: 1, icon: "⚡" },
  { type: "gas", label: "燃气费", unit: "m³", span: 2, icon: "🔥" },
  { type: "property", label: "物业费", unit: "元", span: 3, icon: "🏢" },
];
const MONTH_CHIPS = Array.from({ length: 12 }, (_, i) => i + 1);

const rules = ref([]);
const loading = ref(false);
// 关联分类选项（v260908：规则可绑定任意消费分类，识别=规则分类+名称关键词）
const cats = ref([]);
const DEFAULT_CAT = "住房";
const expenseCats = computed(() => cats.value.filter((c) => c.type === "expense"));

const showEdit = ref(false);
const editingId = ref(null); // null = 新建
const f = ref(null); // 编辑表单对象

function defaultTiers(type) {
  const map = {
    water: [
      { cap: "41", price: "3.5" },
      { cap: "11", price: "5.25" },
      { cap: "", price: "10.5" },
    ],
    electric: [
      { cap: "200", price: "0.5889" },
      { cap: "199", price: "0.6389" },
      { cap: "", price: "0.8889" },
    ],
    gas: [
      { cap: "320", price: "3.45" },
      { cap: "80", price: "4.14" },
      { cap: "", price: "5.18" },
    ],
    property: [{ cap: "", price: "82" }],
  };
  return map[type] || [{ cap: "", price: "" }];
}
function metaOf(type) {
  return TYPES.find((t) => t.type === type) || TYPES[0];
}

// ============ v2.2.17 显式账期：出账日窗口 → 覆盖账期 ============
// 覆盖方案（start=覆盖起始偏移 0=当月 -1=上月 -2=上上月；span=覆盖月数；quarter=自然季度）
const COV_PRESETS = {
  two: [
    { v: "-2_2", start: -2, span: 2, label: "上月 + 上上月" },
    { v: "-1_2", start: -1, span: 2, label: "当月 + 上月" },
    { v: "-1_1", start: -1, span: 1, label: "上月（单月）" },
    { v: "0_1", start: 0, span: 1, label: "当月（单月）" },
  ],
  single: [
    { v: "-1_1", start: -1, span: 1, label: "上月（月初缴上月）" },
    { v: "0_1", start: 0, span: 1, label: "当月" },
    { v: "-1_2", start: -1, span: 2, label: "当月 + 上月" },
  ],
  property: [
    { v: "q3", quarter: true, span: 3, label: "缴费月所在自然季度（季度缴）" },
    { v: "0_1", start: 0, span: 1, label: "当月（每月缴）" },
    { v: "-1_1", start: -1, span: 1, label: "上月（每月缴上月）" },
    { v: "0_3", start: 0, span: 3, label: "当月起连缴 3 个月" },
  ],
};
function covPresetOf(type, start, span, quarter) {
  const list = type === "property" ? COV_PRESETS.property : type === "electric" ? COV_PRESETS.single : COV_PRESETS.two;
  return list.find(
    (p) => (quarter ? !!p.quarter : !p.quarter) && Number(p.start) === Number(start) && Number(p.span) === Number(span)
  ) || list[0];
}
// 默认账期（与后端 defaultCover 一致）：水/气双窗口互斥；电单窗口上月；物业自然季度
function defaultCoverRows(type) {
  if (type === "water" || type === "gas") {
    return [
      { from: 1, to: 15, start: -2, span: 2, quarter: false },
      { from: 16, to: 31, start: -1, span: 2, quarter: false },
    ];
  }
  if (type === "electric") return [{ from: 1, to: 31, start: -1, span: 1, quarter: false }];
  return [{ from: 1, to: 31, start: 0, span: 3, quarter: true }];
}
// 后端 decorateRule 的 cover → 表单行
function coverToRows(type, cover) {
  const wins = (cover && Array.isArray(cover.windows) && cover.windows.length)
    ? cover.windows
    : defaultCoverRows(type);
  return wins.map((w) => ({
    from: Number(w.from) || 1,
    to: Number(w.to) || 31,
    start: Number(w.start) || 0,
    span: Math.max(1, Number(w.span) || 1),
    quarter: !!w.quarter,
  }));
}
// 表单行 → 提交的 cover
function rowsToCover(rows) {
  return {
    windows: rows.map((r) => ({
      from: Math.min(31, Math.max(1, Number(r.from) || 1)),
      to: Math.min(31, Math.max(1, Number(r.to) || 1)),
      start: Number(r.start) || 0,
      span: Math.max(1, Number(r.span) || 1),
      ...(r.quarter ? { quarter: true } : {}),
    })),
  };
}
function coverSummaryText(type, rows) {
  if (type === "electric") {
    const p = covPresetOf(type, rows[0]?.start, rows[0]?.span, rows[0]?.quarter);
    return `任意日出账 → 覆盖${p.label}`;
  }
  if (type === "property") {
    const p = covPresetOf(type, rows[0]?.start, rows[0]?.span, rows[0]?.quarter);
    return `${rows[0]?.quarter ? "季度缴" : "每月缴"}：任意日 → ${p.label}`;
  }
  // 水/气：双窗口（互斥，一笔流水只命中一个）
  return rows
    .map((r) => {
      const p = covPresetOf(type, r.start, r.span, r.quarter);
      return `${r.from}-${r.to}号 → 覆盖${p.label}`;
    })
    .join("；");
}
function covOptionsOf(type) {
  if (type === "property") return COV_PRESETS.property;
  if (type === "electric") return COV_PRESETS.single;
  return COV_PRESETS.two;
}
function covKeyOf(r) {
  if (r.quarter) return "q3";
  return `${Number(r.start) || 0}_${Math.max(1, Number(r.span) || 1)}`;
}
function applyCovRow(r, v) {
  const opts = covOptionsOf(f.value.type);
  const p = opts.find((x) => x.v === v) || opts[0];
  r.quarter = !!p.quarter;
  r.start = p.start ?? 0;
  r.span = p.span;
}
function addCoverRow() {
  const t = f.value.type;
  f.value.coverRows.push(
    t === "water" || t === "gas"
      ? { from: 1, to: 15, start: -2, span: 2, quarter: false }
      : { from: 1, to: 31, start: -1, span: 1, quarter: false }
  );
}
function blankForm(type) {
  const m = metaOf(type);
  const now = new Date();
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const fm = {
    type,
    name: "",
    category: DEFAULT_CAT,
    effective_from: thisYm,
    effective_to: "",
    bill_span: m.span,
    cycle_type: type === "gas" ? "by_year" : "by_span",
    unit: type === "electric" ? "kWh" : type === "property" ? "元" : "m³",
    coverRows: defaultCoverRows(type),
    tiers: defaultTiers(type),
    season:
      type === "electric"
        ? { months: [5, 6, 7, 8, 9, 10], tiers: [{ cap: "260", price: "0.5889" }, { cap: "339", price: "0.6389" }, { cap: "", price: "0.8889" }] }
        : null,
    monthly_fee: type === "property" ? "82" : "",
  };
  return fm;
}

async function load() {
  loading.value = true;
  try {
    const [{ data }, catRes] = await Promise.all([
      api.get("/utility/rules"),
      api.get("/categories"),
    ]);
    rules.value = data.list || [];
    cats.value = Array.isArray(catRes.data) ? catRes.data : [];
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editingId.value = null;
  f.value = blankForm("electric");
  showEdit.value = true;
}
function openEdit(rule) {
  editingId.value = rule.id;
  f.value = {
    type: rule.type,
    name: rule.name || "",
    category: rule.category || DEFAULT_CAT,
    effective_from: rule.effective_from,
    effective_to: rule.effective_to || "",
    bill_span: rule.bill_span,
    cycle_type: rule.cycle_type,
    unit: rule.unit || "m³",
    coverRows: coverToRows(rule.type, rule.cover),
    tiers: (rule.tiers || []).map((t) => ({
      cap: t.cap == null ? "" : String(t.cap),
      price: String(t.price),
    })),
    season: rule.season
      ? {
          months: [...(rule.season.months || [])],
          tiers: rule.season.tiers.map((t) => ({
            cap: t.cap == null ? "" : String(t.cap),
            price: String(t.price),
          })),
        }
      : null,
    monthly_fee: rule.monthly_fee != null ? String(rule.monthly_fee) : "",
  };
  showEdit.value = true;
}
function onTypeChange() {
  if (editingId.value) return; // 编辑中不改类型
  f.value = blankForm(f.value.type);
}
function addTierRow(list) {
  list.push({ cap: "", price: "" });
}
function rmTierRow(list, i) {
  if (list.length <= 1) return;
  list.splice(i, 1);
  // 保证末行 cap 为空（∞）
  const last = list[list.length - 1];
  if (last && String(last.cap).trim() !== "") list.push({ cap: "", price: "" });
}
function normTiers(list) {
  const out = [];
  for (const t of list) {
    const price = Number(t.price);
    if (!price || price <= 0) continue;
    const capRaw = String(t.cap ?? "").trim();
    out.push({ cap: capRaw === "" ? null : Number(capRaw), price });
  }
  if (!out.length) return null;
  // 保证最后一档是 ∞
  if (out[out.length - 1].cap != null) out.push({ cap: null, price: out[out.length - 1].price });
  return out;
}
async function save() {
  if (!/^\d{4}-\d{2}$/.test(f.value.effective_from)) {
    toast("请选择起始账期（首个被覆盖月份）");
    return;
  }
  if (f.value.effective_to && !/^\d{4}-\d{2}$/.test(f.value.effective_to)) {
    toast("结束账期格式不对");
    return;
  }
  // v2.2.17：出账窗口校验（from<=to、1~31）
  const rows = (f.value.coverRows || []).filter(
    (r) => Number(r.from) >= 1 && Number(r.to) >= Number(r.from) && Number(r.to) <= 31
  );
  if (!rows.length) {
    toast("出账日窗口配置不正确（1~31 且起≤止）");
    return;
  }
  const tiers = normTiers(f.value.tiers);
  if (!tiers) {
    toast("至少填写一个有效档位（单价>0）");
    return;
  }
  const payload = {
    type: f.value.type,
    name: f.value.name.trim(),
    category: f.value.category || DEFAULT_CAT,
    effective_from: f.value.effective_from,
    effective_to: f.value.effective_to || "",
    bill_span: Math.max(...rows.map((r) => Math.max(1, Number(r.span) || 1))),
    cycle_type: f.value.type === "gas" ? "by_year" : "by_span",
    unit: f.value.unit,
    tiers,
    monthly_fee: f.value.type === "property" ? Number(f.value.monthly_fee) || 0 : undefined,
    cover: rowsToCover(f.value.coverRows),
  };
  if (f.value.type === "electric") {
    const sTiers = normTiers(f.value.season?.tiers || []);
    if (!sTiers) {
      toast("电费需要填写夏季档位");
      return;
    }
    payload.season = { months: f.value.season?.months?.length ? f.value.season.months : [5, 6, 7, 8, 9, 10], tiers: sTiers };
  }
  try {
    if (editingId.value) {
      await api.put(`/utility/rules/${editingId.value}`, payload);
      toast("已保存（改动后可在用量页点「重新扫描」重排历史账单）");
    } else {
      await api.post("/utility/rules", payload);
      toast("已创建规则（起始账期之前的流水不会自动计入）");
    }
    showEdit.value = false;
    await load();
  } catch (e) {
    toast(e.message);
  }
}
async function removeRule(rule) {
  if (!confirm(`删除「${rule.name || "未命名"}」规则？（已有账单保留，新流水不再按此规则生成）`)) return;
  try {
    await api.delete(`/utility/rules/${rule.id}`);
    toast("已删除");
    await load();
  } catch (e) {
    toast(e.message);
  }
}
function summary(rule) {
  const tiers = rule.tiers || [];
  const parts = tiers.map((t) =>
    t.cap == null ? `超第${tiers.length}档 ¥${t.price}` : `0~${t.cap} ¥${t.price}`
  );
  // v2.2.17：账期显式展示（出账窗口 → 覆盖账期）
  let s = `账期：${coverSummaryText(rule.type, coverToRows(rule.type, rule.cover))}｜档位：${parts.join("，")}`;
  if (rule.type === "electric" && rule.season) {
    s += `｜夏季(${rule.season.months.join("/")}月)：${rule.season.tiers.map((t) => (t.cap == null ? `超¥${t.price}` : `≤${t.cap} ¥${t.price}`)).join("，")}`;
  }
  if (rule.type === "property" && rule.monthly_fee != null) s += `｜月费 ¥${rule.monthly_fee}`;
  return s;
}
function effText(r) {
  return `${r.effective_from}${r.effective_to ? " ~ " + r.effective_to : " ~ 至今"}`;
}
const grouped = computed(() =>
  TYPES.map((t) => ({ ...t, list: rules.value.filter((x) => x.type === t.type) }))
);

function toggleMonth(m) {
  if (!f.value.season) return;
  const ms = f.value.season.months;
  const i = ms.indexOf(m);
  if (i >= 0) ms.splice(i, 1);
  else ms.push(m);
}
function rmSeasonTier(i) {
  if (!f.value.season || f.value.season.tiers.length <= 1) return;
  f.value.season.tiers.splice(i, 1);
  const last = f.value.season.tiers[f.value.season.tiers.length - 1];
  if (last && String(last.cap).trim() !== "") f.value.season.tiers.push({ cap: "", price: "" });
}

onMounted(load);
</script>

<template>
  <div>
    <div class="head-line">
      <h2 class="page-title" style="margin-bottom: 0">水电气规则</h2>
      <div class="head-actions">
        <button class="btn btn-sm" @click="router.push({ name: 'utility' })">← 返回用量</button>
        <button class="btn btn-sm btn-primary" @click="openNew">+ 新建规则</button>
      </div>
    </div>
    <p class="muted intro">
      同一类型可配置多段规则（换城市 / 调价 = 新建一段）。<b>「起始账期」是首个被覆盖的月份</b>（水费选 2024-02 → 首期覆盖 2~3 月、首笔流水约 3 月下旬），之前的流水不计入；账单生成时按流水日期命中「出账窗口」得到唯一账期。
    </p>

    <div v-if="loading" class="card muted">加载中…</div>
    <template v-else>
      <div v-for="g in grouped" :key="g.type" class="card rule-group">
        <div class="group-title">
          <span>{{ g.icon }} {{ g.label }}</span>
          <button class="btn btn-sm" @click="f = blankForm(g.type); editingId = null; showEdit = true">+ 添加{{ g.label }}规则</button>
        </div>
        <div v-if="!g.list.length" class="muted" style="font-size: 13px">还没有该类型的规则（可点右上角添加）</div>
        <div v-for="rl in g.list" :key="rl.id" class="rule-line">
          <div class="rule-main">
            <div class="rule-name">
              {{ rl.name || g.label + "规则" }}
              <span class="eff">{{ effText(rl) }}</span>
              <span v-if="rl.category && rl.category !== DEFAULT_CAT" class="cat-chip">分类 {{ rl.category }}</span>
              <span v-else class="cat-chip muted-chip">分类 {{ DEFAULT_CAT }}</span>
            </div>
            <div class="muted rule-sum">{{ summary(rl) }}</div>
          </div>
          <div class="rule-ops">
            <button class="btn btn-sm" @click="openEdit(rl)">编辑</button>
            <button class="btn btn-sm btn-danger" @click="removeRule(rl)">删除</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 新建 / 编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit = false">
      <div class="modal wide">
        <h3 class="modal-title">{{ editingId ? "编辑规则" : "新建规则" }}</h3>
        <div class="form-grid">
          <label>类型
            <select class="select" v-model="f.type" :disabled="!!editingId" @change="onTypeChange">
              <option v-for="t in TYPES" :key="t.type" :value="t.type">{{ t.icon }} {{ t.label }}</option>
            </select>
          </label>
          <label>关联消费分类（识别该分类下含「水费/电费/燃气费/物业费」的支出流水）
            <select class="select" v-model="f.category">
              <option v-for="c in expenseCats" :key="c.name" :value="c.name">{{ [plainIcon(c.icon), c.name].filter(Boolean).join(' ') }}</option>
              <option v-if="f.category && !expenseCats.some((c) => c.name === f.category)" :value="f.category">{{ f.category }}（分类已删除）</option>
            </select>
          </label>
          <label>规则名称（选填，如 广州水费2026）
            <input class="input" v-model="f.name" placeholder="选填" />
          </label>
          <label>起始账期（首个被覆盖月份）
            <input class="input" type="month" v-model="f.effective_from" />
            <small class="field-hint">例：水费选 2024-02 → 首期覆盖 2~3 月、第一笔流水约 3 月下旬</small>
          </label>
          <label>结束账期（留空 = 至今）
            <input class="input" type="month" v-model="f.effective_to" />
          </label>
          <label>用量单位
            <select class="select" v-model="f.unit">
              <option v-for="u in ['m³', 'kWh', '元', '吨']" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
        </div>

        <!-- v2.2.17 出账日窗口 → 覆盖账期（显式账期，替代按奇偶月猜块） -->
        <div class="tier-block">
          <div class="section-title">出账日与覆盖账期
            <span class="muted hint-inline" v-if="f.type === 'water' || f.type === 'gas'">
              （一笔流水按自身日期只命中一个窗口 → 只出一张账单）
            </span>
          </div>
          <div v-for="(r, i) in f.coverRows" :key="i" class="cover-row">
            <span class="cap-lbl">{{ f.coverRows.length > 1 ? "条件 " + (i + 1) : "出账日" }}</span>
            <template v-if="!r.quarter">
              <input class="input" type="number" min="1" max="31" v-model="r.from" style="width: 72px" />
              <span class="x">—</span>
              <input class="input" type="number" min="1" max="31" v-model="r.to" style="width: 72px" />
              <span class="x">号</span>
            </template>
            <span v-else class="cov-anyday">季内任意一天</span>
            <span class="x">→ 覆盖</span>
            <select class="select" style="width: auto; flex: 1; min-width: 170px" :value="covKeyOf(r)" @change="applyCovRow(r, $event.target.value)">
              <option v-for="p in covOptionsOf(f.type)" :key="p.v" :value="p.v">{{ p.label }}</option>
            </select>
            <button class="btn btn-sm" v-if="f.coverRows.length > 1" @click="f.coverRows.splice(i, 1)">✕</button>
          </div>
          <button class="btn btn-sm" v-if="f.type === 'water' || f.type === 'gas'" @click="addCoverRow">+ 加条件</button>
          <div class="muted" style="font-size: 12px; margin-top: 6px">
            电费：月初缴上月 → 覆盖上月；物业：季度缴 → 季内任一天都归该季度（多个缴费自动合并为一季一张）。改动后可在用量页「重新扫描」重排历史账单。
          </div>
        </div>

        <div class="tier-block" v-if="f.type !== 'property'">
          <div class="section-title">阶梯档位（最后一行留空容量 = 不限量档；单价为实付单价）</div>
          <div v-for="(t, i) in f.tiers" :key="i" class="tier-row">
            <span class="cap-lbl">{{ i === f.tiers.length - 1 && !String(t.cap).trim() ? "超出部分" : "档内用量上限" }}</span>
            <input class="input" type="number" min="0" v-model="t.cap" placeholder="∞" style="width: 110px" />
            <span class="x">×</span>
            <input class="input" type="number" min="0" step="0.0001" v-model="t.price" placeholder="单价" style="width: 120px" />
            <button class="btn btn-sm" @click="rmTierRow(f.tiers, i)">✕</button>
          </div>
          <button class="btn btn-sm" @click="addTierRow(f.tiers)">+ 加一档</button>
        </div>

        <div class="tier-block" v-if="f.type === 'property'">
          <div class="section-title">物业费（固定月费，无阶梯）</div>
          <div class="tier-row">
            <span>每月物业费</span>
            <input class="input" type="number" min="0" step="0.01" v-model="f.monthly_fee" style="width: 130px" />
            <span class="x">元</span>
          </div>
        </div>

        <div class="tier-block" v-if="f.type === 'electric'">
          <div class="section-title">夏季档（夏季月份用电价高，按以下档位计）</div>
          <div class="month-chips">
            <span v-for="m in MONTH_CHIPS" :key="m" :class="['mchip', { on: f.season?.months?.includes(m) }]" @click="toggleMonth(m)">{{ m }}月</span>
          </div>
          <div v-for="(t, i) in f.season?.tiers || []" :key="'s' + i" class="tier-row">
            <span class="cap-lbl">{{ i === (f.season?.tiers?.length || 0) - 1 && !String(t.cap).trim() ? "超出部分" : "档内用量上限" }}</span>
            <input class="input" type="number" min="0" v-model="t.cap" placeholder="∞" style="width: 110px" />
            <span class="x">×</span>
            <input class="input" type="number" min="0" step="0.0001" v-model="t.price" placeholder="单价" style="width: 120px" />
            <button class="btn btn-sm" @click="rmSeasonTier(i)">✕</button>
          </div>
          <button class="btn btn-sm" @click="f.season.tiers.push({ cap: '', price: '' })">+ 加一档</button>
        </div>

        <div class="modal-foot">
          <button class="btn btn-sm" @click="showEdit = false">取消</button>
          <button class="btn btn-sm btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
.head-actions { display: flex; gap: 8px; }
.intro { font-size: 13px; margin-bottom: 14px; }
.rule-group { margin-bottom: 14px; padding: 14px 16px; }
.group-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 700; }
.rule-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--border); }
.rule-line:last-child { border-bottom: none; }
.rule-main { flex: 1; min-width: 0; }
.rule-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.eff { font-size: 12px; font-weight: 400; color: var(--primary); background: var(--primary-soft); padding: 1px 8px; border-radius: 999px; }
.cat-chip { font-size: 11px; font-weight: 400; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); }
.cat-chip.muted-chip { background: transparent; border: 1px dashed var(--border); }
.rule-sum { font-size: 12px; margin-top: 4px; }
.rule-ops { display: flex; gap: 6px; flex-shrink: 0; }

.modal.wide { width: 640px; max-width: 96vw; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-bottom: 12px; }
.form-grid label { font-size: 13px; display: flex; flex-direction: column; gap: 5px; color: var(--text-2); }
.tier-block { border-top: 1px dashed var(--border); padding-top: 10px; margin-bottom: 12px; }
.tier-block .section-title { margin-bottom: 8px; }
.tier-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; flex-wrap: wrap; }
.cap-lbl { font-size: 12px; color: var(--text-2); width: 90px; }
.x { color: var(--text-2); }
.month-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.mchip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); cursor: pointer; user-select: none; }
.mchip.on { background: var(--primary); color: #fff; }
/* v260909：bill_span 快捷 chips */
.span-input { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.span-input .input { width: 90px; flex-shrink: 0; }
.span-chips { display: inline-flex; gap: 5px; flex-wrap: wrap; }
/* v2.2.17：出账窗口 → 覆盖账期 行 */
.cover-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; flex-wrap: wrap; }
.cov-anyday { font-size: 13px; color: var(--text-2); }
.hint-inline { font-size: 11px; font-weight: 400; }
.field-hint { font-size: 11px; color: var(--text-2); line-height: 1.4; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
