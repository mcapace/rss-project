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
    variantClasses = "bg-[#C9A227] hover:bg-[#D8B138] text-gray-950 font-semibold shadow-xs";
  } else if (variant === "brand" && brandConfig) {
    variantClasses = "text-white font-semibold shadow-xs";
    customStyle = {
      backgroundColor: brandConfig.accent,
      ...style,
    };
  } else if (variant === "ghost") {
    variantClasses =
      "bg-transparent hover:bg-gray-100 text-gray-700 border border-gray-200 hover:border-gray-300";
  } else if (variant === "outline") {
    variantClasses =
      "bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 hover:border-gray-300 shadow-xs";
  } else if (variant === "danger") {
    variantClasses =
      "bg-red-50 hover:bg-red-100 text-red-700 border border-red-200";
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
