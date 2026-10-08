import type { ReactNode } from "react";
import AdminTopbar from "@/components/admin/AdminTopbar";
import { AdminUIProvider } from "@/components/admin/ui";

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
