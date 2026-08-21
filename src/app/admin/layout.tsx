import type { ReactNode } from "react";
import AdminTopbar from "@/components/admin/AdminTopbar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f3f0e9]">
      <AdminTopbar />
      {children}
    </div>
  );
}
