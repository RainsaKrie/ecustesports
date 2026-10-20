import type { ReactNode } from "react";
import { AdminUIProvider } from "@/components/admin/ui";
import "@/app/admin-theme.css";

/**
 * BP 房间与 BP 列表共用同一套反馈与确认，避免出现浏览器原生 alert。
 * 后台主题层也要引入：/bp 挂了 .adm-scope，弹窗/Toast/输入要跟后台同一套表现。
 */
export default function BPLayout({ children }: { children: ReactNode }) {
  return (
    <AdminUIProvider>
      <div className="adm-scope">{children}</div>
    </AdminUIProvider>
  );
}
