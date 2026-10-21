import { ReactNode } from "react";

interface ContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * 全站统一内容宽度 1100px、左右 28px。
 * 1240（2026-10-20 由 1100 放宽）：负责人反馈页面被压得过窄、右侧文字挤在一起。
 * 1100 是 v8 样板的宽度，但样板只有赛程一页；实际页面信息更密，1100 撑不住。
 */
export default function Container({ children, className = "" }: ContainerProps) {
  return (
    <div className={`mx-auto w-full max-w-[1360px] px-7 ${className}`}>
      {children}
    </div>
  );
}
