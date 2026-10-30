"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CmsBrand } from "@/lib/cms/types";
import { CMS_BRANDS } from "@/lib/cms/types";
import type { CmsUser } from "@/lib/cms/access";
import { createDemoData, createLiveData, DEMO_USER, type EditorialData } from "@/lib/editorial/data";
import { workspaceHref } from "@/lib/editorial/helpers";

export type Toast = { id: number; message: string; tone: "default" | "error" | "success" };

type EditorialContextValue = {
  user: CmsUser;
  demo: boolean;
  data: EditorialData;
  brand: CmsBrand;
  brands: CmsBrand[];
  setBrand: (brand: CmsBrand) => void;
  /** A link that carries the publication and demo mode. */
  href: (path: string, extra?: Record<string, string | null | undefined>) => string;
  toast: (message: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /** Increments after any mutation so pages can refresh. */
  mutationVersion: number;
  refresh: () => void;
};

const EditorialContext = createContext<EditorialContextValue | null>(null);

export function useEditorial(): EditorialContextValue {
  const value = useContext(EditorialContext);
  if (!value) throw new Error("useEditorial must be used inside EditorialProvider.");
  return value;
}

export function resolveBrand(value: string | null | undefined, allowed: CmsBrand[]): CmsBrand {
  if (value && (allowed as string[]).includes(value)) return value as CmsBrand;
  return allowed.includes("wa") ? "wa" : allowed[0] ?? "wa";
}

export function EditorialProvider({ user, demo, children }: { user: CmsUser | null; demo: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const effectiveUser = demo || !user ? DEMO_USER : user;
  const brands = useMemo(() => effectiveUser.brands.filter(brand => CMS_BRANDS.includes(brand)), [effectiveUser]);
  const brand = resolveBrand(searchParams.get("brand"), brands);
  const [data, setData] = useState<EditorialData>(() => (demo ? createDemoData() : createLiveData()));
  if (data.demo !== demo) setData(demo ? createDemoData() : createLiveData());

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [mutationVersion, setMutationVersion] = useState(0);
  useEffect(() => data.subscribe(() => setMutationVersion(value => value + 1)), [data]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), tone === "error" ? 7000 : 3600);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(current => current.filter(item => item.id !== id)), []);

  const href = useCallback((path: string, extra?: Record<string, string | null | undefined>) => workspaceHref(path, { brand, demo }, extra), [brand, demo]);

  const setBrand = useCallback((next: CmsBrand) => {
    if (!brands.includes(next)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("brand", next);
    // Leave a document open; drop list-only filters that belong to the previous publication.
    params.delete("issue");
    router.replace(`${pathname}?${params}`);
  }, [brands, pathname, router, searchParams]);

  const refresh = useCallback(() => setMutationVersion(value => value + 1), []);

  const value = useMemo<EditorialContextValue>(() => ({
    user: effectiveUser, demo, data, brand, brands, setBrand, href, toast, toasts, dismissToast, commandOpen, setCommandOpen, mutationVersion, refresh,
  }), [effectiveUser, demo, data, brand, brands, setBrand, href, toast, toasts, dismissToast, commandOpen, mutationVersion, refresh]);

  return <EditorialContext.Provider value={value}>{children}</EditorialContext.Provider>;
}
