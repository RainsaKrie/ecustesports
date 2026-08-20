import { ReactNode } from "react";

export default function FrameworkNotice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3 border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
      <span className="mt-0.5 font-mono text-[0.5625rem] font-black tracking-wider">赛事提示</span>
      <p>{children}</p>
    </div>
  );
}
