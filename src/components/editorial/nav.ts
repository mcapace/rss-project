import { Activity, Archive, CalendarDays, ClipboardCheck, FileInput, House, LibraryBig, Newspaper, Plus, Rss, Search, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
  /** Shows the review count. */
  badge?: "review";
  /** Hidden in the demo, where the page would need a signed-in session. */
  liveOnly?: boolean;
  keywords?: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/cms", label: "Home", icon: House, match: p => p === "/cms", keywords: "desk today overview start" },
  { href: "/cms/library", label: "Content library", icon: LibraryBig, match: p => p.startsWith("/cms/library") || p.startsWith("/cms/doc/"), keywords: "articles ratings pages documents search list" },
  { href: "/cms/review", label: "Review queue", icon: ClipboardCheck, match: p => p === "/cms/review", badge: "review", keywords: "needs review approve candidates" },
  { href: "/cms/schedule", label: "Schedule", icon: CalendarDays, match: p => p === "/cms/schedule", keywords: "calendar publish dates planned" },
  { href: "/cms/search", label: "Search", icon: Search, match: p => p === "/cms/search", keywords: "find images content keywords look style" },
  { href: "/cms/audience", label: "Audience", icon: Activity, match: p => p === "/cms/audience", keywords: "analytics ga4 google readers sessions traffic scorecards" },
];

export const PRINT_NAV: NavItem[] = [
  { href: "/cms/print", label: "Print intake", icon: FileInput, match: p => p === "/cms/print", keywords: "issues pdf worker extraction inbox" },
  { href: "/admin/new", label: "Upload an issue", icon: Plus, match: p => p === "/admin/new", liveOnly: true, keywords: "new issue upload pdf" },
];

export const ARCHIVE_NAV: NavItem[] = [
  { href: "/cms/migration", label: "Migration inventory", icon: Archive, match: p => p === "/cms/migration", keywords: "morweb import archive sources coverage" },
  { href: "/reader", label: "Legacy RSS reader", icon: Rss, match: p => p.startsWith("/reader"), liveOnly: true, keywords: "feed bluetoad rss legacy" },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...PRINT_NAV, ...ARCHIVE_NAV];

/** The section a path belongs to, for breadcrumbs and the mobile tab bar. */
export function sectionFor(pathname: string): { label: string; href: string; icon: LucideIcon } {
  if (pathname.startsWith("/cms/doc/")) return { label: "Content library", href: "/cms/library", icon: LibraryBig };
  const item = ALL_NAV.find(entry => entry.match(pathname));
  return item ? { label: item.label, href: item.href, icon: item.icon } : { label: "Workspace", href: "/cms", icon: Newspaper };
}
