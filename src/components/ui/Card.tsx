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
          ? "bg-white border-gray-200 shadow-sm"
          : "bg-white border-gray-200/90 shadow-xs"
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
    <div className={`pb-4 mb-4 border-b border-gray-100 ${className}`}>
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
      className={`font-serif text-lg md:text-xl text-gray-900 font-normal tracking-tight ${className}`}
    >
      {children}
    </h3>
  );
}
