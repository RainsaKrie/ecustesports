"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AdminButton from "./AdminButton";
import AdminModal from "./AdminModal";

/**
 * 管理端的反馈与确认（唯一来源）。
 *
 * 取代 `window.confirm` / `window.alert`：浏览器原生弹窗样式与站点无关，
 * 且无法表达「破坏性动作」的层级。
 *
 *   const confirm = useAdminConfirm();   // await confirm({...}) => boolean
 *   const toast = useAdminToast();       // toast.success / error / info
 */

export type AdminToastTone = "success" | "error" | "info";

export interface AdminConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface ToastItem {
  id: number;
  tone: AdminToastTone;
  text: string;
}

const ToastContext = createContext<(tone: AdminToastTone, text: string) => void>(() => {});
const ConfirmContext = createContext<(options: AdminConfirmOptions) => Promise<boolean>>(async () => false);

export function useAdminToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (text: string) => push("success", text),
      error: (text: string) => push("error", text),
      info: (text: string) => push("info", text),
    }),
    [push],
  );
}

export function useAdminConfirm() {
  return useContext(ConfirmContext);
}

const TOAST_TONE_CLASS: Record<AdminToastTone, string> = {
  success: "border-[var(--adm-ok-line)] bg-[var(--adm-ok-soft)] text-[var(--adm-ok-text)]",
  error: "border-[var(--adm-red-line)] bg-[var(--adm-red-soft)] text-[var(--adm-red-deep)]",
  info: "border-[var(--adm-info-line)] bg-[var(--adm-info-soft)] text-[var(--adm-info-text)]",
};

export function AdminUIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<AdminConfirmOptions | null>(null);
  const toastId = useRef(0);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);

  const push = useCallback((tone: AdminToastTone, text: string) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((list) => [...list, { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  const confirm = useCallback((options: AdminConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmOptions(options);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmOptions(null);
    resolve?.(value);
  }, []);

  // Cmd/Ctrl+K 聚焦搜索（设计文档 6.7）。
  // 用一个 data 属性做约定：页面上任何搜索框加 `data-search-input` 就会被命中，
  // 不需要每个页面自己注册键盘事件。
  // ★ 这一页没有搜索框时**不要 preventDefault** —— Ctrl+K 在浏览器里是「聚焦地址栏」，
  //   没有搜索框还去拦它，就是平白抢走用户的习惯快捷键。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      const input = document.querySelector<HTMLInputElement>("[data-search-input]");
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        {confirmOptions && (
          <AdminModal
            title={confirmOptions.title}
            tone={confirmOptions.tone === "danger" ? "danger" : "default"}
            width="sm"
            onClose={() => settle(false)}
            footer={
              <>
                <AdminButton level="secondary" size="sm" onClick={() => settle(false)}>
                  {confirmOptions.cancelLabel ?? "取消"}
                </AdminButton>
                <AdminButton
                  level={confirmOptions.tone === "danger" ? "danger" : "primary"}
                  size="sm"
                  onClick={() => settle(true)}
                >
                  {confirmOptions.confirmLabel ?? "确认"}
                </AdminButton>
              </>
            }
          >
            {confirmOptions.body && (
              <p className="whitespace-pre-line text-[length:var(--adm-fs-md)] leading-relaxed text-[var(--adm-text-soft)]">{confirmOptions.body}</p>
            )}
          </AdminModal>
        )}

        <div className="pointer-events-none fixed right-5 top-5 z-[90] flex w-[min(20rem,calc(100vw-2.5rem))] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={`border px-4 py-3 text-[length:var(--adm-fs-sm)] font-bold leading-relaxed ${TOAST_TONE_CLASS[toast.tone]}`}
            >
              {toast.text}
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
