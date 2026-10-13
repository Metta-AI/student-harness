import { workspaceURL } from "../../lib/league-catalog";

/** One shared map of where a person can go in the IDE. Groups are the
 * mental model: the work itself, what Preston knows, the computers Preston
 * can use, and the account. Every surface renders from this list so the
 * same destinations appear in the same order everywhere. */
export type Destination = { id: string; label: string; href: string; description: string; external?: boolean };
export type DestinationGroup = { id: "work" | "brain" | "computers" | "account"; label: string; items: Destination[] };

const scoped = (path: string, leagueId: string | null) => leagueId ? `${path}?${new URLSearchParams({ leagueId })}` : path;

export function destinations(leagueId: string | null): DestinationGroup[] {
  return [
    { id: "work", label: "Work", items: [
      { id: "games", label: "Games", href: "/", description: "Choose a game or league to work in; each has its own workspace." },
      ...(leagueId ? [{ id: "workspace", label: "Workspace", href: workspaceURL(leagueId), description: "Play, review replays and develop the policy with Preston." }] : []),
    ] },
    { id: "brain", label: "Preston’s brain", items: [
      { id: "memory", label: "Shared memory", href: scoped("/memory", leagueId), description: "What we have retained: hypotheses, lessons, corrections and disagreements." },
      { id: "skills", label: "Learned procedures", href: scoped("/skills", leagueId), description: "Ways of working Preston proposed from our lessons, with evidence." },
      { id: "updates", label: "Updates", href: "/updates", description: "Findings Preston saved between visits, and why it spoke or stayed quiet." },
    ] },
    { id: "computers", label: "Computers", items: [
      { id: "browser", label: "Browser", href: "/browser", description: "An isolated browser Preston can operate when you hand it control." },
      { id: "computer", label: "Desktop", href: "/computer", description: "An isolated Linux desktop for longer work." },
    ] },
    { id: "account", label: "Account", items: [
      { id: "connections", label: "Connections", href: "/connections", description: "Repository and tool connections Preston may use." },
      { id: "integrations", label: "External sources", href: "/integrations", description: "Signed observations from outside systems." },
      { id: "usage", label: "Usage", href: "/usage", description: "Daily credits: spent, reserved and when they reset." },
      { id: "settings", label: "Settings", href: "/settings", description: "How you and Preston work together." },
    ] },
  ];
}

/** Which destination the current URL belongs to, by longest matching path. */
export function currentDestination(pathname: string, search: URLSearchParams): string | null {
  if (pathname === "/") return search.has("league") ? "workspace" : "games";
  const first = pathname.split("/")[1];
  const byPrefix: Record<string, string> = { memory: "memory", skills: "skills", learn: "memory", updates: "updates", browser: "browser", computer: "computer", connections: "connections", "connection-reads": "connections", integrations: "integrations", usage: "usage", settings: "settings", activity: "updates", sessions: "workspace", moments: "memory", "container-policy": "workspace" };
  return byPrefix[first] ?? null;
}
