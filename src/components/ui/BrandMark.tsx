import React from "react";
import { BRANDS, BrandKey } from "@/lib/brands";

interface BrandMarkProps {
  brand: BrandKey | string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

export function BrandMark({
  brand,
  size = "md",
  showName = false,
  className = "",
}: BrandMarkProps) {
  const brandKey = (brand || "mw").toLowerCase();
  const config = BRANDS[brandKey] || BRANDS.mw;

  const sizeClasses = {
    sm: "w-5 h-5 text-[9px] rounded-[4px]",
    md: "w-6 h-6 text-[10px] rounded-[5px]",
    lg: "w-8 h-8 text-xs rounded-[6px]",
  };

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className={`inline-flex items-center justify-center font-bold tracking-tight text-white shrink-0 transition-transform ${sizeClasses[size]}`}
        style={{
          backgroundColor: config.accent,
          boxShadow: `0 0 0 1px rgba(255,255,255,0.1) inset`,
        }}
        title={config.fullName}
      >
        <span>{config.short}</span>
      </div>
      {showName && (
        <span className="font-medium text-sm text-[#EDEDED] tracking-tight">
          {config.name}
        </span>
      )}
    </div>
  );
}
