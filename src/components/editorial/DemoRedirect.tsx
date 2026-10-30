"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function DemoRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const brand = params.get("brand") || "wa";
    router.replace(`/cms?demo=1&brand=${encodeURIComponent(brand)}`);
  }, [router, params]);
  return <div className="ed-stack" aria-busy="true" />;
}
