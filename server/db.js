import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// 数据目录：容器内固定挂载 /app/data，可用 DATA_DIR 覆盖
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = path.join(DATA_DIR, "jizhang.db");
// 兼容旧版：若仍存在 cashbook.db（含 WAL/SHM），启动时自动改名为 jizhang.db，保证历史数据不丢
const legacyDb = path.join(DATA_DIR, "cashbook.db");
if (fs.existsSync(legacyDb) && !fs.existsSync(dbFile)) {
  for (const suf of ["", "-wal", "-shm"]) {
    const from = legacyDb + suf;
    const to = dbFile + suf;
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
}
export const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------- 建表 ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  nickname   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user',   -- admin | user
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  owner_id   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS book_members (
  book_id  INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  role     TEXT NOT NULL DEFAULT 'editor',   -- owner | editor
  PRIMARY KEY (book_id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id  INTEGER NOT NULL,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,                    -- expense | income
  icon     TEXT NOT NULL DEFAULT '💰',
  color    TEXT NOT NULL DEFAULT '#7c8cff',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flows (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id        INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,           -- 创建人
  attribution    TEXT NOT NULL DEFAULT '',   -- 归属人（昵称）
  type           TEXT NOT NULL,              -- expense | income
  amount         REAL NOT NULL,
  category       TEXT NOT NULL DEFAULT '其他',
  payment_method TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  flow_time      TEXT NOT NULL,              -- YYYY-MM-DD HH:mm:ss
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_flows_book_time ON flows(book_id, flow_time);

CREATE TABLE IF NOT EXISTS budgets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id  INTEGER NOT NULL,
  year     INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT '',         -- '' = 年度总预算；否则为分类预算
  amount   REAL NOT NULL DEFAULT 0,
  UNIQUE (book_id, year, category)
);

-- 常用消费名称预设（手动置顶的名称模板）
CREATE TABLE IF NOT EXISTS presets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id        INTEGER NOT NULL,
  name           TEXT NOT NULL,              -- 名称文本，如「早饭」「地铁通勤」
  type           TEXT NOT NULL DEFAULT 'expense',
  category       TEXT NOT NULL DEFAULT '',   -- 可选：点击后自动带出的分类
  payment_method TEXT NOT NULL DEFAULT '',   -- 可选：点击后自动带出的支付方式
  amount         REAL NOT NULL DEFAULT 0,    -- 可选：常用金额，0=不预填
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (book_id, type, name)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 定期记账模板：每月/每年固定的收支，到期自动生成真实流水
CREATE TABLE IF NOT EXISTS recurring (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id        INTEGER NOT NULL,
  type           TEXT NOT NULL DEFAULT 'expense',  -- expense | income
  category       TEXT NOT NULL DEFAULT '其他',
  description    TEXT NOT NULL DEFAULT '',
  amount         REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT '',
  freq           TEXT NOT NULL DEFAULT 'monthly',  -- monthly | yearly
  day_of_month   INTEGER NOT NULL DEFAULT 1,       -- 每月几号 / 每年的日期（号）
  month_of_year  INTEGER NOT NULL DEFAULT 1,       -- 仅 yearly 用：第几月
  note           TEXT NOT NULL DEFAULT '',
  next_run       TEXT NOT NULL,                    -- 下一次应记账日期 YYYY-MM-DD
  last_period    TEXT NOT NULL DEFAULT '',         -- 最近一次生成的周期（去重用）
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_recurring_book ON recurring(book_id);

-- ============ 存款目标 ============
-- 每个账本一个存款目标（如 100 万）
CREATE TABLE IF NOT EXISTS savings_goal (
  book_id    INTEGER PRIMARY KEY,
  target     REAL NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 资金细则：现金 / 微信余额 / 信用卡账单 …
-- sign = 1 计为资产（正），-1 计为负债（负），默认正
CREATE TABLE IF NOT EXISTS savings_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  sign       INTEGER NOT NULL DEFAULT 1,
  amount     REAL NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sav_items_book ON savings_items(book_id, sort);

-- 资产历史：每次更新资产/负债都会 upsert 当天一条，
-- 历史月表/柱状图按月取「该月最后更新日期」那条（每月只显示一次数据）
CREATE TABLE IF NOT EXISTS savings_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL,
  ymd        TEXT NOT NULL,                    -- YYYY-MM-DD
  asset      REAL NOT NULL DEFAULT 0,          -- 正向合计（资产）
  liability  REAL NOT NULL DEFAULT 0,          -- 负向合计（负债，存正数）
  net        REAL NOT NULL DEFAULT 0,          -- 净资产 = asset - liability
  user_id    INTEGER NOT NULL DEFAULT 0,
  op_user    TEXT NOT NULL DEFAULT '',         -- 操作人昵称（冗余，优先按 user_id 解析当前昵称）
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (book_id, ymd)
);
CREATE INDEX IF NOT EXISTS idx_sav_hist_book ON savings_history(book_id, ymd);

-- ============ 分类钱包（专项资金池） ============
-- 如「养娃 / 买房 / 买车」，每月发工资后固定存入
CREATE TABLE IF NOT EXISTS wallets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '👛',
  target     REAL NOT NULL DEFAULT 0,          -- 可选目标金额，0 = 不设目标
  note       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_wallets_book ON wallets(book_id, sort);

-- 钱包资金记录：每笔都带日期、金额、操作人。amount 为正=存入，负=支出
CREATE TABLE IF NOT EXISTS wallet_txns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL,
  wallet_id  INTEGER NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  ymd        TEXT NOT NULL,                    -- YYYY-MM-DD
  note       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER NOT NULL DEFAULT 0,
  op_user    TEXT NOT NULL DEFAULT '',         -- 操作人昵称（冗余）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_txns ON wallet_txns(book_id, wallet_id, ymd);
`);

// ---------------- 轻量迁移 ----------------
// 老版本 flows 只存了 attribution 昵称文本，改昵称后历史记录不会跟着变。
// 这里补一列 attribution_uid 存用户ID，读取时实时解析当前昵称。
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  }
  return false;
}

const added = addColumnIfMissing(
  "flows",
  "attribution_uid",
  "attribution_uid INTEGER"
);
if (added) {
  // 历史数据回填：按昵称精确匹配到用户
  db.exec(`
    UPDATE flows
       SET attribution_uid = (SELECT u.id FROM users u WHERE u.nickname = flows.attribution)
     WHERE attribution_uid IS NULL
       AND attribution <> ''
  `);
  console.log("[migrate] flows.attribution_uid 已添加并回填");
}
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_flows_attr_uid ON flows(book_id, attribution_uid)"
);

// 用户颜色：流水归属与统计饼图按此区分
addColumnIfMissing("users", "color", "color TEXT NOT NULL DEFAULT '#7c8cff'");

// 预算金额支持算式（如 "1000+200"），保存时存计算结果，原始算式留作备注
addColumnIfMissing("budgets", "expression", "expression TEXT NOT NULL DEFAULT ''");

// 分类钱包可关联某一流水分类（自某日期起），该分类的支出自动加减到钱包余额
addColumnIfMissing("wallets", "link_from", "link_from TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("wallets", "link_category", "link_category TEXT NOT NULL DEFAULT ''");

// 定期记账模板归属：默认按创建账号填充，生成的流水归属到该账号（共享账本双方都能看到）
addColumnIfMissing("recurring", "attribution_uid", "attribution_uid INTEGER");
addColumnIfMissing("recurring", "attribution", "attribution TEXT NOT NULL DEFAULT ''");

// 资金细则可带一个生效日期（用于回填历史资产），空=当前
addColumnIfMissing("savings_items", "as_of", "as_of TEXT NOT NULL DEFAULT ''");

// 资金细则可带一个失效日期，空=长期有效；更新资产日期晚于失效日则该细则不再计入、不显示
addColumnIfMissing("savings_items", "as_of_end", "as_of_end TEXT NOT NULL DEFAULT ''");

// 历史月净资产快照：manual=1 表示人工回填的历史快照，rebuildHistory 不再覆盖该月
addColumnIfMissing("savings_history", "manual", "manual INTEGER NOT NULL DEFAULT 0");

// 给用户分配一个稳定的颜色（按用户名哈希，避免每次刷新都变）
const USER_PALETTE = ["#6366f1","#ef4444","#f59e0b","#10b981","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#0ea5e9","#a855f7","#22c55e"];
export function pickColor(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return USER_PALETTE[h % USER_PALETTE.length];
}

// ---------------- 分类固定顺序 ----------------
// 与用户确认的分类列表完全一致（先支出后收入），新增 / 排序 / 归一化都以这里为准
const CAT_META = {
  餐饮: { icon: "🍜", color: "#ff6b6b" },
  购物: { icon: "🛍️", color: "#ff922b" },
  日用: { icon: "🧴", color: "#74c0fc" },
  交通: { icon: "🚌", color: "#4dabf7" },
  水果: { icon: "🍎", color: "#ff6b6b" },
  孩子: { icon: "👶", color: "#f06595" },
  零食: { icon: "🍪", color: "#ff922b" },
  运动: { icon: "🏀", color: "#4dabf7" },
  娱乐: { icon: "🎮", color: "#f06595" },
  通讯: { icon: "📱", color: "#22b8cf" },
  服饰: { icon: "👕", color: "#e64980" },
  美容: { icon: "💄", color: "#f783ac" },
  住房: { icon: "🏠", color: "#845ef7" },
  长辈: { icon: "👴", color: "#868e96" },
  社交: { icon: "🤝", color: "#20c997" },
  旅行: { icon: "✈️", color: "#15aabf" },
  烟酒: { icon: "🍺", color: "#fab005" },
  数码: { icon: "💻", color: "#1c7ed6" },
  医疗: { icon: "💊", color: "#20c997" },
  居家: { icon: "🛋️", color: "#845ef7" },
  书籍: { icon: "📚", color: "#5c7cfa" },
  学习: { icon: "📖", color: "#5c7cfa" },
  宠物: { icon: "🐱", color: "#f783ac" },
  礼金: { icon: "🧧", color: "#e03131" },
  备婚: { icon: "💒", color: "#f06595" },
  礼物: { icon: "💝", color: "#fa5252" },
  办公: { icon: "📎", color: "#495057" },
  亲友: { icon: "👫", color: "#12b886" },
  彩票: { icon: "🎰", color: "#ae3ec9" },
  保险: { icon: "🛡️", color: "#4263eb" },
  人情: { icon: "🤝", color: "#fa5252" },
  汽车: { icon: "🚗", color: "#339af0" },
  快递: { icon: "📦", color: "#f59f00" },
  捐赠: { icon: "🪙", color: "#0ca678" },
  工资: { icon: "💼", color: "#37b24d" },
  兼职: { icon: "💼", color: "#2f9e44" },
  理财: { icon: "📈", color: "#1c7ed6" },
  其它: { icon: "💰", color: "#0ca678" },
  其他: { icon: "💸", color: "#868e96" },
};
// 用户确认的分类顺序：支出 34 项（含末尾「其他」兜底），收入 5 项
const EXPENSE_ORDER = ["餐饮","购物","日用","交通","水果","孩子","零食","运动","娱乐","通讯","服饰","美容","住房","长辈","社交","旅行","烟酒","数码","医疗","居家","书籍","学习","宠物","礼金","备婚","礼物","办公","亲友","彩票","保险","人情","汽车","快递","捐赠","其他"];
const INCOME_ORDER = ["工资","兼职","理财","礼金","其它"];
const metaOf = (name) => CAT_META[name] || { icon: "💰", color: "#7c8cff" };
export const CANONICAL_CATEGORIES = [
  ...EXPENSE_ORDER.map((n) => ({ name: n, type: "expense", ...metaOf(n) })),
  ...INCOME_ORDER.map((n) => ({ name: n, type: "income", ...metaOf(n) })),
];
// 兼容旧引用（播种 / 新建账本都以 CANONICAL_CATEGORIES 为准）
export const DEFAULT_CATEGORIES = CANONICAL_CATEGORIES;

// 幂等写入：已存在的（同名同类型）跳过，可安全重复调用，
// 既能给新账本播种，也能给老账本补充缺失的默认分类
export function seedCategories(bookId) {
  const exists = db.prepare(
    "SELECT 1 FROM categories WHERE book_id=? AND name=? AND type=?"
  );
  const getMax = db.prepare(
    "SELECT COALESCE(MAX(sort),0) AS m FROM categories WHERE book_id=? AND type=?"
  );
  const stmt = db.prepare(
    "INSERT INTO categories (book_id, name, type, icon, color, sort) VALUES (?,?,?,?,?,?)"
  );
  const tx = db.transaction((bid) => {
    for (const c of DEFAULT_CATEGORIES) {
      if (exists.get(bid, c.name, c.type)) continue;
      const max = getMax.get(bid, c.type).m;
      stmt.run(bid, c.name, c.type, c.icon, c.color, max + 1);
    }
  });
  tx(bookId);
}

// 启动时为所有已存在的账本补充缺失的默认分类（幂等）
export function ensureDefaultCategoriesForAllBooks() {
  const books = db.prepare("SELECT id FROM books").all();
  for (const b of books) seedCategories(b.id);
}

// 把已有账本的分类整理成用户确认的顺序：补齐缺失、重排顺序、归一化命名。
// - 居住 → 住房（同步历史流水分类名）
// - 其他收入 → 其它
// - 删除不在用户列表中的旧收入分类（奖金 / 红包，仅删分类行，历史流水保留原分类名）
// 幂等，可每次启动安全调用。
export function applyCanonicalCategoryOrder() {
  const books = db.prepare("SELECT id FROM books").all();
  const setSort = db.prepare("UPDATE categories SET sort=? WHERE id=?");
  const ins = db.prepare(
    "INSERT INTO categories (book_id,name,type,icon,color,sort) VALUES (?,?,?,?,?,?)"
  );
  const getMax = db.prepare(
    "SELECT COALESCE(MAX(sort),0) AS m FROM categories WHERE book_id=? AND type=?"
  );
  const del = db.prepare(
    "DELETE FROM categories WHERE book_id=? AND name=? AND type=?"
  );
  const renameFlows = db.prepare(
    "UPDATE flows SET category=? WHERE book_id=? AND category=? AND type=?"
  );
  const exists = (bid, name, type) =>
    db.prepare("SELECT 1 FROM categories WHERE book_id=? AND name=? AND type=?").get(bid, name, type);

  const tx = db.transaction((bid) => {
    // 1) 命名归一化：旧名 → 新名。
    //    若新名已在 canonical 中存在（新建账本已自带），则把旧分类下的流水并入新名后删除旧分类，避免重名。
    const normalizeRename = (oldName, oldType, newName) => {
      if (!exists(bid, oldName, oldType)) return;
      renameFlows.run(newName, bid, oldName, oldType);
      del.run(bid, oldName, oldType);
    };
    normalizeRename("居住", "expense", "住房");
    normalizeRename("其他收入", "income", "其它");
    // 2) 删除不在用户列表中的旧分类（奖金/红包）：流水归入兜底分类后删除分类行
    for (const ob of ["奖金", "红包"]) {
      if (exists(bid, ob, "income")) {
        renameFlows.run("其它", bid, ob, "income");
        del.run(bid, ob, "income");
      }
      if (exists(bid, ob, "expense")) {
        renameFlows.run("其他", bid, ob, "expense");
        del.run(bid, ob, "expense");
      }
    }

    // 3) 重排：canonical 依次占 1..N，其余（用户自定义等）追加在后面，避免序号冲突
    const rows = db
      .prepare("SELECT id,name,type FROM categories WHERE book_id=?")
      .all(bid);
    const canon = new Set(CANONICAL_CATEGORIES.map((c) => `${c.type}:${c.name}`));
    let ex = 1,
      inc = 1;
    for (const c of CANONICAL_CATEGORIES) {
      const sort = c.type === "expense" ? ex++ : inc++;
      const row = rows.find((r) => r.name === c.name && r.type === c.type);
      if (row) setSort.run(sort, row.id);
      else ins.run(bid, c.name, c.type, c.icon, c.color, sort);
    }
    let exTail = 9000,
      incTail = 9000;
    for (const r of rows) {
      if (!canon.has(`${r.type}:${r.name}`)) {
        setSort.run(r.type === "expense" ? exTail++ : incTail++, r.id);
      }
    }
  });
  for (const b of books) tx(b.id);
  console.log(`[init] 已按用户确认顺序整理 ${books.length} 个账本的分类`);
}

// ---------------- 全局设置（KV） ----------------
// 用于持久化可在界面里修改的配置，例如 AI 记账（baseUrl/apiKey/模型等）。
// 环境变量仍作为兜底，DB 里的值优先。
export function getSetting(key, def = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row ? row.value : def;
}
export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}
export function getAllSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

// ---------------- 创建用户（含默认账本与分类） ----------------
// 注册接口与管理员新增用户共用同一套逻辑，避免行为不一致
export function createUserWithBook({ username, password, nickname, role = "user" }) {
  const nick = (nickname || "").trim() || username;
  const hash = bcrypt.hashSync(password, 10);
  const color = pickColor(username);
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO users (username, password, nickname, role, color) VALUES (?,?,?,?,?)"
      )
      .run(username, hash, nick, role === "admin" ? "admin" : "user", color);
    const uid = Number(info.lastInsertRowid);
    const book = db
      .prepare("INSERT INTO books (name, owner_id) VALUES (?,?)")
      .run(`${nick}的账本`, uid);
    const bid = Number(book.lastInsertRowid);
    db.prepare(
      "INSERT INTO book_members (book_id, user_id, role) VALUES (?,?, 'owner')"
    ).run(bid, uid);
    seedCategories(bid);
    return { id: uid, username, nickname: nick, role, bookId: bid };
  });
  return tx();
}

// ---------------- 初始化默认管理员 ----------------
export function ensureAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      "INSERT INTO users (username, password, nickname, role, color) VALUES (?,?,?,'admin',?)"
    )
    .run(username, hash, "管理员", pickColor(username));
  const uid = info.lastInsertRowid;
  const book = db
    .prepare("INSERT INTO books (name, owner_id) VALUES (?,?)")
    .run("我的账本", uid);
  const bid = book.lastInsertRowid;
  db.prepare(
    "INSERT INTO book_members (book_id, user_id, role) VALUES (?,?, 'owner')"
  ).run(bid, uid);
  seedCategories(bid);
  console.log(`[init] 已创建默认管理员账号：${username} / ${password}`);
}
