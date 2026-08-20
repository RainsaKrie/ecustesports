import { ReactNode } from "react";

interface AdminPageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  status?: string;
  actions?: ReactNode;
}

export default function AdminPageHeader({ eyebrow, title, description, status, actions }: AdminPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-5 border-b border-slate-300 pb-6">
      <div className="max-w-3xl">
        <div className="mb-2 flex items-center gap-2 font-mono text-[0.5625rem] font-black tracking-[0.16em] text-[#c83242]">
          <span className="h-px w-7 bg-[#ff4655]" /> {eyebrow}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl">{title}</h1>
          {status && (
            <span className="bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{status}</span>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
