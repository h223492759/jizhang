# Jizhang NAS · 自建记账本

基于开源项目 dingdangdog/cashbook 按需修改而来，本地已重命名为 jizhang，原项目地址：https://github.com/dingdangdog/cashbook

单容器 + SQLite 的个人/家庭记账应用，专为**飞牛 NAS（fnOS）**部署设计。
一个 `docker compose up` 就跑起来，不需要额外的数据库容器。

本人不会代码，全部由我提需求发现bug，workbuddy提交代码并发布
---

## 功能一览

| 模块 | 说明 |
|---|---|
| 记账流水 | 收支记录增删改查、按日期/分类/关键词/金额区间筛选、分页 |
| 多账本 | 家庭账本、个人账本随意切换 |
| 共享账本 | 邀请其他用户加入账本，**新建流水自动归属到创建人** |
| 分类管理 | 收入/支出分类自定义，内置一套默认分类 |
| 消费日历 | 月度日历看板，每天收支一目了然，点击某天看当天明细 |
| 统计图表 | 支出分类饼图、支付方式饼图、每日流水曲线、每月收支柱状图 |
| 预算管理 | 年度总预算 + 分类预算，进度条 + 超支提醒 |
| 账单导入 | 支付宝 / 微信 CSV 账单一键导入（自动识别 GBK 编码、自动跳过「不计收支」） |
| 数据导出 | 全量流水导出 CSV，随时备份/迁移 |
| AI 记账 | 一句话记账（「打车回家花了28块」→ 自动成交通支出 28 元）+ 月度消费分析 |
| **常用名称** | 预设常用消费名称，记账时点标签直接填；系统还会自动统计**高频**和**最近**用过的名称供点选，并带出对应分类/支付方式/金额 |
| **用户管理** | **默认关闭自助注册**，管理员在后台新增账号、改昵称、重置密码、调整角色、删除用户 |
| 多用户 | JWT 鉴权、用户间数据隔离；昵称改名后**历史账单归属自动同步** |
| 界面 | 明暗主题、移动端适配、**涨红跌绿**符合国内习惯（支出红 / 收入绿） |

> **AI 是可选的**：不配任何 API 也能用——一句话记账会走内置规则解析，月度分析走本地统计。

---

## 技术栈

- 后端：Node 22 + Express 4 + better-sqlite3（SQLite，单文件数据库）
- 前端：Vue 3 + Vite + Vue Router + ECharts
- 部署：单容器多阶段构建，支持 `linux/amd64` 与 `linux/arm64`

---

## 一、部署到飞牛 NAS（推荐：拉预编译镜像，无需在 NAS 编译）

镜像由 GitHub Actions 自动构建并发布到 GitHub 容器仓库 **GHCR**：
`ghcr.io/h223492759/jizhang:latest`（多架构 amd64 / arm64，已设为公开）。
你在飞牛上只要拉这个现成镜像跑起来，**不需要在 NAS 上装依赖、编译 SQLite**，比原项目还简单（单容器，连数据库容器都不要）。

### 第 1 步：配置镜像源（关键，否则拉不下来）

你的 NAS 直连 docker.io / ghcr.io 会超时，必须走镜像源。飞牛 Docker 设置 → 镜像源，只保留：

- `https://docker.1panel.dev`（推荐，同时代理 docker.io 与 ghcr.io）
- 备选：`https://hub-mirror.c.163.com`

> ⚠️ 不要加这些失效源：`docker.xuanyuan.me`(429 限流)、`docker.fnnas.com`(401 需登飞牛账号)、个人阿里云加速器如 `x87oljr6.mirror.aliyuncs.com`(403)。
> 改完镜像源后**务必重启 Docker 守护进程 / 重启 NAS** 才生效。

### 第 2 步：准备两个文件

在 NAS 上建一个目录（例如 `/vol1/1000/docker/jizhang`），放进去：

- `docker-compose.yml`（仓库里已写好，直接拉 `ghcr.io/h223492759/jizhang:latest`）
- `.env`（复制 `.env.example` 改名，至少改 `JWT_SECRET` 和 `ADMIN_PASSWORD`）

```ini
JWT_SECRET=用 openssl rand -hex 32 生成的随机串
ADMIN_USERNAME=你的管理员账号
ADMIN_PASSWORD=你的强密码
```

> 不用传 `Dockerfile`、`server/`、`web/` 这些——镜像是现成的，只要 compose + .env。

### 第 3 步：启动

**方式 A —— 终端（最快）**

```bash
cd /vol1/1000/docker/jizhang
docker compose up -d
```

飞牛会去 GHCR 拉镜像，几十秒到一两分钟，之后启动都是秒级。

**方式 B —— 飞牛图形界面**

1. 打开飞牛「**Docker**」应用 → 左侧「**Compose**」
2. 点「**新增项目**」
3. 项目名填 `jizhang`
4. 路径选到上面的目录（里面要有 `docker-compose.yml` 和 `.env`）
5. 确认内容 → 点「**部署**」→ 等状态 `running`

> 因为是拉镜像（不是本地构建），路径目录里**不需要 Dockerfile**，只要 `docker-compose.yml` + `.env` 即可。

### 第 4 步：访问

浏览器打开：

```
http://你的NAS内网IP:9600
```

用 `.env` 里设的管理员账号登录即可。手机浏览器直接访问同一地址，界面自动适配。

---

## 二、常用运维命令

```bash
cd /vol1/1000/docker/jizhang-nas

docker compose logs -f          # 看实时日志
docker compose restart          # 重启
docker compose down             # 停止并删除容器（数据不丢，在 ./data 里）
docker compose pull && docker compose up -d   # 拉取最新镜像并更新
docker compose ps               # 查看状态（healthy 表示健康检查通过）
```

**健康检查地址**：`http://NAS_IP:9600/api/health`

---

## 三、数据与备份

所有数据只有一个 SQLite 文件，位置在宿主机：

```
jizhang-nas/data/jizhang.db
```

**备份**：停容器后直接复制整个 `data` 目录即可（含 `.db-wal`、`.db-shm`）。

```bash
docker compose stop
cp -r data ~/jizhang-backup-$(date +%Y%m%d)
docker compose start
```

**迁移**：把 `data` 目录拷到新机器同样位置，起容器就恢复了。

> 也可以在网页「导入导出」页导出 CSV 做二次备份，更通用。

---

## 四、环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `9600` | 容器内监听端口，一般不用改 |
| `TZ` | `Asia/Shanghai` | 时区，影响记账日期 |
| `DATA_DIR` | `/app/data` | 数据目录，对应挂载卷 |
| `JWT_SECRET` | — | **必改**，登录令牌签名密钥 |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的管理员账号 |
| `ADMIN_PASSWORD` | `admin123` | **必改**，管理员密码 |
| `ALLOW_REGISTER` | `false` | 是否开放自助注册。默认关闭，账号由管理员在「用户管理」页创建 |
| `AI_BASE_URL` | 空 | AI 接口地址，留空则关闭 AI（走规则兜底） |
| `AI_API_KEY` | 空 | AI 密钥，Ollama 可留空 |
| `AI_MODEL` | `gpt-4o-mini` | 模型名 |

### AI 配置示例

```ini
# DeepSeek（便宜好用）
AI_BASE_URL=https://api.deepseek.com/v1
AI_API_KEY=sk-xxxxxxxx
AI_MODEL=deepseek-chat

# NAS 上自己跑的 Ollama（完全离线、免费）
AI_BASE_URL=http://192.168.1.100:11434/v1
AI_API_KEY=
AI_MODEL=qwen2.5:7b
```

改完执行 `docker compose up -d` 生效。

---

## 五、账号与归属人

### 新增账号（不开放注册）

本项目默认**关闭自助注册**，登录页没有注册入口。给家人开账号：

1. 用管理员账号登录 → 左侧「**用户管理**」
2. 点「**+ 新增用户**」，填用户名、初始密码（≥6 位）、昵称
3. 新用户会自动获得一个属于自己的默认账本和默认分类
4. 如果要一起记同一本账，再去「**账本**」页把他加为共享成员

> 昵称同时用作**账单归属显示名**，因此要求全局唯一。

### 归属人是怎么工作的

流水表里记的是**用户 ID**，页面上显示的名字是实时从用户表读出来的当前昵称。
所以任何人改昵称，他名下的**历史账单归属会立刻跟着变**，不需要手工订正。

### 历史数据修复

如果你是从更早的版本升级上来的，那时归属只存了昵称文本，改名后老账单会卡在旧名字上。
升级后打开「用户管理」页，若存在这种数据会出现一块「**⚠️ 历史归属待认领**」，
选中某个旧名字 → 指定它属于哪个用户 → 点「绑定」，一次性修复，之后再改名就自动同步了。

（「老婆」「爸妈」这类并非系统用户的自由文本，保持不绑定即可，功能不受影响。）

---

## 六、常用名称怎么用

记账最烦的就是反复敲同样的名称。这里有三层：

| 分组 | 来源 | 说明 |
|---|---|---|
| **常用** | 手动预设 | 「常用名称」页添加，可绑定默认分类、支付方式、常用金额 |
| **高频** | 自动统计 | 同一名称在本账本用满 2 次就会出现，按次数排序 |
| **最近** | 自动统计 | 最近用过的名称，按时间倒序 |

在「记一笔」弹窗的名称框下方，这三组会显示成可点击的标签，点一下就填好名称，
并自动带出它上次用的分类和支付方式（不会覆盖你已经填过的内容）。

名称框右上角的「☆ 设为常用」可以把当前名称一键收藏；
在「常用名称」页点高频/最近标签上的 ☆ 也能收藏。

---

## 七、账单导入怎么用

1. **支付宝**：App → 我的 → 账单 → 右上角「…」→ 开具交易流水证明 → 用于个人对账 → 收邮件下载 CSV
2. **微信**：App → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账 → 收邮件下载（压缩包，解压出 CSV）
3. 网页进「导入导出」→ 选择文件 → **先预览**确认解析结果 → 确认导入

解析器已处理：GBK 编码、文件头部说明行、表头自动定位、「不计收支」行自动跳过、支付宝/微信格式自动识别。

**其它记账软件（通用 CSV）**：在「导入导出」页把来源选成「**通用 CSV（自定义列）**」即可导入任意软件的账单。系统会按列名自动识别时间/金额/收支/分类/账户/备注，识别不准时在下方「列映射」面板手动把每一列对应到系统字段即可。支持：方向列（收/支/方向/类型）、金额正负号判断支出收入、以及「收入」「支出」分列的金额格式；分隔符自动识别（逗号/制表符/分号）。

---

## 六、本地开发（Windows / Mac）

```bash
# 后端
npm install
npm run dev          # http://localhost:9600

# 前端（另开一个终端）
cd web
npm install
npm run dev          # http://localhost:5173，已配置代理到后端
```

前端构建产物 `web/dist` 会被后端自动作为静态资源托管，生产环境只需跑后端一个进程。

---

## 七、常见问题

**Q：端口 9600 被占用？**
改 `docker-compose.yml` 里 `ports` 冒号左边的数字，比如 `"9700:9600"`，然后访问 9700。

**Q：拉镜像报 `context deadline exceeded` / `403` / `401`？**
说明镜像源没配对。现在拉的是 GHCR 镜像，同样需要镜像源代理 ghcr.io。确保飞牛镜像源只保留 `https://docker.1panel.dev`（它同时代理 docker.io 与 ghcr.io），删掉 `xuanyuan.me`(429) / `docker.fnnas.com`(401) / 个人阿里云加速器(403) 这些失效源，并**重启 Docker / NAS** 后重试。

**Q：想更新到最新版？**
`docker compose pull && docker compose up -d` 即可拉新镜像重启（数据在 `./data` 不受影响）。镜像由 GitHub Actions 在每次推送到 `main` 时自动重新构建发布。

**Q：我想自己改代码后重新构建镜像？**
方式一：把改动推到 GitHub `main` 分支，Actions 会自动构建并覆盖 `ghcr.io/h223492759/jizhang:latest`。
方式二（纯本地）：保留 `Dockerfile`，在目录内 `docker compose up -d --build`；此时需要 NAS 能拉到 `node:22-bookworm-slim` 基础镜像（走镜像源），且编译 SQLite 需要一点时间和内存。

**Q：忘记管理员密码？**
停容器 → 删掉 `data/jizhang.db` 会连数据一起没（慎用）。更稳妥的做法是在 `.env` 里改 `ADMIN_USERNAME` 为一个新名字重启，会创建一个新管理员账号，登录后再处理旧账号。

**Q：想让外网访问？**
用飞牛自带的内网穿透 / 反向代理，把 `9600` 端口映射出去，并**务必**先把 `ALLOW_REGISTER` 改成 `false`、密码设强一点。

---

## 目录结构

```
jizhang-nas/
├── Dockerfile              # 多阶段构建：前端打包 → 后端依赖 → 精简运行镜像
├── docker-compose.yml      # 飞牛一键部署
├── .env.example            # 环境变量模板
├── package.json
├── server/                 # 后端
│   ├── index.js            # 入口：API 路由 + 静态前端托管
│   ├── db.js               # SQLite 建表、默认分类、管理员初始化
│   ├── mw.js               # JWT 鉴权、账本权限中间件
│   ├── lib/
│   │   ├── csv.js          # 支付宝/微信 CSV 解析
│   │   └── ai.js           # AI 调用 + 规则兜底解析
│   └── routes/             # auth / books / categories / flows / stats / budgets / importer / ai
├── web/                    # 前端 Vue3
│   └── src/
│       ├── views/          # 登录/仪表盘/流水/统计/预算/账本/分类/导入/AI/设置
│       └── components/     # 布局、流水弹窗、ECharts 封装
└── data/                   # SQLite 数据（挂载卷，勿删）
```
