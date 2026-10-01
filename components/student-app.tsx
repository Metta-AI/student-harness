"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import type { PolicyRevision } from "../lib/semantic-ir";
import { episodeScore, policyScore } from "../lib/policy-metrics";
import type { LeagueEpisodeSummary } from "../lib/league-episodes";
import { SemanticPolicy } from "./semantic-policy";
import { ReplayCoaching } from "./replay-coaching";
import { Chat, type AnalysisRequest, type ChatReference, type StarterPrompt } from "./chat";
import { ReplayFrame } from "./replay-frame";
import { identifyStudent, resetAnalytics, track } from "../lib/analytics";
import { events } from "../lib/analytics-events";

type WorkspaceVersion = {
  id: string; revision: number; summary: string; created_at: string;
  policyVersionId: string | null; label: string | null; player: string | null; games: number; hostedMean: number | null; scored: number;
  completedGames: number; meanDeaths: number | null; deathSamples: number;
};
type WorkspaceExperiment = { xpRequestId: string; title: string; status: string; created_at: string; completed_at: string | null; revision: number | null; completedGames: number; score: number | null; replayReady: boolean };
type Workspace = {
  versions: WorkspaceVersion[]; experiments: WorkspaceExperiment[];
  latest: PolicyRevision | null; latestUpload: { policyVersionId: string; label: string; player: string | null } | null;
  /** The Softmax player the next upload is credited to. */
  player: { id: string; name: string } | null;
  draft: { updated_at: string; bytes: number; conflict: boolean } | null;
};
type Notice = { id: string; title: string; detail: string; at: string; kind: "info" | "success" | "error" };

type League = { id: string; name: string; url: string };
type ArenaEpisode = {
  id: string; status: string; replay_url: string | null; live_url: string | null;
  episode_id: string | null; error: string | null; job_index: number | null; completed_at: string | null; created_at: string;
  run_id: string; run_title: string | null; coworld_id: string;
  scores: { policy_version_id: string; score: number }[];
  participant_scores: { position: number; score: number }[];
};
type CoachingSession = {
  id: string; episode_id: string; status: string; created_at: string; duration_ms: number | null;
  latest_analysis: { id: string; status: string } | null;
  feed: { summary: string | null; quote: string | null; insights: string[] } | null;
};
type ArenaData = {
  league: { rounds_paused_at: string | null };
  episodes: ArenaEpisode[];
};
type LeaguePolicy = {
  rank: number; policy_version_id: string; policy_label: string; score: number;
  wins: number; episodes_played: number; win_rate: number; rounds_played: number;
};
type PolicyStats = { division: string; windowHours: number; policies: LeaguePolicy[]; entered: string[] };
/** One league-round episode from the selected policy version's point of view. */
type LeagueEpisode = LeagueEpisodeSummary & {
  id: string; status: string; created_at: string; replay_url: string | null; error: string | null;
  round: { id: string; number: number };
};
type LeagueFeed = { policyVersionId: string; episodes: LeagueEpisode[]; nextCursor: string | null };
const leagueStatusLabel: Record<string, string> = { pending: "Queued", submitted: "Queued", running: "Running", failed: "Failed", cancelled: "Cancelled", canceled: "Cancelled" };
const leagueOutcomeLabel = { won: "Won", lost: "Lost", time_limit: "Time limit" } as const;
function leagueAgainst(episode: LeagueEpisode) {
  if (!episode.opponents.length) return "—";
  if (episode.format === "team" && episode.opponents.length === 1) return episode.opponents[0].player ?? episode.opponents[0].policy;
  // Mixed teams: several players per side. Name the first two so the row is still recognizable.
  const names = episode.opponents.map((rival) => rival.player ?? rival.policy);
  return `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
}
function leagueRoster(episode: LeagueEpisode) {
  const names = (group: LeagueEpisode["opponents"]) => group.map((rival) => `${rival.player ?? "Unknown player"} (${rival.policy})`).join(", ");
  return `Against: ${names(episode.opponents) || "nobody"}${episode.teammates.length ? `. Same side: ${names(episode.teammates)}` : ""}`;
}
type MatchStats = { steps: number | null; game_stats: Record<string, number>; policy_stats: { position: number; policy_name: string | null; avg_reward: number; avg_metrics: Record<string, number> }[] };
type ReplaySnapshot = { id: string; games: number; windowStart: string; windowEnd: string; record: { wins: number; losses: number; draws: number }; values: Record<string, number> };
type SortKey = "episode" | "policy" | "played" | "score" | "winRate";
const tableColumns: { key: SortKey; label: string }[] = [
  { key: "episode", label: "Episode" }, { key: "policy", label: "Policy" },
  { key: "played", label: "Played" }, { key: "score", label: "Score" },
  { key: "winRate", label: "Policy win %" },
];
function episodePolicyId(episode: ArenaEpisode) {
  return episode.scores.length === 1 ? episode.scores[0].policy_version_id : null;
}

export function StudentApp({ league }: { league: League }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [seenNotices, setSeenNotices] = useState<string[]>([]);
  const [noticesReady, setNoticesReady] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState<Notice | null>(null);
  const previousNoticeIds = useRef<Set<string> | null>(null);
  const [viewRevision, setViewRevision] = useState<number | null>(null);
  const [viewed, setViewed] = useState<{ revision: PolicyRevision; upload: { policyVersionId: string; label: string | null; player: string | null } | null } | null>(null);
  const [submission, setSubmission] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [starterRevision, setStarterRevision] = useState<PolicyRevision | null>(null);
  const [activeTab, setActiveTab] = useState<"episodes" | "policy">("episodes");
  const [arena, setArena] = useState<ArenaData | null>(null);
  const [arenaError, setArenaError] = useState("");
  const [episodes, setEpisodes] = useState<ArenaEpisode[]>([]);
  const [policyStats, setPolicyStats] = useState<PolicyStats | null>(null);
  const [policyStatsError, setPolicyStatsError] = useState("");
  const [replaySnapshot, setReplaySnapshot] = useState<ReplaySnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "played", direction: "desc" });
  const [coaching, setCoaching] = useState<CoachingSession[]>([]);
  const [coachingLoaded, setCoachingLoaded] = useState(false);
  const [coachingAvailable, setCoachingAvailable] = useState(false);
  const [coachingError, setCoachingError] = useState("");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  // League rounds and hosted practice games are different things, listed separately. null follows the data.
  const [matchView, setMatchView] = useState<"league" | "practice" | null>(null);
  const [leagueFeed, setLeagueFeed] = useState<LeagueFeed | null>(null);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueError, setLeagueError] = useState("");
  const [leagueSelection, setLeagueSelection] = useState<{ id: string; policyVersionId: string; label: string } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; ready: boolean } | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replayNote, setReplayNote] = useState("");
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null);
  const [matchStatsError, setMatchStatsError] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest | null>(null);
  const [recordingCoaching, setRecordingCoaching] = useState(false);
  const replayPanelRef = useRef<HTMLElement>(null);
  // Chat / workspace split: remembered per browser, stacked instead of split on narrow screens.
  const splitKey = "softmax-ide-split";
  const [splitLayout] = useState<Layout | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    try { const raw = window.localStorage.getItem(splitKey); return raw ? (JSON.parse(raw) as Layout) : undefined; } catch { return undefined; }
  });
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const rememberSplit = useCallback((layout: Layout, meta?: { isUserInteraction?: boolean }) => {
    try { window.localStorage.setItem(splitKey, JSON.stringify(layout)); } catch { /* storage unavailable */ }
    if (meta?.isUserInteraction) track(events.splitResized, { chat_percent: Math.round(layout.chat ?? 0) });
  }, []);
  const [focusCoachingId, setFocusCoachingId] = useState<string | undefined>(undefined);
  const openReference = useCallback((reference: ChatReference) => {
    setActiveTab("episodes");
    setViewer(null);
    if (reference.kind === "league-episode" && reference.policyVersionId) {
      setMatchView("league");
      setSelectedPolicyId(reference.policyVersionId);
      setSelectedEpisodeId("");
      setLeagueSelection({ id: reference.episodeId, policyVersionId: reference.policyVersionId, label: reference.label });
      setReplayError("");
      track(events.replayOpened, { episode_id: reference.episodeId, source: "reference", league: true });
      window.setTimeout(() => replayPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    setMatchView("practice");
    setLeagueSelection(null);
    setSelectedPolicyId("");
    setSelectedEpisodeId(reference.episodeId);
    setReplayError("");
    setFocusCoachingId(reference.coachingSessionId);
    track(events.replayOpened, { episode_id: reference.episodeId, run_id: reference.runId, source: "reference" });
    window.setTimeout(() => replayPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === replayPanelRef.current && replayPanelRef.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const panel = replayPanelRef.current;
    if (!panel) return;
    track(events.replayFullscreen, { entering: !document.fullscreenElement });
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panel.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  }, []);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  // Tool results refresh the workspace panel; a finished turn also refreshes the arena feeds.
  const onActivity = useCallback((kind: "tool" | "turn") => {
    setWorkspaceKey((key) => key + 1);
    if (kind === "turn") setRefreshKey((key) => key + 1);
  }, []);
  const onChatNotice = useCallback((title: string, detail: string) => setToast({ id: `chat:${Date.now()}`, title, detail, at: new Date().toISOString(), kind: "error" }), []);

  useEffect(() => {
    fetch("/api/session").then((response) => response.json()).then((data) => { setEmail(data.email); if (data.email && data.subjectId) { setSubjectId(data.subjectId); identifyStudent(data.subjectId, data.email); } });
    fetch("/api/starter-policy").then((response) => response.json()).then(setStarterRevision);
  }, []);

  useEffect(() => {
    if (!subjectId) return;
    setSeenNotices(JSON.parse(window.localStorage.getItem(`student-harness-notices:${subjectId}`) ?? "[]") as string[]);
    setNoticesReady(true);
  }, [subjectId]);

  const notices = useMemo((): Notice[] => {
    if (!workspace) return [];
    const items: Notice[] = [];
    for (const version of workspace.versions) {
      items.push({ id: `saved:${version.id}`, title: `Revision r${version.revision} saved`, detail: version.summary, at: version.created_at, kind: "success" });
      if (version.policyVersionId) items.push({ id: `uploaded:${version.id}`, title: `Revision r${version.revision} uploaded`, detail: version.label ?? "Ready to enter the league", at: version.created_at, kind: "success" });
    }
    for (const game of workspace.experiments) {
      const label = game.revision ? `r${game.revision}` : "your policy";
      items.push({ id: `requested:${game.xpRequestId}`, title: `Hosted game requested for ${label}`, detail: game.title, at: game.created_at, kind: "info" });
      if (["completed", "failed", "canceled", "cancelled"].includes(game.status)) {
        items.push({ id: `finished:${game.xpRequestId}:${game.status}`, title: game.status === "completed" ? `Hosted game complete for ${label}` : `Hosted game ${game.status} for ${label}`, detail: game.status === "completed" ? `${game.completedGames} game${game.completedGames === 1 ? "" : "s"} completed${game.score === null ? "" : ` · mean score ${game.score.toFixed(1)}`}` : game.title, at: game.completed_at ?? game.created_at, kind: game.status === "completed" ? "success" : "error" });
        if (game.replayReady) items.push({ id: `replay:${game.xpRequestId}`, title: `Replay ready for ${label}`, detail: "Open Matches to watch and coach your hero.", at: game.completed_at ?? game.created_at, kind: "success" });
      }
    }
    if (workspace.draft) items.push({ id: "unsaved-draft", title: "Policy edit kept as draft", detail: "Ask the agent to finish saving this change. It will be here if you reopen chat.", at: workspace.draft.updated_at, kind: "info" });
    for (const session of coaching) {
      items.push({ id: `coaching:${session.id}`, title: "Replay coaching recorded", detail: "Your recording is saved for policy review.", at: session.created_at, kind: "info" });
      if (session.latest_analysis?.status === "complete") items.push({ id: `coaching-ready:${session.id}`, title: "Coaching ideas ready", detail: "Open this replay to discuss and apply the suggestions.", at: session.created_at, kind: "success" });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  }, [workspace, coaching]);
  useEffect(() => {
    if (!subjectId || !noticesReady || !workspace || !coachingLoaded) return;
    const key = `student-harness-notices:${subjectId}`;
    if (window.localStorage.getItem(key) !== null) return;
    const ids = notices.map((notice) => notice.id);
    window.localStorage.setItem(key, JSON.stringify(ids));
    setSeenNotices(ids);
  }, [subjectId, noticesReady, workspace, coachingLoaded, notices]);
  useEffect(() => {
    if (!noticesReady || !workspace || !coachingLoaded) return;
    const ids = new Set(notices.map((notice) => notice.id));
    if (previousNoticeIds.current) {
      const fresh = notices.filter((notice) => !previousNoticeIds.current!.has(notice.id));
      if (fresh.length) setToast(fresh[0]);
    }
    previousNoticeIds.current = ids;
  }, [notices, noticesReady, workspace, coachingLoaded]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 6500); return () => window.clearTimeout(timer); }, [toast]);
  const unread = notices.filter((notice) => !seenNotices.includes(notice.id)).length;
  function markNoticesRead() {
    const ids = notices.map((notice) => notice.id);
    setSeenNotices(ids);
    window.localStorage.setItem(`student-harness-notices:${subjectId}`, JSON.stringify(ids));
  }

  useEffect(() => {
    if (!email) return;
    const refresh = () => fetch("/api/workspace").then(async (response) => {
      const data = await response.json();
      if (response.ok) setWorkspace(data);
    }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey, workspaceKey]);

  useEffect(() => {
    if (!email) return;
    const refresh = () => fetch("/api/arena").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load episodes");
      setArena(data);
      setEpisodes(data.episodes);
      setArenaError("");
    }).catch((cause: Error) => setArenaError(cause.message));
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email) return;
    const refresh = () => fetch("/api/coaching").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load coaching");
      setCoaching(data.sessions);
      setCoachingAvailable(data.available);
      setCoachingError("");
      setCoachingLoaded(true);
    }).catch((cause: Error) => { setCoachingError(cause.message); setCoachingLoaded(true); });
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email) return;
    const refresh = () => fetch("/api/policy-stats").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load league policy results");
      setPolicyStats(data);
      setPolicyStatsError("");
    }).catch((cause: Error) => setPolicyStatsError(cause.message));
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email || viewRevision === null) { setViewed(null); return; }
    let cancelled = false;
    fetch(`/api/workspace?revision=${viewRevision}`).then(async (response) => {
      const data = await response.json();
      if (!cancelled && response.ok) setViewed(data);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [email, viewRevision]);
  const latestUpload = workspace?.latestUpload ?? null;
  const currentRevision = viewed?.revision ?? workspace?.latest ?? starterRevision;
  const latestSavedVersion = workspace?.versions.at(-1);
  const latestSavedUpload = latestSavedVersion?.policyVersionId ? { policyVersionId: latestSavedVersion.policyVersionId, label: latestSavedVersion.label ?? latestSavedVersion.policyVersionId, player: latestSavedVersion.player } : null;
  const defaultPlayer = workspace?.player?.name ?? null;
  const currentUpload = viewRevision === null ? latestSavedUpload : viewed?.upload ?? null;
  const pendingExperiments = workspace?.experiments.filter((experiment) => !["completed", "failed", "canceled", "cancelled"].includes(experiment.status)) ?? [];
  const latestGames = workspace?.experiments.filter((game) => game.revision === workspace.latest?.ir.update.revision) ?? [];
  const resumePolicy = workspace?.draft ? { label: "Finish draft", text: workspace.draft.conflict ? "Merge my older draft/conflicting-hero.bas into the latest saved hero.bas without losing newer changes. Then save, upload, and request one hosted game." : "Finish saving my unsaved hero.bas draft, then upload it and request a hosted game. Check git diff first so you preserve my edit." }
    : workspace?.latest && !latestSavedUpload ? { label: "Upload + play", text: `Revision r${workspace.latest.ir.update.revision} is saved but not uploaded. Upload that revision without editing or resaving, then request one hosted game in the NeuralHub league.` }
    : workspace?.latest && !latestGames.some((game) => game.status === "completed" || !["failed", "canceled", "cancelled"].includes(game.status)) ? { label: latestGames.length ? "Retry hosted game" : "Play hosted game", text: `Use my latest saved revision r${workspace.latest.ir.update.revision}. Upload it if needed and request one hosted game in the NeuralHub league. Do not edit or resave the policy.` } : null;
  const starterPrompt: StarterPrompt | null = workspace && workspace.versions.length === 0 ? {
    label: "Create and upload my starter policy",
    detail: "The official starter hero.bas already plays a full match. Save it as revision 1, upload it to Softmax, and play one hosted game so every later change has a baseline to beat.",
    text: "Create my first policy: save the official starter hero.bas as revision 1 without changes, upload it to Softmax, and run one baseline hosted game so I have something to compare against. Then propose the first change I could try.",
  } : null;
  const chatSuggestions = (() => {
    const versions = workspace?.versions ?? [];
    if (pendingExperiments.length) return ["Check the running hosted game", "Plan the next change to hero.bas while we wait", "Which part of hero.bas decides when my hero retreats?"];
    if (!versions.length) return ["Create and upload my starter policy", "Make my hero retreat earlier when its health is low", "Explain what the starter policy does in a team fight"];
    if (!currentUpload) return ["Upload the latest revision and play one hosted game", "Show me what the latest revision changed in hero.bas", "Change one thing: prioritize towers over kills"];
    return ["What do the latest hosted results say about my policy?", "Suggest one testable change to hero.bas", "Compare my revisions and keep the best one"];
  })();

  const boardByPolicy = new Map(policyStats?.policies.map((policy) => [policy.policy_version_id, policy]));
  const policyIds = [...new Set(episodes.flatMap((episode) => episode.scores.map((score) => score.policy_version_id)))];
  const uploadedVersions = [...(workspace?.versions ?? [])].reverse().filter((version): version is WorkspaceVersion & { policyVersionId: string } => !!version.policyVersionId);
  const versionByPolicy = new Map(uploadedVersions.map((version) => [version.policyVersionId, version]));
  const entered = new Set(policyStats?.entered ?? []);
  // The newest revision entered in the league is what this page is about unless the student picks another.
  const leagueEntry = uploadedVersions.find((version) => entered.has(version.policyVersionId)) ?? null;
  const activePolicyId = selectedPolicyId || leagueEntry?.policyVersionId || latestUpload?.policyVersionId || policyIds[0] || "";
  const activeVersion = versionByPolicy.get(activePolicyId) ?? null;
  const policyLabel = (id: string) => {
    const version = versionByPolicy.get(id);
    if (version) return `r${version.revision} · ${version.label ?? id.slice(0, 8)}`;
    return boardByPolicy.get(id)?.policy_label ?? `Policy ${id.slice(0, 8)}`;
  };
  const activePlayer = activeVersion?.player ?? defaultPlayer;
  const leaguePolicyId = activeVersion?.policyVersionId ?? "";
  useEffect(() => {
    if (!email || !leaguePolicyId) { setLeagueFeed(null); return; }
    let cancelled = false;
    setLeagueFeed((feed) => (feed?.policyVersionId === leaguePolicyId ? feed : null));
    setLeagueError("");
    const refresh = () => fetch(`/api/league-episodes?policyVersionId=${leaguePolicyId}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load league episodes");
      if (cancelled) return;
      const newest = data.episodes as LeagueEpisode[];
      setLeagueError("");
      setLeagueFeed((feed) => {
        if (feed?.policyVersionId !== leaguePolicyId) return { policyVersionId: leaguePolicyId, episodes: newest, nextCursor: data.nextCursor };
        // Keep older pages the student already loaded; the first page only brings in what is new.
        const seen = new Set(newest.map((episode) => episode.id));
        const older = feed.episodes.filter((episode) => !seen.has(episode.id));
        return { policyVersionId: leaguePolicyId, episodes: [...newest, ...older], nextCursor: older.length ? feed.nextCursor : data.nextCursor };
      });
    }).catch((cause: Error) => { if (!cancelled) setLeagueError(cause.message); });
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [email, leaguePolicyId, refreshKey]);
  function loadMoreLeague() {
    if (!leagueFeed?.nextCursor || leagueLoading) return;
    const { policyVersionId, nextCursor } = leagueFeed;
    setLeagueLoading(true);
    fetch(`/api/league-episodes?policyVersionId=${policyVersionId}&cursor=${encodeURIComponent(nextCursor)}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load more league episodes");
      setLeagueError("");
      setLeagueFeed((feed) => {
        if (feed?.policyVersionId !== policyVersionId || feed.nextCursor !== nextCursor) return feed;
        const seen = new Set(feed.episodes.map((episode) => episode.id));
        return { policyVersionId, episodes: [...feed.episodes, ...(data.episodes as LeagueEpisode[]).filter((episode) => !seen.has(episode.id))], nextCursor: data.nextCursor };
      });
      track(events.tabViewed, { tab: "league-rounds-more" });
    }).catch((cause: Error) => setLeagueError(cause.message)).finally(() => setLeagueLoading(false));
  }
  const leagueRows = leagueFeed?.policyVersionId === leaguePolicyId ? leagueFeed.episodes : [];
  const leagueReady = !!leagueFeed && leagueFeed.policyVersionId === leaguePolicyId;
  const leagueDecided = leagueRows.filter((episode) => episode.outcome);
  const leagueTally = { won: leagueDecided.filter((episode) => episode.outcome === "won").length, lost: leagueDecided.filter((episode) => episode.outcome === "lost").length, time_limit: leagueDecided.filter((episode) => episode.outcome === "time_limit").length };
  const view = matchView ?? (leagueReady && !leagueRows.length && episodes.length ? "practice" : "league");
  const selectedLeagueEpisode = leagueSelection ? leagueRows.find((episode) => episode.id === leagueSelection.id) : undefined;
  function openLeagueEpisode(episode: LeagueEpisode) {
    if (!leaguePolicyId) return;
    setSelectedEpisodeId("");
    setLeagueSelection({ id: episode.id, policyVersionId: leaguePolicyId, label: `League round #${episode.round.number} · ${episode.side ?? "both sides"} vs ${leagueAgainst(episode)}` });
    setViewer(null); setReplayError(""); setReplayNote("");
    track(events.replayOpened, { episode_id: episode.id, status: episode.status, source: "league-table", league: true });
    window.setTimeout(() => replayPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }
  useEffect(() => {
    if (!email || !activePolicyId) return;
    let cancelled = false;
    setReplaySnapshot(null);
    setSnapshotError("");
    fetch(`/api/replay-snapshot?policyId=${encodeURIComponent(activePolicyId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the replay snapshot");
        return data;
      })
      .then((data) => { if (!cancelled) setReplaySnapshot(data.snapshot ?? null); })
      .catch((cause: Error) => { if (!cancelled) setSnapshotError(cause.message); });
    return () => { cancelled = true; };
  }, [email, activePolicyId]);
  const activeStanding = boardByPolicy.get(activePolicyId);
  const activeEpisodes = episodes.filter((episode) => episode.scores.some((score) => score.policy_version_id === activePolicyId));
  const activeScores = activeEpisodes.map((episode) => policyScore(episode, activePolicyId)).filter((score): score is number => score !== null);
  const hostedMean = activeScores.length ? activeScores.reduce((total, score) => total + score, 0) / activeScores.length : null;
  const latestActiveEpisode = activeEpisodes.find((episode) => episode.status === "completed");
  const visibleEpisodes = episodes.filter((episode) => !selectedPolicyId || episode.scores.some((score) => score.policy_version_id === selectedPolicyId));
  const sortedEpisodes = [...visibleEpisodes].sort((a, b) => {
    const value = (episode: ArenaEpisode): string | number | null => {
      const policyId = episodePolicyId(episode);
      if (sort.key === "episode") return (episode.job_index ?? 0) + 1;
      if (sort.key === "policy") return selectedPolicyId ? boardByPolicy.get(selectedPolicyId)?.policy_label ?? selectedPolicyId : policyId ? boardByPolicy.get(policyId)?.policy_label ?? policyId : "Mixed";
      if (sort.key === "played") return new Date(episode.completed_at ?? episode.created_at).getTime();
      if (sort.key === "score") return selectedPolicyId ? policyScore(episode, selectedPolicyId) : episodeScore(episode);
      if (sort.key === "winRate") return boardByPolicy.get(selectedPolicyId || policyId || "")?.win_rate ?? null;
      return null;
    };
    const left = value(a);
    const right = value(b);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return (sort.direction === "asc" ? comparison : -comparison) || a.id.localeCompare(b.id);
  });

  function sortBy(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  }

  const selectedEpisode = leagueSelection ? undefined : episodes.find((episode) => episode.id === selectedEpisodeId);
  // What the replay panel is showing: a hosted practice game (owned through its run) or a league episode
  // (owned through the student's policy version that played in it).
  const replayId = leagueSelection?.id ?? selectedEpisode?.id ?? "";
  const replayOwner = leagueSelection ? `policyVersionId=${leagueSelection.policyVersionId}` : selectedEpisode ? `runId=${selectedEpisode.run_id}` : "";
  const replayAvailable = leagueSelection ? true : !!selectedEpisode?.replay_url;
  const replayCompleted = leagueSelection ? true : selectedEpisode?.status === "completed";
  const selectedCoaching = coaching.find((item) => item.episode_id === selectedEpisode?.episode_id);

  useEffect(() => {
    if (!replayId || !replayAvailable) return;
    let cancelled = false;
    fetch("/api/replay-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(new URLSearchParams(replayOwner)), episodeId: replayId }),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open replay");
      if (!cancelled) setViewer({ url: data.viewer_url, ready: data.ready });
    }).catch((cause: Error) => { if (!cancelled) setReplayError(cause.message); });
    return () => { cancelled = true; };
  }, [replayId, replayAvailable, replayOwner]);

  useEffect(() => {
    if (!replayId || !replayCompleted) return;
    let cancelled = false;
    setMatchStats(null);
    setMatchStatsError("");
    fetch(`/api/episode-stats?${replayOwner}&episodeId=${encodeURIComponent(replayId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load match statistics");
        return data;
      }).then((data) => { if (!cancelled) setMatchStats(data); })
      .catch((cause: Error) => { if (!cancelled) setMatchStatsError(cause.message); });
    return () => { cancelled = true; };
  }, [replayId, replayCompleted, replayOwner]);

  useEffect(() => {
    if (!viewer || viewer.ready) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      fetch(`/api/replay-session?viewerUrl=${encodeURIComponent(viewer.url)}`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Replay failed to start");
        if (!cancelled && data.ready) { setReplayError(""); setViewer({ url: viewer.url, ready: true }); }
      }).catch((cause: Error) => { if (!cancelled) setReplayError(cause.message); });
    }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [viewer]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not sign in"); return; }
    setToken("");
    setEmail(data.email);
    if (data.subjectId) identifyStudent(data.subjectId, data.email);
    track(events.signedIn, {});
  }

  async function signOut() {
    track(events.signedOut, {});
    await fetch("/api/session", { method: "DELETE" });
    resetAnalytics();
    setEmail(null);
    setSubjectId("");
    setNoticesReady(false);
    previousNoticeIds.current = null;
    setWorkspace(null);
    setViewRevision(null);
    setSubmission("");
    setArena(null);
    setEpisodes([]);
    setPolicyStats(null);
    setPolicyStatsError("");
    setReplaySnapshot(null);
    setSnapshotError("");
    setSelectedPolicyId("");
    setSelectedEpisodeId("");
    setLeagueFeed(null);
    setLeagueSelection(null);
    setMatchView(null);
    setViewer(null);
    setCoaching([]);
    setCoachingLoaded(false);
    setCoachingError("");
    setReplayNote("");
    setMatchStats(null);
    setMatchStatsError("");
    setAnalysisRequest(null);
    setRecordingCoaching(false);
  }

  async function enterLeague() {
    const policyVersionId = currentUpload?.policyVersionId;
    if (!policyVersionId) return;
    track(events.leagueEntered, { source: "ui", revision: currentRevision?.ir.update.revision });
    const response = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policyVersionId }) });
    const data = await response.json();
    if (response.ok) setRefreshKey((key) => key + 1);
    const entrant = (data.player?.name as string | undefined) ?? currentUpload?.player;
    const message = response.ok ? `${currentUpload?.label ?? "Entry"}${entrant ? ` entered as player ${entrant}` : " entered"}: ${data.status}` : data.error ?? "Submission failed";
    setSubmission(message);
    setToast({ id: `submission:${Date.now()}`, title: response.ok ? "League entry placed" : "League entry failed", detail: message, at: new Date().toISOString(), kind: response.ok ? "success" : "error" });
  }

  async function discardDraft() {
    const response = await fetch("/api/workspace", { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setToast({ id: `draft-error:${Date.now()}`, title: "Could not discard draft", detail: data.error ?? "Try again", at: new Date().toISOString(), kind: "error" }); return; }
    setWorkspaceKey((key) => key + 1);
    track(events.draftDiscarded, { conflict: workspace?.draft?.conflict ?? false });
    setToast({ id: `draft-discarded:${Date.now()}`, title: "Draft discarded", detail: "Your saved revisions are unchanged.", at: new Date().toISOString(), kind: "info" });
  }

  function downloadPolicy() {
    if (!currentRevision) return;
    track(events.policyDownloaded, { format: "basic", revision: currentRevision.ir.update.revision });
    const url = URL.createObjectURL(new Blob([currentRevision.source], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hero.bas";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadRevision() {
    const revision = currentRevision;
    if (!revision) return;
    track(events.policyDownloaded, { format: "ir+basic", revision: revision.ir.update.revision });
    const url = URL.createObjectURL(new Blob([JSON.stringify(revision, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hero-revision-${revision.ir.update.revision}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function discussReplay(episode: ArenaEpisode) {
    const note = replayNote.trim();
    if (!note) return;
    track(events.replayNoteDiscussed, { episode_id: episode.id, note_length: note.length });
    setAnalysisRequest({
      id: Date.now(),
      text: `I watched this replay and noticed: ${note}`,
      context: { kind: "replay-note", xp_request_id: episode.run_id, episode_id: episode.id, hint: "Use coaching_feedback with this episode to read its statistics before responding." },
      reference: { kind: "replay-note", label: `Match #${(episode.job_index ?? 0) + 1} · ${episode.run_title || "Hosted game"}`, episodeId: episode.id, runId: episode.run_id },
    });
    setReplayNote("");
  }

  function discussLeagueReplay() {
    const note = replayNote.trim();
    if (!note || !leagueSelection) return;
    const episode = selectedLeagueEpisode;
    track(events.replayNoteDiscussed, { episode_id: leagueSelection.id, note_length: note.length, league: true });
    setAnalysisRequest({
      id: Date.now(),
      text: `I watched this league replay and noticed: ${note}`,
      context: {
        kind: "league-episode", episode_id: leagueSelection.id, policy_version_id: leagueSelection.policyVersionId,
        ...(episode ? {
          round: String(episode.round.number), side: episode.side ?? "both sides", seats: episode.seats.join(","),
          outcome: episode.outcome ?? episode.status, score_per_hero: episode.score === null ? "not scored" : String(episode.score),
          roster: leagueRoster(episode),
        } : {}),
        hint: "This is a league-round episode against other players, not a hosted practice game. hosted_game_status and coaching_feedback do not cover it. Use the facts given here, and league_standing for the overall record.",
      },
      reference: { kind: "league-episode", label: leagueSelection.label, episodeId: leagueSelection.id, runId: "", policyVersionId: leagueSelection.policyVersionId },
    });
    setReplayNote("");
  }

  function discussCoaching(item: { id: string; created_at?: string; episode_id?: string }, mode: "discuss" | "apply" = "discuss") {
    const episode = episodes.find((candidate) => candidate.episode_id === item.episode_id) ?? selectedEpisode;
    const when = item.created_at ? new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const reference: ChatReference | undefined = episode ? { kind: "coaching-session", label: `Match #${(episode.job_index ?? 0) + 1}${when ? ` · recorded ${when}` : ""}`, episodeId: episode.id, runId: episode.run_id, coachingSessionId: item.id } : undefined;
    if (mode === "apply") track(events.coachingApplied, { coaching_session_id: item.id, episode_id: episode?.id });
    setAnalysisRequest(mode === "apply" ? {
      id: Date.now(),
      text: "Apply my replay coaching to the policy now. Read this coaching session with coaching_feedback, then edit hero.bas so the next revision implements its proposals: turn each proposal into concrete BASIC changes using only host functions from the policy guide, keep the change set focused enough to test in one hosted game, and skip any proposal that does not map onto hero.bas, saying which and why. Save it with save_policy_version citing this coaching session as evidence, upload it, and start one hosted game. Then tell me what changed, line by line, and what result would confirm it worked.",
      context: { kind: "coaching-session", coaching_session_id: item.id, hint: "The student asked you to apply the coaching. Do not ask for confirmation first: read the analysis, edit, save with the session as evidence, upload, request one hosted game, then report." },
      reference,
    } : {
      id: Date.now(),
      text: "Can we talk through what I noticed in this replay?",
      context: { kind: "coaching-session", coaching_session_id: item.id, hint: "Read this coaching session with coaching_feedback first. Start from one observed moment and ask one question." },
      reference,
    });
  }

  function discussPolicyResults() {
    if (!latestActiveEpisode || !activePolicyId) return;
    setAnalysisRequest({
      id: Date.now(),
      text: "How is my policy doing? Use the league record and the latest hosted game to suggest one testable improvement. Ask me what I noticed in the replay.",
      context: { kind: "policy-results", policy_version_id: activePolicyId, xp_request_id: latestActiveEpisode.run_id, episode_id: latestActiveEpisode.id, hint: "Use league_standing and hosted_game_status with this run. State sample sizes and keep league and hosted results separate." },
      reference: { kind: "policy-results", label: `${policyLabel(activePolicyId)} · match #${(latestActiveEpisode.job_index ?? 0) + 1}`, episodeId: latestActiveEpisode.id, runId: latestActiveEpisode.run_id, policyVersionId: activePolicyId },
    });
  }

  const matchStatsBlock = <>
    {matchStats ? <details className="replay-metrics"><summary>Match statistics <span>{matchStats.steps === null ? "" : `${matchStats.steps} steps`}</span></summary>
    <div>{Object.entries(matchStats.game_stats).map(([name, value]) => <span key={name}>{name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>)}
    {matchStats.policy_stats.map((policy) => <span key={policy.position}>Seat {policy.position + 1} reward <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(policy.avg_reward)}</b></span>)}
    {matchStats.policy_stats.flatMap((policy) => Object.entries(policy.avg_metrics).filter(([name]) => name !== "reward").map(([name, value]) => <span key={`${policy.position}-${name}`}>Seat {policy.position + 1} {name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>))}</div>
    </details> : null}
    {matchStatsError ? <p className="error replay-metrics-error">{matchStatsError}</p> : null}
  </>;

  const workspacePanel = <section className="preview-card">
          <div className="tabs" role="tablist" aria-label="Workspace views">
            <div><button role="tab" aria-selected={activeTab === "episodes"} className={activeTab === "episodes" ? "active" : ""} onClick={() => { setActiveTab("episodes"); track(events.tabViewed, { tab: "matches" }); }}>Matches</button>
              <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} disabled={recordingCoaching} onClick={() => { setActiveTab("policy"); track(events.tabViewed, { tab: "policy", revisions: workspace?.versions.length ?? 0 }); }}>Policy <span className="tab-code">hero.bas</span></button></div>
            <span className="league-status"><button type="button" className="notice-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen(!notificationsOpen); if (!notificationsOpen) { track(events.updatesOpened, { unread }); markNoticesRead(); } }}>Updates{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}</button>{defaultPlayer ? <span className="player-label" title="The Softmax player your uploads and league entries are credited to">Player <b>{defaultPlayer}</b></span> : null}<span className="sync-label">{arena ? arena.league.rounds_paused_at ? "Rounds paused" : "Rounds live" : "Connecting…"}<span className="live-indicator" /></span><a className="league-link" href={league.url} target="_blank" rel="noreferrer">NeuralHub league ↗</a></span>
          </div>
          {notificationsOpen ? <div className="notice-panel" role="region" aria-label="Policy updates"><div className="notice-panel-head"><strong>Policy updates</strong><button type="button" className="text-button" onClick={() => setNotificationsOpen(false)}>Close ×</button></div>{notices.length ? notices.map((notice) => <div key={notice.id} className={`notice-row ${notice.kind}`}><b>{notice.title}</b><span>{notice.detail}</span><small>{new Date(notice.at).toLocaleString()}</small></div>) : <p className="muted">Your saves, uploads, and hosted game results appear here.</p>}</div> : null}
          {activeTab === "policy" ? <div className="policy-view">
            {workspace?.latest ? <div className="policy-stages" aria-label="Current policy progress"><span className="done">✓ r{workspace.latest.ir.update.revision} saved</span><span className={latestSavedUpload ? "done" : "waiting"}>{latestSavedUpload ? "✓ Uploaded" : "○ Upload next"}</span><span className={latestGames.some((game) => game.status === "completed") ? "done" : "waiting"}>{latestGames.some((game) => game.status === "completed") ? latestGames.some((game) => game.replayReady) ? "✓ Replay ready" : "✓ Game complete" : latestGames.some((game) => !["failed", "canceled", "cancelled"].includes(game.status)) ? "◌ Hosted game running" : "○ Play hosted game"}</span>{resumePolicy ? <button type="button" className="secondary" onClick={() => setAnalysisRequest({ id: Date.now(), text: resumePolicy.text })}>{resumePolicy.label} ↗</button> : null}</div> : null}
            <div className="policy-toolbar"><div><span className="eyebrow">Symbolic policy</span><h2>hero.bas</h2>
              <p>{viewRevision !== null ? `Revision ${viewRevision}` : workspace?.latest ? `Revision ${workspace.latest.ir.update.revision} · working copy` : "Starter policy"}{currentUpload?.label ? ` · uploaded as ${currentUpload.label}` : ""}{currentUpload ? currentUpload.player ? <> · player <b>{currentUpload.player}</b></> : null : defaultPlayer ? <> · uploads as player <b>{defaultPlayer}</b></> : null}</p></div>
              <div className="policy-actions">
                <button className="secondary" onClick={downloadPolicy} disabled={!currentRevision}>BASIC ↓</button>
                <button className="secondary" onClick={downloadRevision} disabled={!currentRevision}>IR + BASIC ↓</button>
                {currentUpload ? <button className="secondary" onClick={enterLeague}>Enter league ↗</button> : null}</div></div>
            {submission ? <p className="submission">{submission}</p> : null}
            {workspace?.draft ? <div className="draft-banner"><b>{workspace.draft.conflict ? "Draft from an older revision" : "Unsaved policy draft"}</b><span>{Math.ceil(workspace.draft.bytes / 1024)} KiB · kept since {new Date(workspace.draft.updated_at).toLocaleString()}</span><button type="button" className="secondary" onClick={() => setAnalysisRequest({ id: Date.now(), text: workspace.draft?.conflict ? "Merge my older draft/conflicting-hero.bas into the latest saved hero.bas without losing newer changes. Then save, upload, and request one hosted game." : "Finish saving my unsaved hero.bas draft, then upload it and request a hosted game. Check git diff first so you preserve my edit." })}>Finish in chat ↗</button><button type="button" className="text-button" onClick={() => void discardDraft()}>Discard</button></div> : null}
            {workspace?.versions.length ? <ol className="version-history" aria-label="Saved revisions">
              <li className={viewRevision === null ? "active" : ""}><button type="button" onClick={() => setViewRevision(null)}><b>Latest</b><span>Working copy · r{workspace.latest?.ir.update.revision ?? 0}</span></button></li>
              {[...workspace.versions].reverse().map((version) => <li key={version.id} className={viewRevision === version.revision ? "active" : ""}>
                <button type="button" onClick={() => { setViewRevision(version.revision); track(events.revisionViewed, { revision: version.revision, uploaded: !!version.policyVersionId, games: version.games }); }}><b>r{version.revision}</b><span>{version.summary}</span>
                  <small>{new Date(version.created_at).toLocaleString()}{version.label ? ` · ${version.label}${version.player && version.player !== defaultPlayer ? ` · player ${version.player}` : ""}` : " · not uploaded"}{version.scored ? ` · hosted mean ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(version.hostedMean ?? 0)} over ${version.scored} scored seats` : version.games ? ` · ${version.games} game${version.games === 1 ? "" : "s"} requested` : ""}</small></button>
              </li>)}
            </ol> : <div className="version-empty"><p className="muted">No saved revisions yet. Start by uploading the official starter policy as revision 1, then ask the Neural Viking Agent for one change at a time. Each save appears here with its hypothesis and results.</p>
              {starterPrompt ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: starterPrompt.text })}>{starterPrompt.label} ↗</button> : null}</div>}
            {currentRevision ? <SemanticPolicy key={currentRevision.revisionId} revision={currentRevision} /> : <p className="muted policy-loading">Loading hero.bas…</p>}
          </div> : <div className="episodes-view">
            <div className="episodes-heading"><div><img src="/gota/logo.png" alt="" /><div><h2>Matches</h2><p>{activePlayer ? <>Playing as <b>{activePlayer}</b> in {league.name}</> : league.name}</p></div></div></div>
            {pendingExperiments.length ? <div className="job-banner"><span className="status-dot" />
              <span>{pendingExperiments.length === 1 ? `Hosted game running: ${pendingExperiments[0].title}` : `${pendingExperiments.length} hosted games running`}. Results appear here and in the chat when they finish.</span></div> : null}
            {activePolicyId ? <section className="policy-performance" aria-label="Policy performance">
              <div className="performance-top"><div><span className="eyebrow">Policy performance</span><strong>{policyLabel(activePolicyId)}</strong><span className="performance-player">{activePlayer ? `Player ${activePlayer}` : "Player unknown"} · {entered.has(activePolicyId) ? "entered in the league" : "not entered in the league"}</span></div>
                <select aria-label="Choose policy version" value={selectedPolicyId} disabled={recordingCoaching} onChange={(event) => { setSelectedPolicyId(event.target.value); setSelectedEpisodeId(""); setLeagueSelection(null); setMatchView(null); setViewer(null); }}>
                  <option value="">{leagueEntry ? "League entry" : "Latest upload"} · all practice games</option>
                  {[...new Set([...uploadedVersions.map((version) => version.policyVersionId), ...policyIds])].map((id) => <option key={id} value={id}>{policyLabel(id)}{entered.has(id) ? " · in league" : ""}</option>)}
                </select></div>
              <div className="performance-values">
                <div><strong>{activeStanding ? `${(activeStanding.win_rate * 100).toFixed(1)}%` : "—"}</strong><span>League win % · {activeStanding ? `${activeStanding.wins}/${activeStanding.episodes_played} games` : "No league games in window"}</span></div>
                <div><strong>{activeStanding ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(activeStanding.score) : "—"}</strong><span>League score · 72h</span></div>
                <div><strong>{hostedMean === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hostedMean)}</strong><span>Practice mean score · {activeScores.length} hosted games</span></div>
              </div>
              {replaySnapshot ? <div className="snapshot-metrics"><div><strong>Replay behavior · {replaySnapshot.games} hero-games</strong><span>{new Date(replaySnapshot.windowStart).toLocaleDateString()} – {new Date(replaySnapshot.windowEnd).toLocaleDateString()} · dated snapshot</span></div>
                {["kills", "deaths", "tower_kills", "xp", "rejected_share"].map((name) => <div key={name}><b>{replaySnapshot.values[name] === undefined ? "—" : name === "rejected_share" ? `${(replaySnapshot.values[name] * 100).toFixed(1)}%` : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(replaySnapshot.values[name])}</b><span>{name.replaceAll("_", " ")}</span></div>)}
              </div> : null}
              <div className="performance-bottom"><span>League win % uses competition games from the last 72 hours. Ties for first count as wins. Practice games are scored separately.</span>
                <button className="secondary" disabled={!latestActiveEpisode} onClick={discussPolicyResults}>Discuss results ↗</button></div>
              {policyStatsError ? <p className="error">{policyStatsError}</p> : null}
              {snapshotError ? <p className="error">{snapshotError}</p> : null}
            </section> : null}
            {leagueSelection ? <section ref={replayPanelRef} className="replay-panel" aria-label="Selected league replay">
              <div className="replay-head"><div><span className="eyebrow">League replay{selectedLeagueEpisode?.outcome ? ` · ${leagueOutcomeLabel[selectedLeagueEpisode.outcome]}` : ""}</span><strong>{leagueSelection.label}</strong></div>
                <div className="replay-head-actions">
                  <button className="text-button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? "Exit full screen" : "Full screen ⤢"}</button>
                  <button className="text-button" onClick={() => { setLeagueSelection(null); setViewer(null); setReplayError(""); }}>Close ×</button></div></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready ? <ReplayFrame src={viewer.url} title={`Replay for ${leagueSelection.label}`} /> : <div className="replay-state">Starting replay…</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${leagueSelection.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {selectedLeagueEpisode ? <span title={leagueRoster(selectedLeagueEpisode)}>{selectedLeagueEpisode.side ? `Your heroes: ${selectedLeagueEpisode.side} side, seat${selectedLeagueEpisode.seats.length === 1 ? "" : "s"} ${selectedLeagueEpisode.seats.map((seat) => seat + 1).join(", ")}` : ""}</span> : null}
              </div>
              {matchStatsBlock}
              <div className="replay-note-box"><label htmlFor="league-replay-note">Notice something?</label>
                <div><textarea id="league-replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={discussLeagueReplay}>Discuss in chat ↗</button></div></div>
            </section> : null}
            {selectedEpisode ? <section ref={replayPanelRef} className="replay-panel" aria-label="Selected replay">
              <div className="replay-head"><div><span className="eyebrow">Replay · #{(selectedEpisode.job_index ?? 0) + 1}</span><strong>{selectedEpisode.run_title || "Hosted game"}</strong></div>
                <div className="replay-head-actions">
                  <button className="text-button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? "Exit full screen" : "Full screen ⤢"}</button>
                  <button className="text-button" disabled={recordingCoaching} onClick={() => { setSelectedEpisodeId(""); setViewer(null); setReplayError(""); }}>Close ×</button></div></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready && coachingAvailable && selectedEpisode.episode_id ? <ReplayCoaching key={selectedEpisode.id} episode={selectedEpisode} sessions={coaching.filter((item) => item.episode_id === selectedEpisode.episode_id)} onSaved={() => setRefreshKey((key) => key + 1)} onDiscuss={(session) => discussCoaching(session, "apply")} onRecordingChange={setRecordingCoaching} focusSessionId={focusCoachingId} replay={<ReplayFrame src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} />} /> : viewer?.ready ? <ReplayFrame src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} /> : <div className="replay-state">{selectedEpisode.replay_url ? "Starting replay…" : "Replay is not available yet."}</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${selectedEpisode.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {selectedCoaching?.latest_analysis?.status === "complete" && !viewer?.ready ? <button className="text-button" onClick={() => discussCoaching(selectedCoaching)}>Discuss coaching ↗</button> : null}
                {coachingError ? <span className="error">{coachingError}</span> : null}
              </div>
              {matchStatsBlock}
              {!coachingAvailable ? <div className="replay-note-box"><label htmlFor="replay-note">Notice something?</label>
                <div><textarea id="replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={() => discussReplay(selectedEpisode)}>Discuss in chat ↗</button></div></div> : null}
            </section> : null}
            <div className="match-views">
              <div role="tablist" aria-label="Kind of match">
                <button type="button" role="tab" aria-selected={view === "league"} className={view === "league" ? "active" : ""} disabled={recordingCoaching} onClick={() => { setMatchView("league"); track(events.tabViewed, { tab: "league-rounds" }); }}>League rounds <span>{leaguePolicyId ? leagueReady ? `${leagueRows.length}${leagueFeed?.nextCursor ? "+" : ""}` : "…" : 0}</span></button>
                <button type="button" role="tab" aria-selected={view === "practice"} className={view === "practice" ? "active" : ""} disabled={recordingCoaching} onClick={() => { setMatchView("practice"); track(events.tabViewed, { tab: "practice-games" }); }}>Practice games <span>{visibleEpisodes.length}</span></button>
              </div>
              <p>{view === "league" ? "Episodes the league scheduled for this policy version against other players. These decide its rank." : "Hosted self-play that you or the agent requested: one policy controls all ten heroes. These never count in the league."}</p>
            </div>
            {view === "league" ? <>
              {leagueError ? <p className="error">{leagueError}</p> : null}
              {!activeVersion ? <div className="empty-games"><p>League rounds appear here once a revision is uploaded and entered in the league.</p></div>
                : !leagueReady ? leagueError ? null : <p className="muted">Loading league episodes…</p>
                : !leagueRows.length ? <div className="empty-games"><p>{policyLabel(activeVersion.policyVersionId)} has not played a league round yet. {entered.has(activeVersion.policyVersionId) ? arena?.league.rounds_paused_at ? "It is entered, and league rounds are paused right now." : "It is entered; its first round appears here when the league schedules it." : "It is not entered in the league, so the league does not schedule it."}</p>
                  {leagueEntry && leagueEntry.id !== activeVersion.id ? <button type="button" className="starter-cta" onClick={() => { setSelectedPolicyId(leagueEntry.policyVersionId); setMatchView("league"); }}>Show league episodes for r{leagueEntry.revision}</button>
                    : !entered.has(activeVersion.policyVersionId) ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: `Enter revision r${activeVersion.revision} in the NeuralHub league.` })}>Enter r{activeVersion.revision} in the league ↗</button> : null}</div>
                : <>
                  <p className="league-tally">{leagueDecided.length ? <>Of the {leagueDecided.length} {leagueFeed?.nextCursor ? "newest " : ""}finished episodes: <b>{leagueTally.won} won</b>, <b>{leagueTally.lost} lost</b>, <b>{leagueTally.time_limit} hit the time limit</b> with no fort destroyed, which scores 0 for both sides.</> : "No league episode has finished yet."}</p>
                  <div className="episode-table-wrap"><table className="episode-table league-table"><thead><tr><th>Round</th><th>Played</th><th>Side</th><th>Against</th><th>Result</th><th title="Mean score across the heroes this policy controlled">Score / hero</th></tr></thead><tbody>
                    {leagueRows.map((episode) => {
                      const playable = episode.status === "completed" && !!episode.replay_url && !recordingCoaching;
                      return <tr key={episode.id} className={`${leagueSelection?.id === episode.id ? "selected" : ""}${playable ? "" : " unplayable"}`} tabIndex={playable ? 0 : -1} role="button" aria-disabled={!playable} aria-label={`Open replay for league round ${episode.round.number} against ${leagueAgainst(episode)}`} onClick={() => { if (playable) openLeagueEpisode(episode); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                        <td><strong>#{episode.round.number}</strong></td>
                        <td>{new Date(episode.created_at).toLocaleString()}</td>
                        <td>{episode.side ? `${episode.side} · ${episode.seats.length} ${episode.seats.length === 1 ? "hero" : "heroes"}${episode.format === "mixed" ? " · mixed team" : ""}` : "—"}</td>
                        <td className="against-cell" title={leagueRoster(episode)}>{leagueAgainst(episode)}{episode.format === "team" && episode.opponents.length === 1 && episode.opponents[0].player ? <small>{episode.opponents[0].policy}</small> : null}</td>
                        <td className={`result-cell ${episode.outcome ?? ""}`} title={episode.error ?? undefined}>{episode.outcome ? leagueOutcomeLabel[episode.outcome] : leagueStatusLabel[episode.status] ?? "—"}</td>
                        <td className="score-cell">{episode.score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(episode.score)}</td>
                      </tr>;
                    })}</tbody></table></div>
                  <div className="league-more">{leagueFeed?.nextCursor ? <button type="button" className="secondary" disabled={leagueLoading} onClick={loadMoreLeague}>{leagueLoading ? "Loading…" : "Load 50 more"}</button> : null}<span>{leagueFeed?.nextCursor ? `Showing the ${leagueRows.length} newest league episodes for ${policyLabel(activeVersion.policyVersionId)}.` : `All ${leagueRows.length} league episodes for ${policyLabel(activeVersion.policyVersionId)}.`}</span></div>
                </>}
            </> : <>
            {workspace && workspace.versions.length > 1 ? <div className="revision-comparison"><div><span className="eyebrow">Revision comparison</span><p>Same NeuralHub hosted self-play setup · separate games · scores are per seat. Small samples are directional. Deaths appear when the hosted game reports them; current episodes report only reward.</p></div><div className="revision-comparison-table"><span>Revision</span><span>Mean score</span><span>Deaths / seat</span><span>Games</span>{workspace.versions.slice(-4).reverse().map((version) => <div className="revision-comparison-row" key={version.id}><strong>r{version.revision}</strong><b>{version.hostedMean === null ? "—" : version.hostedMean.toFixed(1)}</b><b>{version.meanDeaths === null ? "—" : version.meanDeaths.toFixed(1)}</b><span>{version.completedGames}</span></div>)}</div><button type="button" className="secondary" onClick={() => setAnalysisRequest({ id: Date.now(), text: "Compare my latest two policy revisions using hosted score and any available deaths per seat. State the number of games for each, explain uncertainty, and suggest one focused change to hero.bas to test next." })}>Discuss comparison ↗</button></div> : null}
            {arenaError ? <p className="error">{arenaError}</p> : null}
            {!arena ? <p className="muted">Loading practice games…</p> : episodes.length === 0 ? <div className="empty-games"><p>{workspace?.experiments.length ? pendingExperiments.length ? "A hosted game is running. Its replay will appear here when ready." : `No playable replay yet. Latest hosted game: ${workspace.experiments[0].status}.` : "No games yet. Ask the Neural Viking Agent to upload your policy and start one."}</p>{starterPrompt ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: starterPrompt.text })}>{starterPrompt.label} ↗</button> : workspace?.experiments.length && !pendingExperiments.length ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: "My last hosted game did not produce a replay. Check why, then request one hosted game on my latest saved policy." })}>Check and retry ↗</button> : null}</div> :
              <div className="episode-table-wrap"><table className="episode-table"><thead><tr>{tableColumns.map((column) => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => sortBy(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead><tbody>
                {sortedEpisodes.map((episode) => {
                  const score = selectedPolicyId ? policyScore(episode, selectedPolicyId) : episodeScore(episode);
                  const policyId = selectedPolicyId || episodePolicyId(episode);
                  const standing = policyId ? boardByPolicy.get(policyId) : undefined;
                  return <tr key={episode.id} className={selectedEpisodeId === episode.id ? "selected" : ""} tabIndex={recordingCoaching ? -1 : 0} role="button" aria-disabled={recordingCoaching && selectedEpisodeId !== episode.id} aria-label={`Open replay for ${episode.run_title || "hosted game"}, episode ${(episode.job_index ?? 0) + 1}`} onClick={() => { if (recordingCoaching) return; setLeagueSelection(null); setSelectedEpisodeId(episode.id); setViewer(null); setReplayError(""); setReplayNote(""); track(events.replayOpened, { episode_id: episode.id, run_id: episode.run_id, status: episode.status, source: "table" }); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                    <td><strong>#{(episode.job_index ?? 0) + 1}</strong><span>{episode.run_title || "Hosted game"}</span></td>
                    <td className="policy-cell" title={standing?.policy_label ?? policyId ?? "Multiple policies"}>{standing?.policy_label ?? (policyId ? `Policy ${policyId.slice(0, 8)}` : "Mixed")}</td>
                    <td>{new Date(episode.completed_at ?? episode.created_at).toLocaleString()}</td>
                    <td className="score-cell" title={selectedPolicyId ? "Recorded score for the selected policy" : "Average per policy when a match has multiple policies"}>{score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score)}</td>
                    <td className="win-cell" title="This exact policy version’s win rate in league games over the last 72 hours; not this hosted match’s outcome">{standing ? `${(standing.win_rate * 100).toFixed(1)}%` : "—"}</td>
                  </tr>;
                })}</tbody></table>{!sortedEpisodes.length ? <div className="empty-games">No practice games for this policy version yet.</div> : null}</div>}
            </>}
          </div>}
        </section>;

  return <main className={`shell${email ? " signed-in" : ""}${email && !narrow ? " split-shell" : ""}`}>
    {toast ? <div className={`app-toast ${toast.kind}`} role="status"><b>{toast.title}</b><span>{toast.detail}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div> : null}
    {!email ? <header className="topbar">
      <a className="brand" href="/">Softmax IDE <span>Beta</span></a>
      <a className="league-link" href={league.url} target="_blank" rel="noreferrer">{league.name} ↗</a>
    </header> : null}
    {!email ? <div className="intro">
      <p className="eyebrow">Diablo Valley College · student arena</p>
      <h1>Describe your strategy.<br /><em>Watch your hero play.</em></h1>
      <p>Ask the Neural Viking Agent to build a policy. It writes one BASIC file, uploads it, and starts a hosted game for you.</p>
    </div> : null}

    {email === undefined ? <section className="card">Loading your session…</section> :
      !email ? <section className="card signin">
        <div><p className="eyebrow">Step 01</p><h2>Connect your Softmax account</h2>
          <p>Paste your Softmax user token. We use it to upload and play as you.</p>
          <a href="https://softmax.com/cli-auth" target="_blank" rel="noreferrer">Get a token from Softmax ↗</a>
        </div>
        <form onSubmit={signIn}>
          <label htmlFor="token">User token</label>
          <input id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required />
          <button type="submit">Enter the arena</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section> : narrow ? <div className="workspace">
        <Chat key={email} onActivity={onActivity} onNotice={onChatNotice} onSignOut={signOut} onOpenReference={openReference} analysisRequest={analysisRequest} suggestions={chatSuggestions} starterPrompt={starterPrompt} recordingCoaching={recordingCoaching} playerName={defaultPlayer} />
        {workspacePanel}
      </div> : <Group orientation="horizontal" className="workspace split" defaultLayout={splitLayout} onLayoutChanged={rememberSplit}>
        <Panel id="chat" className="split-pane" defaultSize="30" minSize={320} maxSize="60">
          <Chat key={email} onActivity={onActivity} onNotice={onChatNotice} onSignOut={signOut} onOpenReference={openReference} analysisRequest={analysisRequest} suggestions={chatSuggestions} starterPrompt={starterPrompt} recordingCoaching={recordingCoaching} playerName={defaultPlayer} />
        </Panel>
        <Separator className="split-handle" aria-label="Resize the chat and workspace panels" />
        <Panel id="work" className="split-pane" minSize="35">{workspacePanel}</Panel>
      </Group>}
  </main>;
}
