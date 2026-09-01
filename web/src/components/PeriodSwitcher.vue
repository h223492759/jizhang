<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import dayjs from "dayjs";

// 月/年快速选择 chips（对齐安卓图表页交互）：
// - 月模式：本月 / 上月 / N月（近 3 年，未来月份不显示），横向滚动
//   且选中项始终居中（进入时居中一次；手动左滑/右滑后点选任意月也自动居中）
// - 年模式：今年 / 去年 / N年（近 4 年），固定 2 行 2 列展示，切换高度不跳动
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

// ---------- 选中项居中（仅月模式横向滚动时需要；年模式 2×2 网格无需滚动） ----------
// 关键：用「即时定位」（behavior: "instant"）而非平滑动画——
// 平滑动画容易被异步数据加载/图表重绘导致的布局变化中断，停在半路，
// 表现就是「进入时没居中」「拉进度条后点选移出画面」。即时定位无动画窗口期。
const wrapEl = ref(null);
const chipEls = ref({}); // value -> DOM el

function setChipRef(v, el) {
  if (el) chipEls.value[v] = el;
}

function scrollToCenter() {
  if (props.mode !== "month") return;
  const wrap = wrapEl.value;
  if (!wrap) return;
  const el = chipEls.value[props.modelValue];
  if (!el) return;
  const target = el.offsetLeft - (wrap.clientWidth - el.offsetWidth) / 2;
  // clamp 到合法滚动范围（[0, 最大可滚动距离]），避免越界/贴边后偏移
  const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  const left = Math.min(Math.max(0, target), max);
  wrap.scrollTo({ left, behavior: "instant" });
}

// 布局可能未完全就绪（页面数据加载中 / 字体样式未应用 / 容器宽度未定），
// 双重 rAF + setTimeout 兜底，确保最终一定居中
function safeCenter() {
  scrollToCenter();
  requestAnimationFrame(() => requestAnimationFrame(scrollToCenter));
  setTimeout(scrollToCenter, 150);
}

// 容器宽度变化（弹窗打开/窗口缩放/侧栏收起）时重新居中
let ro = null;
function setupResizeObserver() {
  const wrap = wrapEl.value;
  if (!wrap || typeof ResizeObserver === "undefined") return;
  ro = new ResizeObserver(() => scrollToCenter());
  ro.observe(wrap);
}
function teardownResizeObserver() {
  if (ro) { ro.disconnect(); ro = null; }
}

onMounted(() => { nextTick(safeCenter); setupResizeObserver(); });
onBeforeUnmount(teardownResizeObserver);
watch(() => props.modelValue, () => nextTick(safeCenter));
// 月/年切换后重建渲染，重新居中
watch(() => props.mode, () => nextTick(safeCenter));
</script>

<template>
  <div class="period-chips" :class="'mode-' + mode" ref="wrapEl">
    <button
      v-for="o in opts"
      :key="o.value"
      :ref="(el) => setChipRef(o.value, el)"
      class="chip"
      :class="{ on: o.value === modelValue }"
      :title="o.full"
      @click="pick(o.value)"
    >{{ o.label }}</button>
  </div>
</template>

<style scoped>
.period-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 2px;
  max-width: 100%;
  scrollbar-width: thin;
  /* 不用 scroll-behavior: smooth —— 居中全部由 JS 即时定位控制，
     避免 CSS 平滑与 JS 冲突导致动画中途被打断停在半路 */
}
/* 年模式：固定 2 行 2 列展示，切换月/年高度稳定不跳动 */
.period-chips.mode-year {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  overflow-x: visible;
}
.period-chips.mode-year .chip {
  text-align: center;
  padding: 6px 14px;
}
.chip { flex-shrink: 0; border: 1px solid var(--border); background: transparent; color: var(--text-2); padding: 5px 14px; border-radius: 999px; cursor: pointer; font-size: 13px; transition: all .15s; }
.chip:hover { border-color: var(--primary); color: var(--text); }
.chip.on { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
</style>
