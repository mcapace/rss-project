import React from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-[#1B1B1E] border border-[rgba(255,255,255,0.04)] ${className}`}
      style={style}
    />
  );
}

export function TableRowSkeleton() {
  return (
    <tr className="border-b border-[rgba(255,255,255,0.04)]">
      <td className="py-4 px-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-6 h-6 rounded" />
          <Skeleton className="w-24 h-4 rounded" />
        </div>
      </td>
      <td className="py-4 px-6">
        <Skeleton className="w-32 h-4 rounded mb-1.5" />
        <Skeleton className="w-16 h-3 rounded" />
      </td>
      <td className="py-4 px-6">
        <Skeleton className="w-20 h-5 rounded-full" />
      </td>
      <td className="py-4 px-6">
        <Skeleton className="w-8 h-4 rounded" />
      </td>
      <td className="py-4 px-6">
        <Skeleton className="w-20 h-3 rounded" />
      </td>
      <td className="py-4 px-6 text-right">
        <Skeleton className="w-16 h-6 rounded ml-auto" />
      </td>
    </tr>
  );
}

export function ArticleCardSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#141416] space-y-3">
      <div className="flex justify-between items-start gap-4">
        <Skeleton className="w-3/4 h-5 rounded" />
        <Skeleton className="w-5 h-5 rounded" />
      </div>
      <Skeleton className="w-full h-3 rounded" />
      <Skeleton className="w-5/6 h-3 rounded" />
      <div className="flex gap-3 pt-2">
        <Skeleton className="w-20 h-3 rounded" />
        <Skeleton className="w-24 h-3 rounded" />
      </div>
    </div>
  );
}
