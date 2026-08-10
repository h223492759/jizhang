<script setup>
import { ref, watch, computed } from "vue";
import dayjs from "dayjs";
import api from "../api.js";
import { useStore } from "../store.js";
import { toast } from "../toast.js";

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
    flow_time: dayjs().format("YYYY-MM-DDTHH:mm"),
    attribution: "",
    attribution_uid: null,
  };
}

const cats = computed(() =>
  store.categories.filter((c) => c.type === form.value.type)
);

// ---------------- 备注候选：常用预设 / 高频 / 最近 ----------------
const sug = ref({ presets: [], frequent: [], recent: [] });
const sugLoading = ref(false);
const hasSug = computed(
  () =>
    sug.value.presets.length + sug.value.frequent.length + sug.value.recent.length > 0
);
const isPinned = computed(() =>
  sug.value.presets.some((p) => p.name === form.value.description)
);

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

// 点击标签：填备注，并顺带带出它常用的分类/支付方式/金额（不覆盖已填内容）
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

// 把当前备注收藏为常用消费名称
async function togglePin() {
  const name = (form.value.description || "").trim();
  if (!name) return toast("请先填写备注");
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
        flow_time: dayjs(props.flow.flow_time).format("YYYY-MM-DDTHH:mm"),
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
        <span>金额</span>
        <input class="input amount" :class="form.type" type="number" step="0.01" v-model="form.amount" placeholder="0.00" />
      </label>

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
          <span>时间</span>
          <input class="input" type="datetime-local" v-model="form.flow_time" />
        </label>
        <label class="field" style="flex: 1">
          <span>支付方式</span>
          <input class="input" v-model.trim="form.payment_method" placeholder="现金/微信/支付宝…" />
        </label>
      </div>

      <div class="field">
        <span class="lbl-row">
          备注
          <a class="pin" :class="{ on: isPinned }" @click="togglePin">
            {{ isPinned ? "★ 取消常用" : "☆ 设为常用" }}
          </a>
        </span>
        <input class="input" v-model.trim="form.description" placeholder="这笔钱花在哪儿" />

        <!-- 可点击的备注候选：常用置顶 → 高频 → 最近 -->
        <div class="sug" v-if="hasSug">
          <div class="sug-line" v-if="sug.presets.length">
            <b class="sug-tag pin-tag">常用</b>
            <button
              v-for="p in sug.presets" :key="'p' + p.id"
              class="chip chip-pin" :class="{ on: form.description === p.name }"
              @click="applySug(p)"
            >{{ p.name }}</button>
          </div>
          <div class="sug-line" v-if="sug.frequent.length">
            <b class="sug-tag">高频</b>
            <button
              v-for="p in sug.frequent" :key="'f' + p.name"
              class="chip" :class="{ on: form.description === p.name }"
              @click="applySug(p)"
            >{{ p.name }}<i>{{ p.count }}</i></button>
          </div>
          <div class="sug-line" v-if="sug.recent.length">
            <b class="sug-tag">最近</b>
            <button
              v-for="p in sug.recent" :key="'r' + p.name"
              class="chip" :class="{ on: form.description === p.name }"
              @click="applySug(p)"
            >{{ p.name }}</button>
          </div>
        </div>
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
.cat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cat {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  border: 1px solid var(--border); background: var(--surface-2); border-radius: 10px;
  padding: 9px 4px; cursor: pointer; font-size: 12px; color: var(--text-2);
}
.cat em { font-size: 19px; font-style: normal; }
.cat.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }

.lbl-row { display: flex; align-items: center; justify-content: space-between; }
.pin { font-size: 12px; color: var(--text-2); cursor: pointer; font-weight: 500; }
.pin:hover { color: var(--primary); }
.pin.on { color: var(--warning, #f59f00); }

.sug { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.sug-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sug-tag {
  font-size: 11px; font-weight: 600; color: var(--text-2);
  background: var(--surface-2); border-radius: 5px; padding: 2px 6px; flex-shrink: 0;
}
.pin-tag { color: var(--primary); background: var(--primary-soft); }
.chip {
  border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  border-radius: 14px; padding: 4px 10px; font-size: 12.5px; cursor: pointer; line-height: 1.4;
}
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.chip i { font-style: normal; opacity: .55; margin-left: 4px; font-size: 11px; }
.chip-pin { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.chip-pin.on { background: var(--primary); color: #fff; }
</style>
