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
      dotColor: "#6B7280",
      bgColor: "#F3F4F6",
      borderColor: "#E5E7EB",
      textColor: "#4B5563",
    },
    processing: {
      label: "Processing",
      dotColor: brandConfig?.accent || "#D97706",
      bgColor: "#FEF3C7",
      borderColor: "#FDE68A",
      textColor: "#92400E",
      pulse: true,
    },
    review: {
      label: "Review",
      dotColor: "#0284C7",
      bgColor: "#E0F2FE",
      borderColor: "#BAE6FD",
      textColor: "#0369A1",
    },
    published: {
      label: "Published",
      dotColor: "#16A34A",
      bgColor: "#DCFCE7",
      borderColor: "#BBF7D0",
      textColor: "#15803D",
    },
    failed: {
      label: "Failed",
      dotColor: "#DC2626",
      bgColor: "#FEE2E2",
      borderColor: "#FECACA",
      textColor: "#B91C1C",
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
