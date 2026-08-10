import dayjs from "dayjs";

// 读取 AI 配置：兼容任何 OpenAI 风格接口（OpenAI / DeepSeek / 通义 / 本地 Ollama、LocalAI 等）
export function aiConfig() {
  return {
    baseUrl: (process.env.AI_BASE_URL || "").replace(/\/$/, ""),
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    enabled: !!process.env.AI_BASE_URL, // 只要配了地址就算开启（Ollama 可无 key）
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

// ---------------- 一句话记账 ----------------
// 优先用 LLM，失败/未配置时用规则解析兜底
export async function parseFlowText(text, categories) {
  const names = categories.map((c) => c.name);
  try {
    const sys = `你是记账助手。把用户的自然语言转成JSON：{"type":"expense或income","amount":数字,"category":"分类","description":"简述","payment_method":"支付方式或空"}。
分类只能从这些里选最接近的一个：${names.join("、")}。
默认为支出(expense)，收到/工资/红包/报销等为收入(income)。只输出JSON。`;
    const content = await chat(
      [
        { role: "system", content: sys },
        { role: "user", content: text },
      ],
      { json: true }
    );
    const obj = JSON.parse(content);
    return normalize(obj, names, "ai");
  } catch (e) {
    if (e.message !== "NO_AI") console.warn("[ai] 解析回退规则:", e.message);
    return ruleParse(text, names);
  }
}

function normalize(obj, names, source) {
  const category =
    names.find((n) => n === obj.category) ||
    names.find((n) => obj.category && n.includes(obj.category)) ||
    (obj.type === "income" ? "其他收入" : "其他");
  return {
    type: obj.type === "income" ? "income" : "expense",
    amount: Math.abs(Number(obj.amount)) || 0,
    category,
    description: obj.description || "",
    payment_method: obj.payment_method || "",
    flow_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    source,
  };
}

// 规则兜底：抽取金额 + 关键词猜分类
function ruleParse(text, names) {
  const m = text.match(/(\d+(\.\d+)?)/);
  const amount = m ? Number(m[1]) : 0;
  const incomeKw = ["工资", "收入", "报销", "红包", "收到", "退款", "奖金", "利息", "分红"];
  const type = incomeKw.some((k) => text.includes(k)) ? "income" : "expense";

  const kwMap = {
    餐饮: ["吃", "饭", "早餐", "午餐", "晚餐", "外卖", "餐", "咖啡", "奶茶", "零食"],
    交通: ["地铁", "公交", "打车", "滴滴", "高铁", "火车", "机票", "油", "停车", "加油"],
    购物: ["买", "衣服", "淘宝", "京东", "购物", "鞋"],
    居住: ["房租", "水电", "物业", "燃气"],
    娱乐: ["电影", "游戏", "唱歌", "娱乐", "旅游"],
    医疗: ["药", "医院", "看病", "挂号"],
    通讯: ["话费", "流量", "宽带"],
    工资: ["工资", "薪水"],
    红包: ["红包"],
  };
  let category = type === "income" ? "其他收入" : "其他";
  for (const [cat, kws] of Object.entries(kwMap)) {
    if (names.includes(cat) && kws.some((k) => text.includes(k))) {
      category = cat;
      break;
    }
  }
  return {
    type,
    amount,
    category,
    description: text.replace(/(\d+(\.\d+)?)(元|块|块钱)?/g, "").trim(),
    payment_method: "",
    flow_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
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
