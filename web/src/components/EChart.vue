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
function deselectAll() { chart && chart.dispatchAction({ type: "legendAllUnSelect" }); }
function selectAll() { chart && chart.dispatchAction({ type: "legendAllSelect" }); }
defineExpose({ deselectAll, selectAll });
</script>

<template>
  <div ref="el" :style="{ width: '100%', height }"></div>
</template>
