import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// 数据目录：容器内固定挂载 /app/data，可用 DATA_DIR 覆盖
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = path.join(DATA_DIR, "cashbook.db");
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

// ---------------- 默认分类 ----------------
export const DEFAULT_CATEGORIES = [
  { name: "餐饮", type: "expense", icon: "🍜", color: "#ff6b6b" },
  { name: "购物", type: "expense", icon: "🛍️", color: "#ff922b" },
  { name: "交通", type: "expense", icon: "🚌", color: "#4dabf7" },
  { name: "居住", type: "expense", icon: "🏠", color: "#845ef7" },
  { name: "娱乐", type: "expense", icon: "🎮", color: "#f06595" },
  { name: "医疗", type: "expense", icon: "💊", color: "#20c997" },
  { name: "学习", type: "expense", icon: "📚", color: "#5c7cfa" },
  { name: "通讯", type: "expense", icon: "📱", color: "#22b8cf" },
  { name: "人情", type: "expense", icon: "🎁", color: "#fa5252" },
  { name: "其他", type: "expense", icon: "💸", color: "#868e96" },
  { name: "工资", type: "income", icon: "💼", color: "#37b24d" },
  { name: "奖金", type: "income", icon: "🏆", color: "#f59f00" },
  { name: "理财", type: "income", icon: "📈", color: "#1c7ed6" },
  { name: "红包", type: "income", icon: "🧧", color: "#e03131" },
  { name: "其他收入", type: "income", icon: "🪙", color: "#0ca678" },
];

export function seedCategories(bookId) {
  const stmt = db.prepare(
    "INSERT INTO categories (book_id, name, type, icon, color, sort) VALUES (?,?,?,?,?,?)"
  );
  DEFAULT_CATEGORIES.forEach((c, i) =>
    stmt.run(bookId, c.name, c.type, c.icon, c.color, i)
  );
}

// ---------------- 创建用户（含默认账本与分类） ----------------
// 注册接口与管理员新增用户共用同一套逻辑，避免行为不一致
export function createUserWithBook({ username, password, nickname, role = "user" }) {
  const nick = (nickname || "").trim() || username;
  const hash = bcrypt.hashSync(password, 10);
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO users (username, password, nickname, role) VALUES (?,?,?,?)"
      )
      .run(username, hash, nick, role === "admin" ? "admin" : "user");
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
      "INSERT INTO users (username, password, nickname, role) VALUES (?,?,?,'admin')"
    )
    .run(username, hash, "管理员");
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
