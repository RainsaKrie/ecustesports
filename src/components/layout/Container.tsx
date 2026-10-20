import { ReactNode } from "react";

interface ContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * 全站统一内容宽度 1100px、左右 28px。
 * 1100 是 v8 样板的内容栏宽，比原来的 max-w-7xl（1280）窄 —— 行宽更适合长表格与比赛行。
 */
export default function Container({ children, className = "" }: ContainerProps) {
  return (
    <div className={`mx-auto w-full max-w-[1100px] px-7 ${className}`}>
      {children}
    </div>
  );
}
