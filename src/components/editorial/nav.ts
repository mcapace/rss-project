import { Activity, Archive, BookOpen, CalendarDays, ClipboardCheck, FileInput, FileText, House, LibraryBig, Newspaper, PenLine, Plus, Rss, Search, Star, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether the item is the current page. Query-scoped items (a content type, a state) also read the search params. */
  match: (pathname: string, search?: URLSearchParams | null) => boolean;
  /** Shows the review count. */
  badge?: "review";
  /** Hidden in the demo, where the page would need a signed-in session. */
  liveOnly?: boolean;
  keywords?: string;
};

export type NavGroup = { id: string; label: string | null; items: NavItem[] };

const libraryWith = (key: "kind" | "state", value: string) => (pathname: string, search?: URLSearchParams | null) => pathname.startsWith("/cms/library") && search?.get(key) === value;
const libraryAll = (pathname: string, search?: URLSearchParams | null) => (pathname.startsWith("/cms/library") && !search?.get("kind") && !search?.get("state")) || pathname.startsWith("/cms/doc/");

/** The content model, the way a CMS lists it: every type is one click away. */
export const CONTENT_NAV: NavItem[] = [
  { href: "/cms/library", label: "All content", icon: LibraryBig, match: libraryAll, keywords: "library documents list everything" },
  { href: "/cms/library?kind=article", label: "Articles", icon: FileText, match: libraryWith("kind", "article"), keywords: "stories features news" },
  { href: "/cms/library?kind=rating", label: "Ratings", icon: Star, match: libraryWith("kind", "rating"), keywords: "tasting notes scores reviews" },
  { href: "/cms/library?kind=page", label: "Pages", icon: BookOpen, match: libraryWith("kind", "page"), keywords: "standalone pages about contact" },
  { href: "/cms/search", label: "Search & images", icon: Search, match: p => p === "/cms/search", keywords: "find images content keywords look style media" },
];

/** Where work waits. */
export const WORKFLOW_NAV: NavItem[] = [
  { href: "/cms/review", label: "Review queue", icon: ClipboardCheck, match: p => p === "/cms/review", badge: "review", keywords: "needs review approve candidates" },
  { href: "/cms/library?state=draft", label: "Drafts", icon: PenLine, match: libraryWith("state", "draft"), keywords: "in progress unpublished work" },
  { href: "/cms/schedule", label: "Schedule", icon: CalendarDays, match: p => p === "/cms/schedule", keywords: "calendar publish dates planned" },
];

export const PRINT_NAV: NavItem[] = [
  { href: "/cms/print", label: "Print intake", icon: FileInput, match: p => p === "/cms/print" || (p.startsWith("/admin/") && p !== "/admin/new"), keywords: "issues pdf worker extraction inbox" },
  { href: "/admin/new", label: "Upload an issue", icon: Plus, match: p => p === "/admin/new", liveOnly: true, keywords: "new issue upload pdf" },
];

export const ARCHIVE_NAV: NavItem[] = [
  { href: "/cms/migration", label: "Migration inventory", icon: Archive, match: p => p === "/cms/migration", keywords: "morweb import archive sources coverage" },
  { href: "/reader", label: "Legacy RSS reader", icon: Rss, match: p => p.startsWith("/reader"), liveOnly: true, keywords: "feed bluetoad rss legacy" },
];

export const INSIGHTS_NAV: NavItem[] = [
  { href: "/cms/audience", label: "Audience", icon: Activity, match: p => p === "/cms/audience", keywords: "analytics ga4 google readers sessions traffic scorecards" },
];

export const HOME_NAV: NavItem = { href: "/cms", label: "Desk", icon: House, match: p => p === "/cms", keywords: "home desk today overview start" };

export const NAV_GROUPS: NavGroup[] = [
  { id: "top", label: null, items: [HOME_NAV] },
  { id: "content", label: "Content", items: CONTENT_NAV },
  { id: "workflow", label: "Workflow", items: WORKFLOW_NAV },
  { id: "print", label: "Print", items: PRINT_NAV },
  { id: "archive", label: "Archive", items: ARCHIVE_NAV },
  { id: "insights", label: "Insights", items: INSIGHTS_NAV },
];

/** The four sections on the mobile tab bar. */
export const MOBILE_NAV: NavItem[] = [HOME_NAV, CONTENT_NAV[0], WORKFLOW_NAV[0], WORKFLOW_NAV[2]];

/** Kept for callers that list the main pages. */
export const PRIMARY_NAV: NavItem[] = [HOME_NAV, ...CONTENT_NAV, ...WORKFLOW_NAV, ...INSIGHTS_NAV];

export const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap(group => group.items);

/** The section a path belongs to, for breadcrumbs and the mobile tab bar. */
export function sectionFor(pathname: string, search?: URLSearchParams | null): { label: string; href: string; icon: LucideIcon } {
  if (pathname.startsWith("/cms/doc/")) return { label: "All content", href: "/cms/library", icon: LibraryBig };
  if (pathname.startsWith("/admin/") && pathname !== "/admin/new") return { label: "Print intake", href: "/cms/print", icon: FileInput };
  const item = ALL_NAV.find(entry => entry.match(pathname, search));
  return item ? { label: item.label, href: item.href, icon: item.icon } : { label: "Workspace", href: "/cms", icon: Newspaper };
}
