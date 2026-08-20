import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`border border-[#0f1923]/20 bg-[#f7f5ef]/80 p-5 shadow-[4px_4px_0_rgba(15,25,35,0.08)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[6px_6px_0_rgba(15,25,35,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}
