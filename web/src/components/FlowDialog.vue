<script setup>
import { ref, watch, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";
import DateInput from "./DateInput.vue";

const props = defineProps({
  modelValue: Boolean,
  flow: { type: Object, default: null }, // 传入则为编辑
  preset: { type: Object, default: null }, // AI/日历预填
});
const emit = defineEmits(["update:modelValue", "saved"]);
const store = useStore();

const form = ref(blank());
function blank() {
  return {
    type: "expense",
    amount: "",
    category: "",
    payment_method: "",
    description: "",
    flow_time: dayjs().format("YYYY-MM-DD"),
    attribution: "",
    attribution_uid: null,
  };
}

const cats = computed(() =>
  store.categories.filter((c) => c.type === form.value.type)
);

// ---------------- 名称候选：常用预设 / 高频 / 最近 ----------------
const sug = ref({ presets: [], frequent: [], recent: [] });
const sugLoading = ref(false);
const hasSug = computed(
  () =>
    sug.value.presets.length + sug.value.frequent.length + sug.value.recent.length > 0
);
// 按当前所选「分类」严格过滤候选：只保留「未绑定分类」或「当前分类」的项（不回退）
const filteredSug = computed(() => {
  const cat = form.value.category;
  if (!cat) return sug.value;
  return {
    presets: sug.value.presets.filter((p) => !p.category || p.category === cat),
    frequent: sug.value.frequent.filter((p) => !p.category || p.category === cat),
    recent: sug.value.recent.filter((p) => !p.category || p.category === cat),
  };
});
const isPinned = computed(() =>
  sug.value.presets.some((p) => p.name === form.value.description)
);

// 名称候选合并：收藏(★) 与高频/最近都严格按当前分类过滤——
// 只显示「未绑定分类」或「当前分类」的收藏/高频/最近，其他分类的收藏不可见；
// 未选分类时显示全部。收藏排最前，高频/最近随后。
const sugExpanded = ref(false);
const MAX_CHIPS = 12;
const sugChips = computed(() => {
  const cat = form.value.category;
  const filter = (arr) => !cat ? arr : arr.filter((p) => !p.category || p.category === cat);
  const base = [];
  for (const p of filter(sug.value.presets || [])) base.push({ name: p.name, preset: true, id: p.id });
  for (const f of filter(sug.value.frequent || [])) base.push({ name: f.name, preset: false, count: f.count });
  const seen = new Set(base.map((b) => b.name));
  for (const f of filter(sug.value.recent || [])) {
    if (!seen.has(f.name)) { seen.add(f.name); base.push({ name: f.name, preset: false, count: f.count }); }
  }
  return { list: sugExpanded.value ? base : base.slice(0, MAX_CHIPS), overflow: base.length > MAX_CHIPS };
});

// 日期支持「20260813」整串输入，自动补成 YYYY-MM-DD
function normDate(s) {
  if (!s) return s;
  s = String(s).trim();
  const m = s.replace(/\D/g, "");
  if (m.length === 8) return `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}`;
  return s;
}
function onDateInput(e) {
  const v = normDate(e.target.value);
  if (v !== e.target.value) form.value.flow_time = v;
}

async function loadSuggestions() {
  if (!store.bookId) return;
  sugLoading.value = true;
  try {
    const { data } = await api.get("/presets", { params: { type: form.value.type } });
    sug.value = data;
  } catch {
    sug.value = { presets: [], frequent: [], recent: [] };
  } finally {
    sugLoading.value = false;
  }
}

// 点击标签：填名称，并顺带带出它常用的分类/支付方式/金额（不覆盖已填内容）
function applySug(item) {
  form.value.description = item.name;
  if (item.category && cats.value.some((c) => c.name === item.category)) {
    form.value.category = item.category;
  }
  if (item.payment_method && !form.value.payment_method) {
    form.value.payment_method = item.payment_method;
  }
  if (item.amount > 0 && !form.value.amount) {
    form.value.amount = item.amount;
  }
}

// 直接删除某个已收藏的常用名称（chip 右上角 ×）
async function removePreset(c) {
  if (!c.id) return;
  if (!confirm("删除常用名称「" + c.name + "」？（不会影响已有账单）")) return;
  try {
    await api.delete("/presets/" + c.id);
    toast("已删除");
    await loadSuggestions();
  } catch (e) {
    toast(e.message);
  }
}

// 把当前名称收藏为常用消费名称
async function togglePin() {
  const name = (form.value.description || "").trim();
  if (!name) return toast("请先填写名称");
  const exist = sug.value.presets.find((p) => p.name === name);
  try {
    if (exist) {
      await api.delete(`/presets/${exist.id}`);
      toast("已取消常用");
    } else {
      await api.post("/presets", {
        name,
        type: form.value.type,
        category: form.value.category || "",
        payment_method: form.value.payment_method || "",
      });
      toast("已加入常用");
    }
    await loadSuggestions();
  } catch (e) {
    toast(e.message);
  }
}

// ---------------- 归属人 ----------------
const attrOptions = ref({ members: [], others: [] });
// 下拉用字符串标识：u:{userId} 表示绑定用户，t:{文本} 表示自由文本
const attrKey = ref("");
async function loadAttributions() {
  if (!store.bookId) return;
  try {
    const { data } = await api.get("/flows/attributions");
    attrOptions.value = data;
  } catch {}
}
function syncAttrKey() {
  if (form.value.attribution_uid) attrKey.value = "u:" + form.value.attribution_uid;
  else if (form.value.attribution) attrKey.value = "t:" + form.value.attribution;
  else attrKey.value = "u:" + (store.user?.id || "");
}
watch(attrKey, (v) => {
  if (!v) return;
  if (v.startsWith("u:")) {
    form.value.attribution_uid = Number(v.slice(2));
    const m = attrOptions.value.members.find((x) => x.id === form.value.attribution_uid);
    form.value.attribution = m?.nickname || "";
  } else {
    form.value.attribution_uid = null;
    form.value.attribution = v.slice(2);
  }
});

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return;
    if (props.flow) {
        form.value = {
          ...props.flow,
          flow_time: dayjs(props.flow.flow_time).format("YYYY-MM-DD"),
        };
    } else {
      form.value = {
        ...blank(),
        attribution: store.user?.nickname || "",
        attribution_uid: store.user?.id || null,
      };
      if (props.preset) Object.assign(form.value, props.preset);
    }
    if (!form.value.category && cats.value[0]) form.value.category = cats.value[0].name;
    syncAttrKey();
    loadSuggestions();
    loadAttributions();
  }
);

watch(
  () => form.value.type,
  () => {
    if (!cats.value.find((c) => c.name === form.value.category)) {
      form.value.category = cats.value[0]?.name || "";
    }
    if (props.modelValue) loadSuggestions();
  }
);

const saving = ref(false);
async function save() {
  if (!form.value.amount || Number(form.value.amount) <= 0) return toast("请输入正确金额");
  saving.value = true;
  try {
    const payload = { ...form.value, amount: Number(form.value.amount) };
    if (props.flow?.id) {
      await api.put(`/flows/${props.flow.id}`, payload);
      toast("已更新");
    } else {
      await api.post("/flows", payload);
      toast("记账成功");
    }
    emit("saved");
    close();
  } catch (e) {
    toast(e.message);
  } finally {
    saving.value = false;
  }
}
function close() {
  emit("update:modelValue", false);
}
</script>

<template>
  <div v-if="modelValue" class="modal-mask" @click.self="close">
    <div class="modal">
      <h3 class="modal-title">{{ flow?.id ? "编辑记录" : "记一笔" }}</h3>

      <div class="seg">
        <button :class="{ on: form.type === 'expense' }" @click="form.type = 'expense'">支出</button>
        <button :class="{ on: form.type === 'income' }" @click="form.type = 'income'">收入</button>
      </div>

      <label class="field">
        <span>分类</span>
        <div class="cat-grid">
          <button
            v-for="c in cats" :key="c.id"
            :class="['cat', { on: form.category === c.name }]"
            @click="form.category = c.name"
          >
            <em>{{ c.icon }}</em>{{ c.name }}
          </button>
        </div>
      </label>

      <div class="row">
        <label class="field" style="flex: 1">
          <span>日期</span>
          <DateInput v-model="form.flow_time" />
        </label>
        <label class="field" style="flex: 1">
          <span>支付方式</span>
          <input class="input" v-model.trim="form.payment_method" placeholder="现金/微信/支付宝…" />
        </label>
      </div>

      <label class="field">
        <span>金额</span>
        <input class="input amount" :class="form.type" type="number" step="0.01" v-model="form.amount" placeholder="0.00" />
      </label>

      <div class="field">
        <span class="lbl-row">
          名称
          <a class="pin" :class="{ on: isPinned }" @click="togglePin">
            {{ isPinned ? "★ 取消常用" : "☆ 设为常用" }}
          </a>
        </span>

        <!-- 名称候选（常用★ 全局置顶 + 高频），显示在输入框上方，点一下即填入名称 -->
        <div class="sug" v-if="sugChips.list.length">
          <div class="sug-line comb">
            <span class="chip-wrap" v-for="(c, i) in sugChips.list" :key="i">
              <button
                class="chip" :class="{ 'chip-pin': c.preset, on: form.description === c.name }"
                @click="applySug({ name: c.name })"
              ><em v-if="c.preset" class="star">★</em>{{ c.name }}<i v-if="c.count">{{ c.count }}</i></button>
              <i v-if="c.preset && c.id" class="x" title="删除" @click.stop="removePreset(c)">×</i>
            </span>
            <button v-if="sugChips.overflow" class="chip more" @click="sugExpanded = !sugExpanded">{{ sugExpanded ? "收起 ▲" : "更多 ▼" }}</button>
          </div>
        </div>

        <input class="input" v-model.trim="form.description" placeholder="这笔钱花在哪儿（留空则自动用分类名，如「餐饮」）" />
      </div>

      <label class="field" v-if="store.currentBook && store.currentBook.members > 1">
        <span>归属人</span>
        <select class="select" v-model="attrKey">
          <option v-for="m in attrOptions.members" :key="m.id" :value="'u:' + m.id">
            {{ m.nickname }}{{ m.id === store.user?.id ? "（我）" : "" }}
          </option>
          <option v-for="o in attrOptions.others" :key="o" :value="'t:' + o">{{ o }}</option>
        </select>
      </label>

      <div class="row" style="justify-content: flex-end; margin-top: 4px">
        <button class="btn" @click="close">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seg { display: flex; background: var(--surface-2); border-radius: 10px; padding: 4px; margin-bottom: 16px; }
.seg button { flex: 1; border: none; background: transparent; padding: 9px; border-radius: 8px; cursor: pointer; color: var(--text-2); font-size: 14px; }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.amount { font-size: 22px; font-weight: 700; }
.amount.expense { color: var(--expense); }
.amount.income { color: var(--income); }
.modal { max-width: min(1100px, 96vw); }
.cat-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; }
.cat {
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--border); background: var(--surface-2); border-radius: 10px;
  padding: 10px 6px; cursor: pointer; font-size: 15px; font-weight: 600; color: var(--text-2);
}
.cat em { font-size: 20px; font-style: normal; }
.cat.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }

.lbl-row { display: flex; align-items: center; justify-content: space-between; }
.pin { font-size: 12px; color: var(--text-2); cursor: pointer; font-weight: 500; }
.pin:hover { color: var(--primary); }
.pin.on { color: var(--warning, #f59f00); }

.sug { margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; }
.sug-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chip-wrap { position: relative; display: inline-flex; }
.chip-wrap .x { position: absolute; top: -7px; right: -7px; background: var(--expense, #ef4444); color: #fff; border-radius: 50%; width: 17px; height: 17px; line-height: 17px; text-align: center; font-size: 11px; font-style: normal; cursor: pointer; z-index: 2; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.chip-wrap .x:hover { transform: scale(1.15); }
.sug-tag {
  font-size: 11px; font-weight: 600; color: var(--text-2);
  background: var(--surface-2); border-radius: 5px; padding: 2px 6px; flex-shrink: 0;
}
.pin-tag { color: var(--primary); background: var(--primary-soft); }
.chip {
  border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  border-radius: 14px; padding: 5px 12px; font-size: 14px; cursor: pointer; line-height: 1.4;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.chip i { font-style: normal; opacity: .55; margin-left: 5px; font-size: 12px; }
.chip .star { color: var(--warning, #f59f00); font-style: normal; margin-right: 4px; }
.chip.more { border-style: dashed; }
.chip-pin { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.chip-pin.on { background: var(--primary); color: #fff; }
</style>
