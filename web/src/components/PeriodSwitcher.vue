<script setup>
import { computed } from "vue";
import dayjs from "dayjs";

// 月/年快速选择 chips（对齐安卓图表页交互）：
// - 月模式：本月 / 上月 / N月（近 3 年，未来月份不显示）
// - 年模式：今年 / 去年 / N年（近 4 年）
// 选中项高亮；title 显示完整年月便于识别跨年月份。
const props = defineProps({
  mode: { type: String, default: "month" }, // month | year
  modelValue: { type: String, default: "" }, // YYYY-MM（月模式）或 YYYY（年模式）
});
const emit = defineEmits(["update:modelValue"]);

const now = dayjs();

const monthOpts = computed(() => {
  const opts = [];
  for (let y = now.year() - 2; y <= now.year(); y++) {
    const maxM = y === now.year() ? now.month() + 1 : 12; // 未来月份不显示
    for (let m = 1; m <= maxM; m++) {
      const mm = String(m).padStart(2, "0");
      let label = `${m}月`;
      if (y === now.year() && m === now.month() + 1) label = "本月";
      else if (y === now.year() && m === now.month()) label = "上月";
      opts.push({ value: `${y}-${mm}`, label, full: `${y}年${m}月` });
    }
  }
  return opts;
});

const yearOpts = computed(() => {
  const opts = [];
  for (let y = now.year() - 3; y <= now.year(); y++) {
    let label = `${y}年`;
    if (y === now.year()) label = "今年";
    else if (y === now.year() - 1) label = "去年";
    opts.push({ value: String(y), label, full: `${y}年` });
  }
  return opts;
});

const opts = computed(() => (props.mode === "year" ? yearOpts.value : monthOpts.value));

function pick(v) {
  if (v !== props.modelValue) emit("update:modelValue", v);
}
</script>

<template>
  <div class="period-chips">
    <button
      v-for="o in opts"
      :key="o.value"
      class="chip"
      :class="{ on: o.value === modelValue }"
      :title="o.full"
      @click="pick(o.value)"
    >{{ o.label }}</button>
  </div>
</template>

<style scoped>
.period-chips { display: flex; gap: 6px; overflow-x: auto; padding: 4px 2px; max-width: 100%; scrollbar-width: thin; }
.chip { flex-shrink: 0; border: 1px solid var(--border); background: transparent; color: var(--text-2); padding: 5px 14px; border-radius: 999px; cursor: pointer; font-size: 13px; transition: all .15s; }
.chip:hover { border-color: var(--primary); color: var(--text); }
.chip.on { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
</style>
