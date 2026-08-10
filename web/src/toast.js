import { ref } from "vue";

export const toastMsg = ref("");
let timer = null;

export function toast(msg) {
  toastMsg.value = msg;
  clearTimeout(timer);
  timer = setTimeout(() => (toastMsg.value = ""), 2200);
}
