import React from "react";
import { BRANDS, BrandKey } from "@/lib/brands";

export type IssueStatus = "queued" | "processing" | "review" | "published" | "failed";

interface StatusBadgeProps {
  status: IssueStatus | string;
  brand?: BrandKey | string;
  className?: string;
}

export function StatusBadge({ status, brand, className = "" }: StatusBadgeProps) {
  const normStatus = (status || "queued").toLowerCase() as IssueStatus;
  const brandConfig = brand ? BRANDS[brand.toLowerCase()] : undefined;

  const statusConfigs: Record<
    IssueStatus,
    {
      label: string;
      dotColor: string;
      bgColor: string;
      borderColor: string;
      textColor: string;
      pulse?: boolean;
    }
  > = {
    queued: {
      label: "Queued",
      dotColor: "#9A9AA0",
      bgColor: "rgba(255, 255, 255, 0.04)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      textColor: "#9A9AA0",
    },
    processing: {
      label: "Processing",
      dotColor: brandConfig?.accent || "#C9A227",
      bgColor: brandConfig ? brandConfig.bgTint : "rgba(201, 162, 39, 0.12)",
      borderColor: brandConfig ? brandConfig.borderTint : "rgba(201, 162, 39, 0.25)",
      textColor: "#EDEDED",
      pulse: true,
    },
    review: {
      label: "Review",
      dotColor: "#38BDF8",
      bgColor: "rgba(56, 189, 248, 0.1)",
      borderColor: "rgba(56, 189, 248, 0.25)",
      textColor: "#38BDF8",
    },
    published: {
      label: "Published",
      dotColor: "#22C55E",
      bgColor: "rgba(34, 197, 94, 0.1)",
      borderColor: "rgba(34, 197, 94, 0.25)",
      textColor: "#4ADE80",
    },
    failed: {
      label: "Failed",
      dotColor: "#EF4444",
      bgColor: "rgba(239, 68, 68, 0.1)",
      borderColor: "rgba(239, 68, 68, 0.25)",
      textColor: "#F87171",
    },
  };

  const config = statusConfigs[normStatus] || statusConfigs.queued;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-widest uppercase ${className}`}
      style={{
        backgroundColor: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        color: config.textColor,
      }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          config.pulse ? "animate-pulse" : ""
        }`}
        style={{
          backgroundColor: config.dotColor,
          boxShadow: config.pulse ? `0 0 8px ${config.dotColor}` : undefined,
        }}
      />
      {config.label}
    </span>
  );
}
