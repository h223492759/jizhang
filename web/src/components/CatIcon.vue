<template>
  <span class="cat-icon" :style="{ width: size + 'px', height: size + 'px', background: bg, fontSize: Math.round(size * 0.46) + 'px' }">
    <img v-if="svgUrl" :src="svgUrl" alt="" draggable="false" @error="onSvgError" />
    <span v-else class="cat-icon-emoji">{{ emoji }}</span>
  </span>
</template>

<script setup>
// 分类圆形图标：圆底 + 矢量字形（icon-proposal 图标集），无对应字形时回退 emoji。
// bg 传归属人专属色时自动切白线字形，浅色底自动用深线字形。
// v1.2.1：SVG 加载失败（名单与资产不同步时）也回退 emoji，避免显示破图。
import { computed, ref, watch } from "vue";
import { CAT_ICON_NAMES } from "../lib/catIconNames";
import { catIconInk, catSvgUrl } from "../lib/catIcon";

const props = defineProps({
  name: { type: String, default: "" },
  bg: { type: String, default: "#F2F2F2" },
  size: { type: Number, default: 36 },
  emoji: { type: String, default: "💰" },
});

const failed = ref(false);
watch(() => props.name, () => { failed.value = false; });

const svgUrl = computed(() => {
  if (failed.value) return "";
  if (!props.name || !CAT_ICON_NAMES.has(props.name)) return "";
  return catSvgUrl(props.name, catIconInk(props.bg));
});

function onSvgError() {
  failed.value = true;
}
</script>

<style scoped>
.cat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex: none;
  vertical-align: middle;
  overflow: hidden;
  line-height: 1;
}
.cat-icon img {
  width: 84%;
  height: 84%;
  pointer-events: none;
}
.cat-icon-emoji {
  line-height: 1;
}
</style>
