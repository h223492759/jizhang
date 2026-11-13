// 侧边栏导航项的**唯一事实源**。
//
// 为什么单独抽文件：Layout.vue（渲染侧边栏）和 Settings.vue（导航栏管理）原先各自
// 维护了一份列表，新增页面时只改了一处 → 「回收站 / 水电气」只在侧边栏出现、
// 设置里无法排序改名（v2.2.19 修复）。以后新增页面**只改这里**。
//
// 字段说明：
//   name   —— 路由 name（与 router.js 保持一致）
//   label  —— 默认显示名（用户可在设置里改名，存 localStorage）
//   icon   —— 侧边栏图标
//   admin  —— true 表示仅管理员可见
export const ALL_NAV = [
  { name: "dashboard", label: "首页", icon: "🏠" },
  { name: "flows", label: "流水", icon: "📒" },
  { name: "stats", label: "统计", icon: "📊" },
  { name: "budgets", label: "预算", icon: "🎯" },
  { name: "ai", label: "AI记账", icon: "✨" },
  { name: "autologs", label: "记账日志", icon: "📜" },
  { name: "import", label: "导入", icon: "📥" },
  { name: "trash", label: "回收站", icon: "🗑️" },
  { name: "books", label: "账本", icon: "📚" },
  { name: "categories", label: "分类", icon: "🏷️" },
  { name: "presets", label: "常用名称", icon: "🔖" },
  { name: "bills", label: "账单", icon: "🧾" },
  { name: "utility", label: "水电气", icon: "🚰" },
  { name: "savings", label: "存款目标", icon: "🏁" },
  { name: "wallets", label: "分类钱包", icon: "👝" },
  { name: "users", label: "用户管理", icon: "👥", admin: true },
  { name: "settings", label: "设置", icon: "⚙️" },
];

// 导航自定义（顺序 + 改名）：服务端 /api/settings/nav 按用户云同步（v1.2.1），
// localStorage 仅作缓存（登录后服务端配置优先覆盖本地）
export const NAV_ORDER_KEY = "jizhang_nav_order";
export const NAV_NAMES_KEY = "jizhang_nav_names";

/**
 * 把 localStorage 里的自定义顺序/名称套用到默认列表上。
 * @param {{order: string[]|null, names: Record<string,string>}} custom
 * @returns {typeof ALL_NAV} 套用后的新数组（不修改 ALL_NAV）
 */
export function applyNavCustom({ order, names } = {}) {
  let list = [...ALL_NAV];
  if (Array.isArray(order) && order.length) {
    const byName = Object.fromEntries(list.map((n) => [n.name, n]));
    // 已知项按自定义顺序排前，未在 order 里的新项按默认顺序补在后面
    const ordered = order.map((nm) => byName[nm]).filter(Boolean);
    const rest = list.filter((n) => !order.includes(n.name));
    list = [...ordered, ...rest];
  }
  const safeNames = names && typeof names === "object" ? names : {};
  return list.map((n) => ({ ...n, label: safeNames[n.name] || n.label }));
}

/** 读取本地导航自定义配置（异常时回退默认） */
export function loadNavCustom() {
  try {
    const order = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || "null");
    const names = JSON.parse(localStorage.getItem(NAV_NAMES_KEY) || "{}");
    return { order, names };
  } catch {
    return { order: null, names: {} };
  }
}
