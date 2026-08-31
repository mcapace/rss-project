import React from "react";
import { BRANDS, BrandKey } from "@/lib/brands";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "outline" | "danger" | "brand";
  brand?: BrandKey | string;
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  className?: string;
}

export function Button({
  children,
  variant = "primary",
  brand,
  size = "md",
  isLoading = false,
  className = "",
  disabled,
  style,
  ...props
}: ButtonProps) {
  const brandConfig = brand ? BRANDS[brand.toLowerCase()] : undefined;

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
    md: "px-4 py-2 text-sm rounded-lg gap-2",
    lg: "px-6 py-2.5 text-base rounded-xl gap-2.5",
  };

  const baseClasses =
    "inline-flex items-center justify-center font-medium tracking-tight cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C9A227]";

  let variantClasses = "";
  let customStyle: React.CSSProperties = { ...style };

  if (variant === "primary") {
    // Gold accent default
    variantClasses = "bg-[#C9A227] hover:bg-[#D8B138] text-[#0A0A0B] font-semibold";
  } else if (variant === "brand" && brandConfig) {
    variantClasses = "text-white font-semibold";
    customStyle = {
      backgroundColor: brandConfig.accent,
      ...style,
    };
  } else if (variant === "ghost") {
    variantClasses =
      "bg-transparent hover:bg-[#1B1B1E] text-[#EDEDED] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.16)]";
  } else if (variant === "outline") {
    variantClasses =
      "bg-[#141416] hover:bg-[#1B1B1E] text-[#EDEDED] border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.2)]";
  } else if (variant === "danger") {
    variantClasses =
      "bg-[rgba(239,68,68,0.15)] hover:bg-[rgba(239,68,68,0.25)] text-[#F87171] border border-[rgba(239,68,68,0.3)]";
  }

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses} ${className}`}
      disabled={disabled || isLoading}
      style={customStyle}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin -ml-0.5 h-3.5 w-3.5 text-current opacity-80"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
      {children}
    </button>
  );
}
