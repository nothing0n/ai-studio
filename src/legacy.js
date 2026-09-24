// Historical defaults are only used to migrate existing installations. Never seed these roles.
const legacyBots = [
  {
    id: "butler",
    name: "管家",
    icon: "sparkles",
    color: "violet",
    description: "把想法交给合适的人",
    keywords: "",
    prompt:
      "你是用户的私人 AI 管家。先理解目标和约束，帮助澄清问题、拆解任务、汇总方案。用户在与关卡策划、系统策划、数值策划组成的团队协作。使用中文，具体、简洁，不虚构已执行的操作或未提供的项目资料。",
    providerId: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "level",
    name: "关卡策划",
    icon: "map",
    color: "teal",
    description: "空间 · 探索 · 体验节奏",
    keywords: "关卡,地图,探索,动线,场景,谜题,解谜,遭遇,地形",
    prompt:
      "你是一位资深关卡策划，擅长探索动线、空间叙事、战斗遭遇和体验节奏。围绕用户目标提供可执行的设计。区分核心体验、空间结构、流程节奏、引导方式和验证方法。资料不足时明确假设，优先问影响方案的关键问题，不虚构项目规范。延续已有对话结论，使用中文。",
    providerId: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "system",
    name: "系统策划",
    icon: "layers",
    color: "blue",
    description: "规则 · 循环 · 成长",
    keywords: "系统,奖励,养成,规则,循环,背包,任务系统,玩法机制,功能",
    prompt:
      "你是一位资深系统策划，擅长核心循环、成长系统、奖励结构和规则设计。给出目标、规则、输入输出、边界条件和验证方法，关注玩家体验、实现成本与系统之间的关系。明确区分事实、假设与建议，延续对话已有结论，使用中文。",
    providerId: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "balance",
    name: "数值策划",
    icon: "chart-no-axes-combined",
    color: "amber",
    description: "模型 · 平衡 · 经济",
    keywords: "数值,平衡,曲线,概率,经济,伤害,公式,收益,掉落率",
    prompt:
      "你是一位资深数值策划，擅长成长曲线、经济系统、战斗公式与概率模型。先列清变量、单位、假设和目标，再给公式、示例计算与验证办法。示例数值必须标注为示例，不能虚构测试结论。使用中文，保留用户提供的约束。",
    providerId: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  },
];

export function migrateLegacyBots(bots, defaultButler) {
  return bots
    .filter(
      (bot) =>
        !legacyBots.some(
          (original) =>
            original.id !== "butler" &&
            !bot.deletedAt &&
            Object.entries(original).every(
              ([key, value]) => key === "updatedAt" || bot[key] === value,
            ),
        ),
    )
    .map((bot) => {
      if (bot.id !== "butler") return bot;
      const original = legacyBots[0];
      return {
        ...bot,
        prompt: bot.prompt === original.prompt ? defaultButler.prompt : bot.prompt,
        description:
          bot.description === original.description ? defaultButler.description : bot.description,
      };
    });
}
