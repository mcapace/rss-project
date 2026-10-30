/** Light, dark, or follow the device; stored per browser and applied before first paint. */
export const THEME_STORAGE_KEY = "editorial-theme";
export const THEME_ATTRIBUTE = "data-cms-theme";
export const THEME_CHANGE_EVENT = "editorial:theme";
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

/** Inline in the CMS layout so the stored theme is on <html> before the first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||((!p||p==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d){r.setAttribute("${THEME_ATTRIBUTE}","dark");r.style.colorScheme="dark"}else{r.removeAttribute("${THEME_ATTRIBUTE}");r.style.colorScheme="light"}}catch(e){}})();`;
