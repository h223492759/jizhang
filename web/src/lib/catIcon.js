import { CAT_ICON_NAMES } from "./catIconNames";

// ---------------- 分类 SVG 图标（icon-proposal 矢量图标集） ----------------
// 资产：public/icons/g/<名>.svg（深线字形，配浅底圆）
//       public/icons/gw/<名>.svg（白线字形，配彩底圆）
// 命中 CAT_ICON_NAMES 的名字用 SVG 字形，否则由组件回退 emoji。

// 圆底色：本人（attribution 等于当前用户昵称/用户名）或无归属色 → 浅灰 #F2F2F2；
// 其他归属人 → 后端下发的归属色（attribution_color）。
export function catIconBg(f, user) {
  if (
    user &&
    f.attribution &&
    (f.attribution === user.nickname || f.attribution === user.username)
  ) {
    return "#F2F2F2";
  }
  return f.attribution_color || "#F2F2F2";
}

// 按圆底亮度自动选深线/白线，保证字形在浅底/彩底上都看得清
export function catIconInk(bg) {
  const m = /^#([0-9a-f]{6})/i.exec(bg || "");
  if (!m) return "g";
  const n = parseInt(m[1], 16);
  const lum =
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
    255;
  return lum < 0.62 ? "gw" : "g";
}

export function catSvgUrl(name, ink) {
  return `/icons/${ink}/${encodeURIComponent(name)}.svg`;
}

export function hasCatSvg(name) {
  return CAT_ICON_NAMES.has(name);
}

// ---------- 分类色浅底（分类管理页） ----------
// 卡片圆底 = 分类色 + 13% 透明（#22）。选深/白字形必须看「合成后的实际底色」，
// 直接拿基色算亮度会在浅色主题里给深色分类配白字形（近白底上看不见）。
const THEME_SURFACE_RGB = {
  light: [255, 255, 255], // --surface
  dark: [24, 27, 35], // --surface #181b23
};

export function tintSolid(color, theme) {
  const m = /^#([0-9a-f]{6})/i.exec(color || "");
  if (!m) return "#F2F2F2";
  const n = parseInt(m[1], 16);
  const fg = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const bgc = THEME_SURFACE_RGB[theme === "dark" ? "dark" : "light"] ;
  const a = 0.13; // 透明度 0x22 / 255
  const out = fg.map((f, i) => Math.round(f * a + bgc[i] * (1 - a)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// select/纯文本处展示分类图标：svg: 覆盖没有对应 emoji 字符，返回空串避免显示原串
export function plainIcon(icon) {
  const s = (icon || "").trim();
  return s.startsWith("svg:") ? "" : s;
}
