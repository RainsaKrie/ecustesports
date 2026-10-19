"use client";

// =====================
// 赛制编排器（2026-10-19）
//
// 交互原型（.workbuddy/ui-samples/stage-chain-editor.html）的 React 版。
// 与原型的两处**本质区别**：
//   1. **规则不抄**：直接调用 `validateStageChain()`（13 条 R 规则的唯一实现），
//      原型里那份拷贝迟早会和真规则对不上；
//   2. **受控组件**：状态由 props 驱动，输入时只更新对应字段，**不重建整块 DOM** ——
//      原型是"整块重建 + 输入框重挂"，会丢焦点、体感像卡死。
//
// 结构：竖版漏斗（各层宽度按剩余队数递减），每段默认收起成一行，点开才编辑。
// =====================

import { useMemo, useState } from "react";
import {
  validateStageChain,
  type BoFormat,
  type StageChain,
  type StageType,
} from "@/lib/domains/schedule/stage-chain-rules";
import { FORMAT_TEMPLATES } from "@/lib/domains/schedule/format-templates";
import { DENSE_MICRO, DENSE_META, DENSE_TITLE } from "@/components/admin/RegistrationWorkspaceParts";

type TypeMeta = { id: StageType; name: string; desc: string };

/** 编辑器里每段只存这四个字段 —— 进入数是**推出来**的，不让人填，也就不会对不上 */
export type EditorStage = {
  name: string;
  type: StageType;
  advance: number;
  bo: BoFormat;
  /** 直进名额：本段除了接上一段晋级，还有多少支直接进入（汇合型，如 28 直进 + 4 资格赛打进 = 32） */
  directEntries?: number;
};

/** 转成校验器要的完整链（补出每段的 entrants） */
function toChain(entrants: number, stages: EditorStage[]): StageChain {
  // 首段进入数 = 总报名数 − 第 2 段的直进名额（汇合型下不相等：36 队里只有 8 支打资格赛）
  const firstShare = Math.max(0, entrants - Math.max(0, stages[1]?.directEntries ?? 0));
  let cursor = firstShare;
  return {
    entrants,
    stages: stages.map((stage) => {
      const direct = Math.max(0, stage.directEntries ?? 0);
      const spec = { ...stage, entrants: cursor + direct };
      cursor = stage.advance;
      return spec;
    }),
  };
}

/** 界面上的名字一律自解释；行话只放在括号里当别名 */
const TYPES: TypeMeta[] = [
  { id: "single-elim", name: "单败", desc: "输一场即淘汰" },
  { id: "double-elim", name: "双败", desc: "输两场才淘汰" },
  { id: "gsl-groups", name: "组内双败", desc: "4 队一组，输两场淘汰，取前 2（旧称 GSL）" },
  { id: "group-single-elim", name: "组内循环", desc: "4 队一组，两两都打，取前 2" },
  { id: "round-robin", name: "单组循环", desc: "全部队伍两两都打（3–6 队）" },
  { id: "swiss", name: "瑞士轮", desc: "同战绩互打，不淘汰，打满轮数取前几名" },
];

/** 模板**从真实模板表生成**（7 套），不手写副本 —— 手写的会脱节：
 *  原先这里有 5 套硬编码，而 `FORMAT_TEMPLATES` 有 7 套，少了那两套汇合型（资格赛并入正赛）。 */
type Template = { label: string; entrants: number; stages: EditorStage[] };
type FormatTemplateStage = (typeof FORMAT_TEMPLATES)[number]["stages"][number];

function templatesFromLibrary(): Template[] {
  return FORMAT_TEMPLATES.map((template) => {
    const stages: EditorStage[] = template.stages.map((stage: FormatTemplateStage, index: number) => {
      const next = template.stages[index + 1];
      const prev = template.stages[index - 1];
      // 汇合型：本段比上一段大 → 本段晋级 = 本段一半，差额是直进
      const mergingNext = next ? next.teamCount > stage.teamCount : false;
      const advance = mergingNext ? Math.max(1, Math.floor(stage.teamCount / 2)) : (next?.teamCount ?? 1);
      const prevAdvance = index === 0 ? stage.teamCount
        : (stage.teamCount > (prev?.teamCount ?? 0) ? Math.max(1, Math.floor((prev?.teamCount ?? 0) / 2)) : (prev?.teamCount ?? 0));
      const directEntries = index === 0 ? 0 : Math.max(0, stage.teamCount - prevAdvance);
      const bo = Number(String(stage.boType).replace("BO", "")) as BoFormat;
      return {
        name: stage.name,
        type: stage.type as StageType,
        advance,
        bo: (bo === 1 || bo === 5 ? bo : 3) as BoFormat,
        ...(directEntries > 0 ? { directEntries } : {}),
      };
    });
    // 队伍数 = 首段进入数 + 第 2 段直进（汇合型下总报名 ≠ 首段进入数）
    const total = (template.stages[0]?.teamCount ?? 0) + (stages[1]?.directEntries ?? 0);
    return { label: template.name, entrants: total, stages };
  });
}

const TEMPLATES = templatesFromLibrary();

const isPowerOfTwo = (n: number) => n >= 2 && (n & (n - 1)) === 0;

/** 这一类型在当前进入数下**能否选**。判据与 R1–R5 同口径，但只用于禁用态，不代替校验。 */
function typeBlocked(type: StageType, entrants: number): string | null {
  if (type === "double-elim" && !isPowerOfTwo(entrants)) return "需 2 的幂";
  if (type === "swiss" && (!isPowerOfTwo(entrants) || entrants < 8)) return "需 2 的幂且 ≥8";
  if (type === "round-robin" && (entrants < 3 || entrants > 6)) return "仅限 3–6 队";
  if ((type === "gsl-groups" || type === "group-single-elim") && entrants % 4 !== 0) return "需 4 的倍数";
  return null;
}

/** 该类型下晋级数能取哪些值（只列合法值，消灭"输错"） */
function advanceChoices(type: StageType, entrants: number): number[] {
  if (type === "gsl-groups" || type === "group-single-elim") {
    const value = Math.round(entrants / 4) * 2;
    return value > 0 && value < entrants ? [value] : [];
  }
  const out: number[] = [];
  for (let v = 1; v < entrants; v *= 2) out.push(v);
  return out.sort((a, b) => b - a);
}

export default function StageChainEditor({
  entrants,
  value,
  onChange,
  readOnly = false,
}: {
  entrants: number;
  value: EditorStage[];
  onChange: (next: EditorStage[]) => void;
  readOnly?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState<number>(0);

  const chain: StageChain = useMemo(() => toChain(entrants, value), [entrants, value]);
  const { problems, warnings } = useMemo(() => validateStageChain(chain), [chain]);

  /** 第 i 段进入多少支 */
  const firstShare = Math.max(0, entrants - Math.max(0, value[1]?.directEntries ?? 0));
  /** 第 i 段的进入数：首段扣掉汇合直进，其余接上一段晋级 + 本段直进 */
  const entryOf = (i: number) =>
    i === 0 ? firstShare : value[i - 1].advance + Math.max(0, value[i].directEntries ?? 0);

  // 漏斗宽度：以最大队数为满宽，逐层收窄（宽度本身就是信息）
  const maxN = Math.max(entrants, ...value.map((_, i) => entryOf(i)), 1);
  const widthOf = (n: number) => `${Math.max(40, Math.round((n / maxN) * 100))}%`;

  const patch = (i: number, part: Partial<EditorStage>) =>
    onChange(value.map((stage, index) => (index === i ? { ...stage, ...part } : stage)));

  const applyTemplate = (tpl: Template) => {
    onChange(tpl.stages.map((stage) => ({ ...stage })));
    setOpenIndex(-1);
    setOpenIndex(-1);
  };

  const issueOfStage = (i: number) => problems.filter((p) => p.stage === i);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--adm-line-soft)] pb-3">
        <span className={`${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>模板</span>
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            disabled={readOnly}
            onClick={() => applyTemplate(tpl)}
            className="border border-[var(--adm-line)] bg-[var(--adm-surface)] px-2.5 py-1 text-[length:var(--adm-fs-sm)] font-semibold text-[var(--adm-text)] transition-colors duration-150 hover:border-[var(--adm-text)] disabled:cursor-not-allowed disabled:text-[var(--adm-text-mute)]"
          >
            {tpl.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col">
        <div
          className="flex items-center justify-between gap-3 border border-[var(--adm-line)] bg-[var(--adm-surface-3)] px-3.5 py-2.5"
          style={{ width: widthOf(entrants), marginInline: "auto" }}
        >
          <span className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text)]">参赛队伍</span>
          <span className="font-mono text-[length:var(--adm-fs-md)] font-bold tabular-nums text-[var(--adm-text)]">{entrants} 支</span>
        </div>

        {value.map((stage, i) => {
          const entrantsOfStage = entryOf(i);
          const type = TYPES.find((t) => t.id === stage.type);
          const open = openIndex === i;
          const stageIssues = issueOfStage(i);
          return (
            <div key={`${stage.name}-${i}`}>
              <div className="flex items-center justify-center gap-2 py-1.5 font-mono text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">
                <span className="text-[var(--adm-line)]">↓</span>
                <span>{entrantsOfStage - stage.advance} 场</span>
                <span className="opacity-40">·</span>
                <span>剩 {stage.advance} 支</span>
              </div>

              <div
                className="border border-[var(--adm-line)] bg-[var(--adm-surface)]"
                style={{ width: widthOf(entrantsOfStage), marginInline: "auto" }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setOpenIndex(open ? -1 : i); }}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${open ? "border-b border-[var(--adm-line-soft)] bg-[var(--adm-surface-3)]" : "hover:bg-[var(--adm-surface-2)]"}`}
                >
                  <span className={`${DENSE_TITLE} truncate font-bold text-[var(--adm-text)]`}>{stage.name}</span>
                  <span className="shrink-0 border border-[var(--adm-line)] bg-[var(--adm-surface)] px-1.5 py-0.5 text-[length:var(--adm-fs-xs)] font-bold text-[var(--adm-text-soft)]">{type?.name}</span>
                  <span className="shrink-0 border border-[var(--adm-line)] bg-[var(--adm-surface)] px-1.5 py-0.5 text-[length:var(--adm-fs-xs)] font-bold text-[var(--adm-text-soft)]">BO{stage.bo}</span>
                  {stageIssues.length > 0 && (
                    <span className="shrink-0 border border-[var(--adm-red-line)] bg-[var(--adm-red-soft)] px-1.5 py-0.5 text-[length:var(--adm-fs-xs)] font-bold text-[var(--adm-red-text)]">不成立</span>
                  )}
                  <span className="ml-auto shrink-0 text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">{open ? "▴" : "▾"}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label="删除这一段"
                      onClick={(event) => {
                        event.stopPropagation();
                        onChange(value.filter((_, index) => index !== i));
                        setOpenIndex(-1);
                      }}
                      className="grid h-7 w-7 shrink-0 place-items-center border border-transparent text-base leading-none text-[var(--adm-text-mute)] transition-colors duration-150 hover:border-[var(--adm-red-line)] hover:bg-[var(--adm-red-soft)] hover:text-[var(--adm-red-text)]"
                    >
                      ×
                    </button>
                  )}
                </div>

                {open && (
                  <div className="px-3 py-3">
                    <p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>名称</p>
                    <input
                      value={stage.name}
                      readOnly={readOnly}
                      onChange={(event) => patch(i, { name: event.target.value })}
                      className="mt-1 w-full border border-[var(--adm-line)] bg-[var(--adm-surface)] px-2 py-1.5 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)]"
                    />

                    <p className={`mt-3 ${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>类型</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {TYPES.map((item) => {
                        const blocked = typeBlocked(item.id, entrantsOfStage);
                        const active = item.id === stage.type;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={readOnly || Boolean(blocked)}
                            aria-pressed={active}
                            onClick={() => {
                              const choices = advanceChoices(item.id, entrantsOfStage);
                              patch(i, { type: item.id, advance: choices.includes(stage.advance) ? stage.advance : (choices[0] ?? 1) });
                            }}
                            className={`border px-2.5 py-1 text-[length:var(--adm-fs-sm)] transition-colors duration-150 ${
                              active
                                ? "border-[var(--adm-red)] font-bold text-[var(--adm-red-text)] shadow-[inset_0_0_0_1px_var(--adm-red)]"
                                : "border-[var(--adm-line)] font-semibold text-[var(--adm-text)] hover:border-[var(--adm-text)]"
                            } ${blocked ? "cursor-not-allowed text-[var(--adm-text-mute)] line-through hover:border-[var(--adm-line)]" : ""}`}
                          >
                            {item.name}
                            {blocked ? `（${blocked}）` : ""}
                          </button>
                        );
                      })}
                    </div>
                    <p className={`mt-2 ${DENSE_META} text-[var(--adm-text-soft)]`}>{type?.desc}</p>

                    {i > 0 && (
                      <>
                        <p className={`mt-3 ${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>
                          直进（除上一段晋级外，本段还有多少支直接进入）
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {[0, 4, 8, 12, 16, 20, 24, 28, 32].map((n) => (
                            <button
                              key={n}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={(stage.directEntries ?? 0) === n}
                              onClick={() => patch(i, { directEntries: n })}
                              className={`border px-2.5 py-1 font-mono text-[length:var(--adm-fs-sm)] tabular-nums transition-colors duration-150 ${
                                (stage.directEntries ?? 0) === n
                                  ? "border-[var(--adm-red)] font-bold text-[var(--adm-red-text)] shadow-[inset_0_0_0_1px_var(--adm-red)]"
                                  : "border-[var(--adm-line)] font-semibold text-[var(--adm-text)] hover:border-[var(--adm-text)]"
                              }`}
                            >
                              {n === 0 ? "无" : `+${n}`}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-6">
                      <div>
                        <p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>晋级</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {advanceChoices(stage.type, entrantsOfStage).map((n) => (
                            <button
                              key={n}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={n === stage.advance}
                              onClick={() => patch(i, { advance: n })}
                              className={`border px-2.5 py-1 font-mono text-[length:var(--adm-fs-sm)] tabular-nums transition-colors duration-150 ${
                                n === stage.advance
                                  ? "border-[var(--adm-red)] font-bold text-[var(--adm-red-text)] shadow-[inset_0_0_0_1px_var(--adm-red)]"
                                  : "border-[var(--adm-line)] font-semibold text-[var(--adm-text)] hover:border-[var(--adm-text)]"
                              }`}
                            >
                              {n} 支
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-soft)]`}>强度</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {([1, 3, 5] as BoFormat[]).map((bo) => (
                            <button
                              key={bo}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={bo === stage.bo}
                              onClick={() => patch(i, { bo })}
                              className={`border px-2.5 py-1 font-mono text-[length:var(--adm-fs-sm)] transition-colors duration-150 ${
                                bo === stage.bo
                                  ? "border-[var(--adm-red)] font-bold text-[var(--adm-red-text)] shadow-[inset_0_0_0_1px_var(--adm-red)]"
                                  : "border-[var(--adm-line)] font-semibold text-[var(--adm-text)] hover:border-[var(--adm-text)]"
                              }`}
                            >
                              BO{bo}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-center gap-2 py-1.5 font-mono text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">
          <span className="text-[var(--adm-line)]">↓</span>
        </div>
        <div
          className="flex items-center justify-between gap-3 border border-[var(--adm-line)] bg-[var(--adm-surface-3)] px-3.5 py-2.5"
          style={{ width: widthOf(1), marginInline: "auto" }}
        >
          <span className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text)]">冠军</span>
          <span className="font-mono text-[length:var(--adm-fs-md)] font-bold tabular-nums text-[var(--adm-text)]">1 支</span>
        </div>
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            const last = value[value.length - 1];
            onChange([...value, {
              name: "新赛段",
              type: "single-elim",
              advance: last ? Math.max(1, Math.floor(last.advance / 2)) : 1,
              bo: last ? last.bo : 3,
            }]);
            setOpenIndex(value.length);
          }}
          className="w-full border border-dashed border-[var(--adm-line)] py-2 text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)] transition-colors duration-150 hover:border-[var(--adm-text)] hover:text-[var(--adm-text)]"
        >
          + 添加赛段
        </button>
      )}

      <div
        className={`border px-3 py-2.5 text-[length:var(--adm-fs-sm)] ${
          problems.length
            ? "border-[var(--adm-red-line)] bg-[var(--adm-red-soft)] text-[var(--adm-red-text)]"
            : warnings.length
              ? "border-[#fde68a] bg-[#fffbeb] text-[#9a4808]"
              : "border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]"
        }`}
      >
        <b className="block text-[length:var(--adm-fs-md)] font-bold">
          {problems.length ? "这个赛制打不出来" : warnings.length ? "可以打，有一处不常规" : "可以打"}
        </b>
        {(problems.length ? problems : warnings).map((issue) => (
          <p key={`${issue.rule}-${issue.stage}-${issue.message}`} className={`${DENSE_META} mt-0.5`}>
            · {issue.message}
          </p>
        ))}
      </div>
    </div>
  );
}
