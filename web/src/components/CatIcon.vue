<template>
  <span class="cat-icon" :style="{ width: size + 'px', height: size + 'px', background: bg, fontSize: Math.round(size * 0.46) + 'px' }">
    <img v-if="svgUrl" :src="svgUrl" alt="" draggable="false" @error="onSvgError" />
    <span v-else class="cat-icon-emoji">{{ emoji }}</span>
  </span>
</template>

<script setup>
// 分类圆形图标：圆底 + 矢量字形（icon-proposal 图标集），无对应字形时回退 emoji。
// bg 传归属人专属色时自动切白线字形，浅色底自动用深线字形。
// v1.2.2：支持图标覆盖——emoji 传 "svg:<字形名>" 时按该字形渲染（分类编辑里挑选的
// 矢量图标，可与分类名不同）；覆盖名无资产时回退原逻辑。
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
watch(() => [props.name, props.emoji], () => { failed.value = false; });

// 实际用于取字形的名字：emoji 里的 "svg:xxx" 覆盖优先，否则按分类名
const glyphName = computed(() => {
  const e = (props.emoji || "").trim();
  if (e.startsWith("svg:")) {
    const g = e.slice(4).trim();
    if (g && CAT_ICON_NAMES.has(g)) return g;
  }
  return props.name;
});

const svgUrl = computed(() => {
  if (failed.value) return "";
  const g = glyphName.value;
  if (!g || !CAT_ICON_NAMES.has(g)) return "";
  return catSvgUrl(g, catIconInk(props.bg));
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
