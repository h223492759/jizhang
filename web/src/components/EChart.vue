<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import * as echarts from "echarts";
import { useStore } from "../store.js";

const props = defineProps({ option: { type: Object, required: true }, height: { type: String, default: "300px" } });
const emit = defineEmits(["click"]);
const store = useStore();
const el = ref(null);
let chart = null;

function render() {
  if (!el.value) return;
  if (!chart) {
    chart = echarts.init(el.value, store.theme === "dark" ? "dark" : null);
    chart.on("click", (params) => emit("click", params));
  }
  chart.setOption(props.option, true);
}
function resize() { chart && chart.resize(); }

onMounted(() => { nextTick(render); window.addEventListener("resize", resize); });
onBeforeUnmount(() => { window.removeEventListener("resize", resize); chart && chart.dispose(); chart = null; });

watch(() => props.option, render, { deep: true });
watch(() => store.theme, () => { chart && chart.dispose(); chart = null; nextTick(render); });

// 暴露图例操作（用于"全部取消/全部选中"按钮）
// 用 setOption 强制覆盖 legend.selected（比 dispatchAction 更稳，不依赖 legend 是否已渲染）
function _legendNames() {
  const data = props.option?.series?.[0]?.data || props.option?.legend?.data || [];
  return data.map((d) => (typeof d === "string" ? d : d.name)).filter(Boolean);
}
function deselectAll() {
  if (!chart) return;
  const map = {};
  for (const n of _legendNames()) map[n] = false;
  chart.setOption({ legend: { selected: map } });
}
function selectAll() {
  if (!chart) return;
  const map = {};
  for (const n of _legendNames()) map[n] = true;
  chart.setOption({ legend: { selected: map } });
}
defineExpose({ deselectAll, selectAll });
</script>

<template>
  <div ref="el" :style="{ width: '100%', height }"></div>
</template>
