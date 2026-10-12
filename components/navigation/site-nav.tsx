"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { leagueIdSchema } from "../../lib/league-catalog";
import { destinations, currentDestination } from "./destinations";
import { BrandMark } from "./brand-mark";
import { GroupMenu } from "./group-menu";
import styles from "./site-nav.module.css";

type NavigationAPI = { canGoBack: boolean; canGoForward: boolean; addEventListener: (type: "navigate" | "currententrychange", fn: () => void) => void; removeEventListener: (type: "navigate" | "currententrychange", fn: () => void) => void };

/** Back/forward for the page history. The desktop shell has no browser
 * chrome, and on the web the carets sit where people expect them. Chromium
 * exposes whether history exists; elsewhere both stay enabled. */
function HistoryCarets({ pathname }: { pathname: string }) {
  const [state, setState] = useState({ back: true, forward: true });
  useEffect(() => {
    const api = (window as unknown as { navigation?: NavigationAPI }).navigation;
    if (!api) return;
    const read = () => setState({ back: api.canGoBack, forward: api.canGoForward });
    read();
    api.addEventListener("currententrychange", read);
    return () => api.removeEventListener("currententrychange", read);
  }, [pathname]);
  return <div className={styles.carets} role="group" aria-label="History">
    <button type="button" className={styles.caret} onClick={() => window.history.back()} disabled={!state.back} aria-label="Back"><ChevronLeft size={16} aria-hidden="true" /></button>
    <button type="button" className={styles.caret} onClick={() => window.history.forward()} disabled={!state.forward} aria-label="Forward"><ChevronRight size={16} aria-hidden="true" /></button>
  </div>;
}

/** Persistent navigation for every page outside the workspace shell (the
 * shell renders its own header and a PagesMenu built from the same list).
 * Workspace is a plain link; the other groups are dropdowns so the bar stays
 * one short row at any width. League scope is carried through so Memory and
 * Procedures stay in the league the person came from. Inside the desktop app
 * the title bar already carries the wordmark, so this bar shows only the mark. */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // The Electron workspace view has no preload; its user agent is the signal.
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.shell = "desktop";
  }, []);
  if (pathname === "/") return null;
  const league = leagueIdSchema.safeParse(search.get("leagueId") ?? search.get("league") ?? "");
  const leagueId = league.success ? league.data : null;
  const [work, ...groups] = destinations(leagueId);
  const current = currentDestination(pathname, search);
  return <nav className={styles.bar} aria-label="Site">
    <div className={styles.inner}>
      <HistoryCarets pathname={pathname} />
      <Link href={work.items.at(-1)!.href} className={styles.brand} aria-label={leagueId ? "Softmax workspace" : "Softmax games"}><BrandMark size={18} /><span className={styles.wordmark}>Softmax</span></Link>
      <div className={styles.groups}>
        {work.items.map(item => <Link key={item.id} href={item.href} className={styles.link} title={item.description} aria-current={current === item.id ? "page" : undefined}>{item.label}</Link>)}
        {groups.map(group => <GroupMenu key={group.id} group={group} current={current} />)}
      </div>
    </div>
  </nav>;
}

export function SiteNav() {
  // useSearchParams needs a Suspense boundary so prerendered pages above it
  // can still ship static HTML; the fallback is an empty bar of the same height.
  return <Suspense fallback={<div className={styles.bar} aria-hidden="true"><div className={styles.inner} /></div>}><Bar /></Suspense>;
}
