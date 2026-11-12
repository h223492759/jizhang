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
