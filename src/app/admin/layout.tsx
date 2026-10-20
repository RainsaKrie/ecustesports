import type { ReactNode } from "react";
import AdminTopbar from "@/components/admin/AdminTopbar";
import { AdminUIProvider } from "@/components/admin/ui";
// 后台主题层（玻璃卡 / 微排版 / 表格行 / 输入 / 弹窗）。只在这里引入，
// 里面的规则全部 .adm-scope 前缀，不会漏到公开面。
import "@/app/admin-theme.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminUIProvider>
      <div className="adm-scope min-h-screen bg-[var(--adm-surface-3)]">
        <AdminTopbar />
        {children}
      </div>
    </AdminUIProvider>
  );
}
