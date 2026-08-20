import dayjs from "dayjs";
import { getSetting } from "../db.js";

// 读取已保存的模型列表（兼容旧版单配置）
function readModels() {
  const raw = getSetting("ai_models", "");
  if (!raw) {
    const legacy = getSetting("ai_config", "");
    if (legacy) {
      try {
        const c = JSON.parse(legacy);
        return [
          {
            provider: c.provider || "",
            baseUrl: c.baseUrl || "",
            apiKey: c.apiKey || "",
            model: c.model || "",
            imageModel: c.imageModel || "",
            isDefault: true,
          },
        ];
      } catch {}
    }
    return [];
  }
  try {
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

// 读取 AI 配置：支持配置「多个模型」，取标记为默认（isDefault）的那个；
// 若没有标记则取第一个。DB 值优先于环境变量。
// 兼容任何 OpenAI 风格接口（OpenAI / 智谱 / DeepSeek / 通义 / 本地 Ollama、LocalAI 等）
export function aiConfig() {
  const models = readModels();
  const def = models.find((m) => m.isDefault) || models[0] || {};
  const baseUrl = (def.baseUrl || process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const apiKey = def.apiKey || process.env.AI_API_KEY || "";
  const model = def.model || process.env.AI_MODEL || "gpt-4o-mini";
  const imageModel = def.imageModel || def.model || process.env.AI_IMAGE_MODEL || model;
  const enabled = !!baseUrl; // 只要配了地址就算开启（部分本地服务可无 key）
  return {
    baseUrl,
    apiKey,
    model,
    imageModel,
    enabled,
    provider: def.provider || "",
    name: def.name || "",
  };
}

async function chat(messages, { json = false } = {}) {
  const cfg = aiConfig();
  if (!cfg.enabled) throw new Error("NO_AI");
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.2,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`AI接口错误 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// 视觉（图片）对话：用于小票/账单截图识别，使用「图片/视觉模型」
async function chatVision(contentParts, { json = false } = {}) {
  const cfg = aiConfig();
  if (!cfg.enabled) throw new Error("NO_AI");
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.imageModel || cfg.model,
      messages: [{ role: "user", content: contentParts }],
      temperature: 0.2,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`AI接口错误 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ---------------- 图片记账（小票/账单截图识别） ----------------
// 用视觉模型把图片 + 可选文字说明识别成一笔记账
export async function parseFlowImage(imageB64, text, categories) {
  const names = categories.map((c) => c.name);
  const note = text && text.trim() ? `用户补充说明：${text.trim()}。` : "";
  const sys = `你是记账助手。根据用户上传的账单/小票图片${note}识别成一笔记账JSON：{"type":"expense或income","amount":数字,"category":"分类","description":"简述","payment_method":"支付方式或空"}。
分类只能从这些里选最接近的一个：${names.join("、")}。
${DISAMBIGUATION}
默认为支出(expense)，收到/工资/红包/报销等为收入(income)。只输出JSON，不要任何解释。`;
  const url = imageB64.startsWith("data:") ? imageB64 : `data:image/jpeg;base64,${imageB64}`;
  try {
    const content = await chatVision(
      [
        { type: "text", text: sys },
        { type: "image_url", image_url: { url } },
      ],
      { json: true }
    );
    const obj = JSON.parse(content);
    const explicit = explicitCategory(text || "", names);
    return normalize(obj, names, "ai", text || "", explicit);
  } catch (e) {
    if (e.message !== "NO_AI") console.warn("[ai] 图片解析失败:", e.message);
    throw e;
  }
}

// ---------------- 一句话记账 ----------------
// 易混分类提醒：写进 prompt，让大模型少分错
const DISAMBIGUATION =
  "易混提醒：买菜/食材/生鲜/蔬菜/做饭材料 属于「餐饮」而不是「购物」；" +
  "「购物」指衣服鞋包、日用百货、数码家电、家居等非食材实物商品；" +
  "水果单独记「水果」，零食单独记「零食」，烟酒单独记「烟酒」，住房指房租/物业/水电。";

// 本地高置信规则分类：命中则直接返回，跳过模型调用（更快、且避免大模型把「买菜」分到「购物」）
const RULE_INCOME = [
  { cat: "工资", kw: ["工资", "薪水", "月薪", "发工资", "工资到账", "薪资", "薪酬"] },
  { cat: "兼职", kw: ["兼职", "外快", "接单", "私活", "副业", "赚外快"] },
  { cat: "理财", kw: ["理财", "基金", "股票", "利息", "股息", "收益", "余额宝", "投资", "分红", "打新"] },
  { cat: "礼金", kw: ["红包", "收到红包", "领红包"] },
  { cat: "报销", kw: ["报销", "报销款", "报销到账"] },
  { cat: "退款", kw: ["退款", "退货退款", "交易退款"] },
];
const RULE_EXPENSE = [
  { cat: "餐饮", kw: ["吃饭", "饭", "餐", "早餐", "早饭", "午餐", "午饭", "晚餐", "晚饭", "夜宵", "外卖", "食堂", "餐厅", "饭店", "饭馆", "火锅", "烧烤", "麻辣烫", "面条", "米粉", "粥", "包子", "饺子", "馄饨", "寿司", "炒菜", "买菜", "食材", "生鲜", "蔬菜", "青菜", "肉", "鸡蛋", "牛奶", "做饭", "下厨", "煮", "炖", "厨房", "宴", "聚餐", "请客吃饭", "酒席", "自助餐", "咖啡", "奶茶", "饮料", "果汁", "小吃", "夜市", "菜场", "菜市场"] },
  { cat: "水果", kw: ["水果", "苹果", "香蕉", "橙子", "桔子", "葡萄", "西瓜", "草莓", "芒果", "桃子", "菠萝", "车厘子", "榴莲", "梨", "猕猴桃"] },
  { cat: "零食", kw: ["零食", "薯片", "饼干", "巧克力", "糖果", "瓜子", "坚果", "辣条", "膨化", "妙脆角"] },
  { cat: "烟酒", kw: ["烟", "香烟", "烟盒", "酒", "啤酒", "白酒", "红酒", "洋酒", "黄酒", "鸡尾酒"] },
  { cat: "交通", kw: ["地铁", "公交", "公共汽车", "打车", "滴滴", "出租", "网约车", "高铁", "火车", "动车", "加油", "油费", "停车", "停车费", "过路费", "etc", "骑行", "单车", "摩的"] },
  { cat: "日用", kw: ["日用品", "纸巾", "卫生纸", "洗发", "沐浴", "牙膏", "牙刷", "洗衣", "洗洁精", "清洁", "厨卫", "杂物", "垃圾袋"] },
  { cat: "服饰", kw: ["衣服", "服装", "上衣", "裤子", "裙子", "鞋子", "鞋", "包", "背包", "帽子", "围巾", "袜子", "内衣"] },
  { cat: "美容", kw: ["美容", "化妆", "护肤品", "护肤", "美甲", "美发", "理发", "烫发", "染发", "spa", "按摩", "香水"] },
  { cat: "住房", kw: ["房租", "房贷", "物业", "水电", "燃气", "暖气", "装修", "网费", "物业费"] },
  { cat: "医疗", kw: ["药", "药品", "医院", "看病", "挂号", "体检", "牙", "诊所", "医保", "买药", "门诊"] },
  { cat: "孩子", kw: ["宝宝", "娃", "幼儿园", "母婴", "尿布", "尿不湿", "奶粉", "童装", "早教"] },
  { cat: "数码", kw: ["手机", "电脑", "相机", "耳机", "平板", "键盘", "鼠标", "充电", "显示器", "路由器"] },
  { cat: "居家", kw: ["家具", "家电", "家居", "寝具", "灯具", "收纳", "床", "沙发", "窗帘"] },
  { cat: "学习", kw: ["学习", "课程", "培训", "网课", "考试", "学费", "资料费", "补习"] },
  { cat: "书籍", kw: ["书", "书籍", "小说", "课本", "教材", "杂志"] },
  { cat: "运动", kw: ["健身", "跑步", "瑜伽", "球", "游泳", "运动", "场馆", "装备", "羽毛球", "篮球"] },
  { cat: "娱乐", kw: ["电影", "游戏", "唱歌", "ktv", "娱乐", "演出", "门票", "游乐", "密室", "桌游", "展览"] },
  { cat: "通讯", kw: ["话费", "电话费", "流量", "电话"] },
  { cat: "旅行", kw: ["旅游", "旅行", "出游", "景点", "酒店", "机票", "火车票"] },
  { cat: "宠物", kw: ["宠物", "猫", "狗", "猫粮", "狗粮", "兽医", "宠物医院"] },
  { cat: "社交", kw: ["朋友", "聚会", "社交", "饭局"] },
  { cat: "长辈", kw: ["父母", "爸妈", "爷爷", "奶奶", "外公", "外婆", "长辈", "养老", "孝敬"] },
  { cat: "礼金", kw: ["随礼", "份子", "礼金", "出份子", "贺礼"] },
  { cat: "人情", kw: ["人情", "人情往来"] },
  { cat: "亲友", kw: ["亲戚", "亲友"] },
  { cat: "礼物", kw: ["礼物", "送礼", "礼品", "生日礼物", "伴手礼"] },
  { cat: "备婚", kw: ["婚礼", "备婚", "婚庆", "婚纱", "钻戒", "结婚"] },
  { cat: "办公", kw: ["办公", "文具", "打印", "耗材", "办公用品"] },
  { cat: "彩票", kw: ["彩票", "刮刮乐", "双色球", "大乐透"] },
  { cat: "保险", kw: ["保险", "保费", "车险", "寿险", "医疗险", "意外险"] },
  { cat: "汽车", kw: ["洗车", "保养", "年检", "汽车维修", "车船税", "修车"] },
  { cat: "快递", kw: ["快递", "运费", "邮费", "寄件"] },
  { cat: "捐赠", kw: ["捐赠", "捐款", "公益", "慈善", "施舍"] },
];

// 金额抽取：优先级
//   1) ¥/￥ 符号后的数字
//   2) X元 / X块 / X块钱
//   3) 金额动词后的数字（工资/到账/实付/支付/付款/花费/花了/消费/扣款/缴费/充值/买了/交了）
//   4) 兜底第一个数字
// 修复"8月15号工资到账12000"被取成 8 的问题（日期数字被误当金额）
function extractAmount(text) {
  const t = String(text);
  const sym = t.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
  if (sym) return Number(sym[1]);
  const yuan = t.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块|元整|毛|角)/);
  if (yuan) return Number(yuan[1]);
  const kw = t.match(
    /(?:工资|薪资|到账|实付|实际支付|支付|付款|花费|花了|消费|扣款|支出|买了|缴费|充值|交了)\s*(?:了)?\s*(\d+(?:\.\d{1,2})?)/
  );
  if (kw) return Number(kw[1]);
  const first = t.match(/(\d+(?:\.\d{1,2})?)/);
  return first ? Number(first[1]) : 0;
}

function ruleClassify(text, names) {
  const t = String(text).toLowerCase();
  const amount = extractAmount(text);
  // description 用规则化提取（消费名），避免返回分类名（如「午饭 35」→ description=午饭 而非 餐饮）
  const desc = extractDescription(text);
  for (const r of RULE_INCOME) {
    if (r.kw.some((k) => t.includes(k.toLowerCase())) && names.includes(r.cat))
      return { type: "income", amount, category: r.cat, description: desc, source: "rule" };
  }
  for (const r of RULE_EXPENSE) {
    if (r.kw.some((k) => t.includes(k.toLowerCase())) && names.includes(r.cat))
      return { type: "expense", amount, category: r.cat, description: desc, source: "rule" };
  }
  return null;
}

// 显式指定分类：用户明确说了「到数码 / 记到餐饮 / 分到办公 / 归到数码」等，
// 应优先采用，不被关键词或大模型推断覆盖（如「买打印机到数码」应归数码而非办公）。
// 兜底分类「其他 / 其它」不参与显式识别，避免误命中（如「到其他人」）。
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function explicitCategory(text, names) {
  const t = String(text);
  const markers = [
    "记到", "分到", "归到", "划到", "记在", "到", "属于", "归入", "归类为",
    "类别为", "分类为", "类别是", "分类是", "类是", "分类", "类别", "归为",
  ];
  const sorted = [...markers].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (name === "其他" || name === "其它") continue;
    for (const m of sorted) {
      const re = new RegExp(escapeRe(m) + "\\s*了?\\s*" + escapeRe(name));
      if (re.test(t)) return name;
    }
    if (new RegExp(escapeRe(name) + "类").test(t)) return name;
  }
  return null;
}

// 高置信纠正：即便大模型分错也强制归位（如「超市买菜」必须是餐饮）
function forceCorrect(rawText, obj) {
  if (/(买菜|食材|生鲜|蔬|菜场|菜市场|做饭材料|下厨材料)/.test(rawText) && obj.type !== "income") {
    obj.category = "餐饮";
  }
  return obj;
}

// 规则化 description 提取：去掉数字/¥/单位/动词/日期，保留消费名词和地点/助词
// 示例：
//   "午饭花了38元"               → "午饭"
//   "滴滴打车22.5，从公司回家"   → "滴滴打车从公司回家"
//   "打车回家花了28块"           → "打车回家"（单位"块"也去掉）
//   "8月15号工资到账12000"       → "工资"
//   "这个月奶茶花了多少"         → "奶茶"（问句走 query 模式时类目用）
function extractDescription(text) {
  let t = String(text).trim();
  t = t.replace(/^\s*(\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)\s*/, "");
  t = t.replace(/^\s*(昨天|今天|前天|这个月|上个月|本月|上月)\s*/, "");
  t = t.replace(/\d+(?:\.\d+)?/g, "");
  t = t.replace(/[¥￥]/g, "");
  // 去掉动词短语（保留"从/到/的"等助词，描述里有意义，如"从公司回家"）
  t = t.replace(
    /(花了|到账|支付了?|付款了?|买了|交了|缴费了?|充值了?|消费了?|打了)/g,
    " "
  );
  // 去掉单位字：紧跟数字的"块/元/块钱/角/毛"残留（yuan 正则提取后"块"还在原位）
  t = t.replace(/(块钱|钱|元整?)/g, "");
  t = t.replace(/[，。,\.!?;:：；！？、]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// 问句检测：含疑问词 → 走查询模式（不记账）
function isQuery(text) {
  return /(多少|几|哪个|哪个了|花了多少|合计|总共|一共|总计)/.test(String(text));
}

function buildResult({ type, amount, category, description = "", payment_method = "", source, kind = null }) {
  return {
    type: type === "income" ? "income" : "expense",
    amount: Math.abs(Number(amount)) || 0,
    category,
    description: description || category,
    payment_method: payment_method || "",
    flow_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    source,
    kind,
  };
}

// 优先用本地规则命中（常见场景直接返回，不调模型，更快更准）；
// 命中不到再交给大模型；模型失败再回退到规则兜底。
// 若用户显式指定了分类（如「到数码」），无论上面哪条路径都强制采用该分类。
export async function parseFlowText(text, categories) {
  const names = categories.map((c) => c.name);
  const catType = (name) => categories.find((c) => c.name === name)?.type;
  const explicit = explicitCategory(text, names);

  // 问句（如「这个月奶茶花了多少」）→ 走查询模式：返回 kind:'query' 给前端调 /flows/query
  if (isQuery(text)) {
    const desc = extractDescription(text);
    const fbCat = desc && names.find((n) => desc.includes(n)) || (names.includes("其他") ? "其他" : names[0] || "");
    return buildResult({
      type: "expense", amount: 0, category: fbCat,
      description: desc || text.trim().slice(0, 20),
      payment_method: "", source: "query", kind: "query",
    });
  }

  // 无金额 → 不是记账（叙述/单个数字被误识别）
  if (extractAmount(text) <= 0) {
    const isIncome = /(工资|薪资|收入|到账|入账|收款|报销|红包|奖金)/.test(text);
    const fallbackCat = isIncome
      ? (names.includes("其它") ? "其它" : names[0] || "其他")
      : (names.includes("其他") ? "其他" : names.find((n) => n !== "其它") || "其他");
    return buildResult({
      type: isIncome ? "income" : "expense",
      amount: 0,
      category: explicit || fallbackCat,
      description: text.trim().slice(0, 30),
      payment_method: "",
      source: "noamount",
    });
  }
  const rule = ruleClassify(text, names);
  if (rule && rule.amount > 0 && !explicit) return buildResult(rule); // 高置信且无显式指定：不调模型
  try {
    const sys = `你是记账助手。把用户的自然语言转成JSON：{"type":"expense或income","amount":数字,"category":"分类","description":"简述","payment_method":"支付方式或空"}。
分类只能从这些里选最接近的一个：${names.join("、")}。
${DISAMBIGUATION}
默认为支出(expense)，收到/工资/红包收入/报销等为收入(income)。只输出JSON。`;
    const content = await chat(
      [
        { role: "system", content: sys },
        { role: "user", content: text },
      ],
      { json: true }
    );
    const obj = JSON.parse(content);
    // description 用规则化提取（去掉金额/动词/日期，保留消费名+地点）
    obj.description = extractDescription(text) || obj.description || "";
    const result = normalize(obj, names, "ai", text, explicit);
    // 显式指定分类时，类型也跟着该分类走（避免「数码」被当成支出/收入的错配）
    if (explicit && catType(explicit)) result.type = catType(explicit);
    return result;
  } catch (e) {
    if (e.message !== "NO_AI") console.warn("[ai] 解析回退规则:", e.message);
    const fb = ruleClassify(text, names) || ruleParse(text, names);
    const result = buildResult({ ...fb, category: explicit || fb.category });
    if (explicit && catType(explicit)) result.type = catType(explicit);
    return result;
  }
}

function normalize(obj, names, source, rawText = "", forceCategory = null) {
  const fixed = forceCorrect(rawText, obj);
  let category = fixed.category;
  // 用户显式指定了分类时，强制采用（不被模型推断覆盖）
  if (forceCategory && names.includes(forceCategory)) category = forceCategory;
  else {
    category =
      names.find((n) => n === fixed.category) ||
      names.find((n) => fixed.category && (n.includes(fixed.category) || String(fixed.category).includes(n))) ||
      (fixed.type === "income" ? "其它" : "其他");
  }
  return buildResult({
    type: fixed.type,
    amount: fixed.amount,
    category,
    description: fixed.description,
    payment_method: fixed.payment_method,
    source,
  });
}

// 规则兜底：抽取金额 + 关键词猜分类（模型不可用时的最后手段）
function ruleParse(text, names) {
  const m = extractAmount(text);
  const amount = m;
  const incomeKw = ["工资", "收入", "报销", "红包", "收到", "退款", "奖金", "利息", "分红", "理财", "兼职"];
  const type = incomeKw.some((k) => text.includes(k)) ? "income" : "expense";
  const category = type === "income"
    ? (names.includes("其它") ? "其它" : names[0] || "其他")
    : (names.includes("其他") ? "其他" : names.find((n) => n !== "其它") || "其他");
  return {
    type,
    amount,
    category,
    description: text.replace(/(\d+(\.\d+)?)(元|块|块钱)?/g, "").trim(),
    payment_method: "",
    source: "rule",
  };
}

// ---------------- 月度账单分析 ----------------
export async function analyzeMonth(summary) {
  const { month, income, expense, balance, topCategories, prevExpense } = summary;
  try {
    const sys = "你是专业的个人理财顾问，用简体中文、亲切口语化的风格，给出简洁而有洞见的月度消费分析和建议，控制在250字内，可用少量emoji，分点。";
    const user = `这是${month}的账单：
总收入 ¥${income.toFixed(2)}，总支出 ¥${expense.toFixed(2)}，结余 ¥${balance.toFixed(2)}。
上月支出 ¥${prevExpense.toFixed(2)}。
支出前几名：${topCategories.map((c) => `${c.name} ¥${c.value.toFixed(2)}`).join("，")}。
请分析消费结构、和上月对比、并给2-3条可执行的省钱建议。`;
    return await chat([
      { role: "system", content: sys },
      { role: "user", content: user },
    ]);
  } catch (e) {
    return ruleAnalyze(summary);
  }
}

function ruleAnalyze(s) {
  const { month, income, expense, balance, topCategories, prevExpense } = s;
  const diff = expense - prevExpense;
  const trend =
    prevExpense === 0
      ? "暂无上月数据可对比。"
      : diff > 0
      ? `比上月多花了 ¥${diff.toFixed(2)}（↑${((diff / prevExpense) * 100).toFixed(1)}%），要留意一下。`
      : `比上月少花了 ¥${Math.abs(diff).toFixed(2)}（↓${((Math.abs(diff) / prevExpense) * 100).toFixed(1)}%），做得不错！`;
  const top = topCategories[0];
  const lines = [
    `📊 ${month} 账单小结`,
    `· 收入 ¥${income.toFixed(2)}，支出 ¥${expense.toFixed(2)}，结余 ¥${balance.toFixed(2)}。`,
    `· ${trend}`,
    top ? `· 最大开销是「${top.name}」，共 ¥${top.value.toFixed(2)}，占支出 ${expense ? ((top.value / expense) * 100).toFixed(0) : 0}%。` : "· 本月暂无支出记录。",
    balance < 0 ? "· ⚠️ 本月入不敷出，建议检查非必要开支。" : "· 👍 本月有结余，继续保持。",
    "（未配置 AI 服务，以上为本地规则分析。配置 AI_BASE_URL 后可获得更智能的建议。）",
  ];
  return lines.join("\n");
}
