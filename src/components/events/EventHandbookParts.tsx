// =====================
// 赛事手册的展示零件（2026-10-19 从 `EventHandbook.tsx` 抽出）
//
// 只搬家不改逻辑：阶段类型文案表、规则分组数据、`Section` 与 `RuleGroup` 两个展示组件，
// 原文件逐字搬过来，函数体一行没动。主文件 413 → 265 行，回到架构守卫的硬线以下。
// =====================
import { type ReactNode } from "react";
import type { HandbookEvent } from "@/components/events/EventHandbook";

type Rule = NonNullable<HandbookEvent["rulesList"]>[number];
type RuleCategory = NonNullable<Rule["category"]>;

export const STAGE_TYPE_LABELS: Record<string, string> = {
  "single-elim": "单败淘汰",
  "single-elim-groups": "组内单败",
  "gsl-groups": "GSL 双败小组",
  "double-elim": "双败淘汰",
  "round-robin": "循环赛",
  "swiss": "瑞士轮",
};

export const RULE_GROUPS = [
  {
    category: "conduct" as const,
    index: "04.1",
    eyebrow: "COMPETITION CONDUCT",
    title: "竞赛纪律",
    description: "参赛资格、名单管理与竞技行为规范",
  },
  {
    category: "incident" as const,
    index: "04.2",
    eyebrow: "MATCH OPERATIONS",
    title: "赛务与技术异常",
    description: "技术暂停、迟到弃赛及现场异常处置",
  },
  {
    category: "appeal" as const,
    index: "04.3",
    eyebrow: "RULINGS & APPEALS",
    title: "申诉与裁决",
    description: "争议提交、判罚依据与最终裁决流程",
  },
];

export function inferredCategory(rule: Rule): RuleCategory {
  if (/申诉|判罚|裁决|异议/.test(rule.title)) return "appeal";
  if (/迟到|弃赛|暂停|设备|网络|掉线|重赛|异常/.test(rule.title)) return "incident";
  if (/地图|BP|赛程确认|赛程与改期|比赛报到|赛前|录屏|证据/.test(rule.title)) return "match-day";
  if (/参赛规模|入围赛|小组赛|淘汰赛|赛制/.test(rule.title)) return "format";
  return "conduct";
}

export function categoryOf(rule: Rule): RuleCategory {
  return rule.category ?? inferredCategory(rule);
}

export function Section({
  id,
  index,
  eyebrow,
  title,
  tone = "paper",
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  tone?: "paper" | "cream";
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 border-b border-[var(--pub-line-soft)] px-5 py-9 sm:px-8 lg:px-12 lg:py-11 ${
        tone === "cream" ? "bg-white/[0.06]" : "bg-[var(--pub-card)]"
      }`}
    >
      <div className="mx-auto max-w-7xl">
        <header className="grid gap-2 border-t-2 border-[var(--pub-txt)] pt-4 md:grid-cols-[10rem_1fr] md:items-start">
          <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[#ff4655]">
            {index} / {eyebrow}
          </p>
          <h3 className="max-w-4xl text-3xl font-black leading-[1.05] tracking-[-0.04em] text-[var(--pub-txt)] sm:text-4xl lg:text-5xl">
            {title}
          </h3>
        </header>
        <div className="pt-6 lg:pt-7">{children}</div>
      </div>
    </section>
  );
}

export function RuleGroup({
  index,
  eyebrow,
  title,
  description,
  rules,
}: {
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  rules: Rule[];
}) {
  if (!rules.length) return null;

  return (
    <section className="border-l border-t border-[var(--pub-line)] bg-[var(--pub-card)] lg:grid lg:grid-cols-[16rem_1fr]">
      <header className="border-b border-r border-[var(--pub-line)] bg-[var(--pub-line-soft)] p-5 lg:min-h-full lg:p-6">
        <div className="h-1 w-10 bg-[#ff4655]" />
        <p className="mt-4 font-mono text-[10px] font-black tracking-[0.18em] text-[#ff4655]">
          {index} / {eyebrow}
        </p>
        <h4 className="mt-2 text-2xl font-black tracking-[-0.03em] text-[var(--pub-txt)]">{title}</h4>
        <p className="mt-3 text-xs font-medium leading-6 text-[#555a60]">{description}</p>
        <p className="mt-6 font-mono text-[10px] font-black tracking-widest text-[#777b80]">
          {String(rules.length).padStart(2, "0")} ITEMS
        </p>
      </header>

      <div>
        {rules.map((rule, ruleIndex) => {
          const warning = rule.emphasis === "warning";
          const important = rule.emphasis === "important";

          return (
            <article
              key={`${rule.title}-${ruleIndex}`}
              className={`grid gap-2 border-b border-r border-[var(--pub-line)] px-5 py-4 sm:px-6 md:grid-cols-[3.5rem_12rem_1fr] md:gap-5 md:py-5 ${
                warning ? "bg-[#fff0ee]" : important ? "bg-[#faf6f0]" : "bg-[var(--pub-card)]"
              }`}
            >
              <span className="font-mono text-[10px] font-black tracking-widest text-[#ff4655]">
                R{String(ruleIndex + 1).padStart(2, "0")}
              </span>
              <div>
                <h5 className="text-sm font-black leading-6 text-[var(--pub-txt)]">{rule.title}</h5>
                {(warning || important) && (
                  <span
                    className={`mt-1.5 inline-block border px-2 py-1 font-mono text-[9px] font-black tracking-wider ${
                      warning
                        ? "border-[#ff4655] bg-[#ff4655] text-white"
                        : "border-[#ff4655] text-[#d93645]"
                    }`}
                  >
                    {warning ? "赛事警示" : "重点条款"}
                  </span>
                )}
              </div>
              <p className="text-xs font-medium leading-6 text-[var(--pub-txt-soft)]">{rule.detail}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
