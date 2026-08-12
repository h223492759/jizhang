import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 版本号优先级：环境变量 APP_VERSION > 镜像构建时写入的 /app/VERSION > dev
export function resolveVersion() {
  if (process.env.APP_VERSION && process.env.APP_VERSION.trim()) {
    return process.env.APP_VERSION.trim();
  }
  try {
    const v = fs
      .readFileSync(path.join(__dirname, "..", "VERSION"), "utf8")
      .trim();
    if (v) return v;
  } catch {
    /* 文件不存在则走兜底 */
  }
  return "dev";
}

export const APP_VERSION = resolveVersion();
