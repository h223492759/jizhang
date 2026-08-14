<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  placeholder: { type: String, default: "如 20260814 或 2026-08-14" },
});
const emit = defineEmits(["update:modelValue", "error"]);

// 显示框：保留用户原始输入，便于连续打字；失焦/选日历时再归一化
const text = ref(props.modelValue || "");
const picker = ref(null);

// 归一化为 YYYY-MM-DD：支持 8 位整串(20260814) 或 分隔格式(2026-08-14 / 2026/8/14)
function normalize(s) {
  if (!s) return "";
  s = String(s).trim();
  const d = s.replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return "";
}

// 已输入内容但无法解析为合法日期 → 报错（避免「设了生效日期却静默丢失」）
const error = computed(() => text.value.trim().length > 0 && normalize(text.value) === "");

function onInput(e) {
  text.value = e.target.value;
  const v = normalize(text.value);
  emit("update:modelValue", v);
  emit("error", v === "" && text.value.trim() !== "");
}
function onBlur() {
  const v = normalize(text.value);
  if (v) {
    text.value = v;
    emit("update:modelValue", v);
  }
  emit("error", false);
}

function openPicker() {
  const el = picker.value;
  if (!el) return;
  const cur = normalize(props.modelValue);
  el.value = cur || "";
  try { el.showPicker(); } catch { el.click(); }
}
function onPick(e) {
  const v = e.target.value;
  if (v) {
    text.value = v;
    emit("update:modelValue", v);
    emit("error", false);
  }
}
</script>

<template>
  <span class="date-input">
    <input
      class="input date-input__text"
      :class="{ 'is-error': error }"
      type="text"
      inputmode="numeric"
      :value="text"
      :placeholder="placeholder"
      @input="onInput"
      @blur="onBlur"
    />
    <span v-if="error" class="date-input__err">格式不对</span>
    <button type="button" class="date-input__btn" title="选择日期" @click="openPicker">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    </button>
    <input ref="picker" class="date-input__hidden" type="date" tabindex="-1" aria-hidden="true" @change="onPick" />
  </span>
</template>

<style scoped>
.date-input { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.date-input__text { width: 170px; }
.date-input__text.is-error { border-color: var(--expense); }
.date-input__err { color: var(--expense); font-size: 12px; }
.date-input__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 34px; padding: 0;
  border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text-2); border-radius: 8px; cursor: pointer;
}
.date-input__btn:hover { color: var(--primary); border-color: var(--primary); }
.date-input__hidden { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
</style>
