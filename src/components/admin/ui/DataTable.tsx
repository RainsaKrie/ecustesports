// =====================
// 数据表（U2，2026-10-18）
//
// 四态齐全：loading（骨架，保留表头不让布局跳）/ error（可重试）/ empty（说明为什么空）/ ready。
// 手机端自动**转卡片**（每行一张，用列头当标签）—— 这是方案里"表格在手机上横向溢出"的解法。
//
// 只用令牌；行悬停只改底色（200ms 内），可点击行支持键盘（Enter / 空格）。
// =====================

import type { ReactNode } from "react";
import Skeleton from "./Skeleton";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** 手机卡片里隐藏的列（次要列） */
  hideOnMobile?: boolean;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** 除了"有数据/没数据"，还要能表达"正在加载"与"加载失败" */
  state?: "ready" | "loading" | "error";
  errorText?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  density?: "default" | "compact";
}

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  state = "ready",
  errorText = "加载失败，请重试",
  onRetry,
  emptyTitle = "暂无数据",
  emptyHint,
  emptyAction,
  onRowClick,
  density = "default",
}: DataTableProps<T>) {
  const cellPad = density === "compact" ? "px-[var(--sp-3)] py-[var(--sp-2)]" : "px-[var(--sp-4)] py-[var(--sp-3)]";

  const frame = "border border-[var(--adm-line)] bg-[var(--adm-surface)]";

  function body() {
    if (state === "loading") {
      return (
        <div className={`${frame} p-[var(--sp-4)]`}>
          <Skeleton rows={4} />
        </div>
      );
    }
    if (state === "error") {
      return (
        <div className={`${frame} flex flex-col items-start gap-[var(--sp-3)] p-[var(--sp-6)]`}>
          <p className="text-[length:var(--fs-md)] text-[var(--adm-red-text)]">{errorText}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="adm-btn adm-btn--secondary adm-btn--md">
              重新加载
            </button>
          )}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className={`${frame} px-[var(--sp-6)] py-[var(--sp-12)] text-center`}>
          <p className="text-[length:var(--fs-md)] font-semibold text-[var(--adm-text)]">{emptyTitle}</p>
          {emptyHint && <p className="mt-[var(--sp-2)] text-[length:var(--fs-sm)] text-[var(--adm-text-soft)]">{emptyHint}</p>}
          {emptyAction && <div className="mt-[var(--sp-4)]">{emptyAction}</div>}
        </div>
      );
    }

    return (
      <>
        {/* 桌面：表格 */}
        <div className={`hidden overflow-x-auto md:block ${frame}`}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={`border-b border-[var(--adm-line)] text-[length:var(--fs-xs)] font-normal text-[var(--adm-text-mute)] ${cellPad} ${
                      column.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  {...(onRowClick
                    ? {
                        tabIndex: 0,
                        role: "button",
                        onClick: () => onRowClick(row),
                        onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        },
                        className:
                          "cursor-pointer transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:bg-[var(--adm-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--adm-red)]",
                      }
                    : { className: "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:bg-[var(--adm-surface-2)]" })}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`border-b border-[var(--adm-line-soft)] text-[length:var(--fs-md)] text-[var(--adm-text)] ${cellPad} ${
                        column.align === "right" ? "text-right tabular-nums" : "text-left"
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 手机：每行一张卡，列头当标签 */}
        <div className="space-y-[var(--sp-3)] md:hidden">
          {rows.map((row) => (
            <div
              key={getRowKey(row)}
              className={`${frame} p-[var(--sp-4)] ${onRowClick ? "cursor-pointer" : ""}`}
              {...(onRowClick ? { tabIndex: 0, role: "button", onClick: () => onRowClick(row) } : {})}
            >
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="flex items-baseline justify-between gap-[var(--sp-3)] py-[var(--sp-1)]">
                    <span className="text-[length:var(--fs-xs)] text-[var(--adm-text-mute)]">{column.header}</span>
                    <span className="text-right text-[length:var(--fs-sm)] text-[var(--adm-text)]">{column.render(row)}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </>
    );
  }

  return body();
}
