"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_ATTRIBUTE, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, isThemePreference, resolveTheme, type ThemePreference } from "@/lib/editorial/theme";

/** Debounce a changing value. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export type AsyncState<T> = { data: T | null; error: string | null; loading: boolean; refreshing: boolean; reload: () => void };

/**
 * Load data for a key. Keeps the last result visible while a new request runs,
 * aborts stale requests, and exposes a manual reload.
 */
export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>, options: { enabled?: boolean; refreshToken?: number } = {}): AsyncState<T> {
  const { enabled = true, refreshToken = 0 } = options;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean; refreshing: boolean }>({ key: "", data: null, error: null, loading: enabled, refreshing: false });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starting a request for a new key is the effect's job.
    setState(previous => ({ ...previous, loading: previous.key !== key, refreshing: previous.key === key, error: previous.key === key ? previous.error : null }));
    loadRef.current(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ key, data, error: null, loading: false, refreshing: false }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(previous => ({ key, data: previous.key === key ? previous.data : null, error: error instanceof Error ? error.message : "Something went wrong.", loading: false, refreshing: false }));
      });
    return () => controller.abort();
  }, [key, enabled, tick, refreshToken]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  return { data: state.key === key ? state.data : state.data, error: state.error, loading: state.loading, refreshing: state.refreshing, reload };
}

/** A value kept in localStorage, read after mount so server and client agree on the first paint. */
export function useStoredState<T>(key: string, initial: T, validate?: (value: unknown) => value is T): [T, (next: T | ((previous: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser storage is only readable after mount.
        if (!validate || validate(parsed)) setValue(parsed as T);
      }
    } catch { /* Fall back to the initial value. */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The validator is stable by convention.
  }, [key]);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    setValue(previous => {
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
      try { window.localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* Keep the value for this visit only. */ }
      return resolved;
    });
  }, [key]);
  return [value, update, loaded];
}

function storedPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  const dark = resolveTheme(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false) === "dark";
  if (dark) root.setAttribute(THEME_ATTRIBUTE, "dark"); else root.removeAttribute(THEME_ATTRIBUTE);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The stored choice is only readable after mount.
    setPreference(storedPreference());
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = () => { const next = storedPreference(); setPreference(next); applyTheme(next); };
    media?.addEventListener("change", sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { media?.removeEventListener("change", sync); window.removeEventListener(THEME_CHANGE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const choose = useCallback((next: ThemePreference) => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* applies for this visit only */ }
    setPreference(next);
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);
  const toggle = useCallback(() => {
    choose(document.documentElement.getAttribute(THEME_ATTRIBUTE) === "dark" ? "light" : "dark");
  }, [choose]);
  return { preference, choose, toggle };
}

/** Close on Escape or a pointer press outside the referenced element. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  return ref;
}

/** Lock body scroll and trap focus while a layer is open. */
export function useLayer(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    const first = focusable()[0];
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const start = items[0], end = items[items.length - 1];
      if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end.focus(); }
      else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [open, onClose]);
  return ref;
}

/** True once the component has mounted in the browser. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard.
  useEffect(() => setMounted(true), []);
  return mounted;
}
