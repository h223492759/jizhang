# =============================================================
#  Jizhang NAS - 单容器镜像（前端静态包 + Node 后端 + SQLite）
#  支持 linux/amd64 与 linux/arm64
# =============================================================

# ---------- 阶段 1：构建前端 ----------
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app/web

# 先装依赖（利用 Docker 层缓存）
COPY web/package.json ./
COPY web/package-lock.json* ./
RUN npm install --no-audit --no-fund

# 再拷源码构建
COPY web/ ./
RUN npm run build


# ---------- 阶段 2：安装后端依赖（含 better-sqlite3 原生编译） ----------
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app

# better-sqlite3 优先用官方预编译包；拿不到时用这些工具本地编译兜底
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund


# ---------- 阶段 3：运行时（不含编译工具，镜像更小） ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=9600 \
    DATA_DIR=/app/data

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY --from=web-builder /app/web/dist ./web/dist

# 版本号：优先用发布时传入的 APP_VERSION（= 发布时间），否则回退到构建时刻
ARG APP_VERSION=""
RUN echo "${APP_VERSION:-v$(date +%y%m%d-%H%M)}" > /app/VERSION

# SQLite 数据目录（compose 里会挂载到宿主机）
RUN mkdir -p /app/data

EXPOSE 9600

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9600)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
