import type { ReactNode } from "react";
import { AdminUIProvider } from "@/components/admin/ui";

/**
 * BP 房间与 BP 列表共用同一套反馈与确认，避免出现浏览器原生 alert。
 */
export default function BPLayout({ children }: { children: ReactNode }) {
  return (
    <AdminUIProvider>
      <div className="adm-scope">{children}</div>
    </AdminUIProvider>
  );
}
