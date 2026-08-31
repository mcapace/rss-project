import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({
  children,
  className = "",
  elevated = false,
  padding = "md",
  ...props
}: CardProps) {
  const paddingClasses = {
    none: "p-0",
    sm: "p-4",
    md: "p-6", // 24px padding per spec
    lg: "p-8",
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        elevated
          ? "bg-[#1B1B1E] border-[rgba(255,255,255,0.1)]"
          : "bg-[#141416] border-[rgba(255,255,255,0.08)]"
      } ${paddingClasses[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`pb-4 mb-4 border-b border-[rgba(255,255,255,0.06)] ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`font-serif text-lg md:text-xl text-[#EDEDED] font-normal tracking-tight ${className}`}
    >
      {children}
    </h3>
  );
}
