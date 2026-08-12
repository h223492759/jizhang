import { Router } from "express";
import { auth, requireAdmin, wrap } from "../mw.js";
import { getSetting, setSetting } from "../db.js";
import { aiConfig } from "../lib/ai.js";

const r = Router();
r.use(auth);

// 读取当前 AI 记账配置（apiKey 脱敏，避免明文暴露在接口里）
r.get("/ai", (req, res) => {
  const stored = getSetting("ai_config", "");
  let cfg = {};
  if (stored) {
    try { cfg = JSON.parse(stored); } catch { cfg = {}; }
  }
  const live = aiConfig(); // 合并环境变量后的「实际生效」配置
  res.json({
    provider: cfg.provider || "",
    baseUrl: cfg.baseUrl || live.baseUrl || "",
    apiKey: cfg.apiKey ? "******" : "",
    apiKeySet: !!cfg.apiKey,
    model: cfg.model || live.model || "",
    imageModel: cfg.imageModel || live.imageModel || "",
    enabled: live.enabled,
  });
});

// 保存 AI 记账配置（仅管理员可写）
r.put(
  "/ai",
  requireAdmin,
  wrap((req, res) => {
    const b = req.body || {};
    const cur = getSetting("ai_config", "");
    let curObj = {};
    if (cur) {
      try { curObj = JSON.parse(cur); } catch { curObj = {}; }
    }

    const provider = (b.provider || "").trim();
    const baseUrl = (b.baseUrl || "").trim().replace(/\/$/, "");
    // 前端回填的占位符「******」表示不想改 key，保留原值
    let apiKey = (b.apiKey || "").trim();
    if (apiKey === "******") apiKey = curObj.apiKey || "";
    const model = (b.model || "").trim();
    const imageModel = (b.imageModel || "").trim();

    const next = { provider, baseUrl, apiKey, model, imageModel };
    setSetting("ai_config", JSON.stringify(next));
    res.json({ ok: true });
  })
);

export default r;
