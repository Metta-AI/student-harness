"use client";
import {SessionRail} from "./tasks/session-rail";
import {BackgroundButton} from "./tasks/background-button";
import { selectPerformancePolicy, type LeagueEntry } from "../lib/league-policy-selection";
import type { LeagueStanding } from "../lib/softmax";

import { Activity, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageVisible } from "./use-page-visible";
import type { PolicyRevision } from "../lib/semantic-ir";
import { episodeScore, policyScore } from "../lib/policy-metrics";
import type { LeagueEpisodeSummary } from "../lib/league-episodes";
import { PresentPanel } from "./partner/present-card";
import { Together } from "./partner/together";
import { CompanionProvider, useCompanion } from "./partner/companion";
import type { ClaimInput } from "../lib/partner/model";
import { TaskPanel } from "./tasks/task-panel";
import { useTaskFeed } from "./tasks/use-task-feed";
import { GamePicker } from "./partner/game-navigation";
import { AccountMenu } from "./partner/account-menu";
import { Opponents } from "./workspace/opponents";
import { ExperimentDetail } from "./workspace/experiment-detail";
import { ExperimentResults } from "./workspace/experiment-results";
import { ExperimentTable } from "./workspace/experiment-table";
import { StrategyOverview } from "./workspace/strategy-overview";
import { PerformanceEvidence } from "./workspace/performance-evidence";
import { WorkspaceComposer } from "./workspace/workspace-composer";
import { RequestWorkspace } from "./workspace/request-workspace";
import { useWorkspaceRequests } from "./workspace/use-workspace-requests";
import { useChatSettings } from "./use-chat-settings";
import { CoachingHome } from "./workspace/coaching-home";
import { PresentationPane } from "./workspace/presentation-pane";
import { workspaceTabs, viewSchema, presentationRoute, type WorkspaceTab, type WorkspaceView } from "../lib/workspace/presentation";
import { PolicyWiki } from "./workspace/policy-wiki";
import type { WikiPage } from "../lib/workspace/policy-wiki";
import { ReplayCoaching } from "./replay-coaching";
import { Chat, type AnalysisRequest, type ChatReference, type StarterPrompt } from "./chat";
import { ReplayFrame } from "./replay-frame";
import { identifyStudent, resetAnalytics, track } from "../lib/analytics";
import { events } from "../lib/analytics-events";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";

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
  policy_reference?: { policy_version_id: string | null };
};
type ArenaData = {
  league: { rounds_paused_at: string | null };
  episodes: ArenaEpisode[];
};
type LeaguePolicy = {
  rank: number; policy_version_id: string; policy_label: string; score: number;
  // The leaderboard also reports wins and a win rate, but it counts a tie for first as a win, which
  // turns every time-limit game into a win. Wins are counted from the episodes instead (LeagueRecord).
  episodes_played: number; rounds_played: number; player_id: string | null;
};
type PolicyStats = { standings: LeagueStanding[]; checkedAt: string; entries: LeagueEntry[]; currentPolicyId?: string | null; division: string; windowHours: number; policies: LeaguePolicy[]; entered: string[] };
/** One league-round episode from the selected policy version's point of view. */
type LeagueEpisode = LeagueEpisodeSummary & {
  id: string; episode_id?: string | null; status: string; created_at: string; replay_url: string | null; error: string | null;
  round: { id: string; number: number };
};
type LeagueRecord = { policyVersionId: string; games: number; wins: number; losses: number; time_limits: number; window_hours: number; complete: boolean };
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
type SortKey = "episode" | "development" | "played" | "score";
const tableColumns: { key: SortKey; label: string }[] = [
  { key: "episode", label: "Episode" }, { key: "development", label: "Policy" },
  { key: "played", label: "Played" }, { key: "score", label: "Score" },
];
function episodePolicyId(episode: ArenaEpisode) {
  return episode.scores.length === 1 ? episode.scores[0].policy_version_id : null;
}

export function StudentApp({ league, initialTaskId }: { league: League; initialTaskId?: string }) {
  return <CompanionProvider><StudentWorkspace league={league} initialTaskId={initialTaskId} /></CompanionProvider>;
}

function StudentWorkspace({ league, initialTaskId }: { league: League; initialTaskId?: string }) {
  const companion = useCompanion();
  const pageVisible = usePageVisible();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [sessionError, setSessionError] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [preferredName, setPreferredName] = useState("");
  const [accountName, setAccountName] = useState<string | null>(null);
  useEffect(() => {
    if (!email) { setPreferredName(""); return; }
    let active = true;
    const load = () => { void fetch("/api/preferences", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(value => { if (active && typeof value?.preferredName === "string") setPreferredName(value.preferredName); }).catch(() => {}); };
    load(); window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [email]);
  const taskFeed = useTaskFeed(!!email);
  const [opponentPolicyId,setOpponentPolicyId]=useState<string|undefined>();
  const [selectedExperiment,setSelectedExperiment]=useState<string|null>(null);
  const [selectedWork, setSelectedWork] = useState<string | null>(initialTaskId??null);
  const [creatingWork, setCreatingWork] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const requests = useWorkspaceRequests(subjectId, league.id);
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
  const [activeTab, selectTab] = useState<WorkspaceTab>(initialTaskId?"lab":"performance");
  const [labMode, setLabMode] = useState(!!initialTaskId);
  const labTabs = ["lab", ...workspaceTabs] as const;
  const setActiveTab = useCallback((tab: WorkspaceTab, mode: "workspace" | "lab" = tab === "performance" ? "workspace" : "lab") => {
    companion.presentation.manual();
    setLabMode(mode === "lab");
    if (mode === "workspace" && tab === "performance") setSelectedPolicyId("");
    const route = `/?view=${tab}${mode === "lab" && tab !== "lab" ? "&mode=lab" : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== route) window.history.pushState(null, "", route);
    selectTab(tab);
  }, [companion.presentation.manual]);
  const [branchId, setBranchId] = useState<string | undefined>();
  const [cycleId, setCycleId] = useState<string | undefined>();
  const [outcomeLast, setOutcomeLast] = useState<10 | 25 | 50>(10);
  const [opponentFilter, setOpponentFilter] = useState("");
  const [arena, setArena] = useState<ArenaData | null>(null);
  const [arenaError, setArenaError] = useState("");
  const [episodes, setEpisodes] = useState<ArenaEpisode[]>([]);
  const [policyStats, setPolicyStats] = useState<PolicyStats | null>(null);
  const [policyStatsError, setPolicyStatsError] = useState("");
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
  const [leagueRecord, setLeagueRecord] = useState<LeagueRecord | null>(null);
  const [leagueRecordError, setLeagueRecordError] = useState("");
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueError, setLeagueError] = useState("");
  const [leagueSelection, setLeagueSelection] = useState<{ id: string; policyVersionId: string; label: string } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; ready: boolean; episodeId?: string | null } | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replayNote, setReplayNote] = useState("");
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null);
  const [matchStatsError, setMatchStatsError] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest | null>(null);
  const [recordingCoaching, setRecordingCoaching] = useState(false);
  const replayPanelRef = useRef<HTMLElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAction,setChatAction]=useState<{id:number;kind:"history"}|{id:number;kind:"prompt";text:string}>();
  const [presentBusy, setPresentBusy] = useState(false);
  const [presentActivity, setPresentActivity] = useState<string | null>(null);
  const updatePresence = useCallback((busy: boolean, activity: string | null) => {
    setPresentBusy(busy); setPresentActivity(activity);
  }, []);
  const [presentExpanded, setPresentExpanded] = useState(false);
  const [compactScreen, setCompactScreen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const change = () => setCompactScreen(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const closePresent = useCallback(() => {
    setPresentExpanded(false); setChatOpen(false);
    requestAnimationFrame(() => document.getElementById("present-panel-toggle")?.focus());
  }, []);
  const openTextChat = useCallback(() => setChatOpen(true), []);
  const chatDock = useRef<HTMLDivElement>(null);
  useEffect(() => { if (analysisRequest && analysisRequest.context?.kind!=="workspace-view") setChatOpen(true); }, [analysisRequest]);
  useEffect(() => {
    if (!chatOpen) return;
    const timer = window.setTimeout(() => chatDock.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 100);
    const onKey = (event: KeyboardEvent) => { if (compactScreen && event.key === "Escape" && !event.defaultPrevented) closePresent(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [chatOpen, compactScreen, closePresent]);
  const [focusCoachingId, setFocusCoachingId] = useState<string | undefined>(undefined);
  const openReference = useCallback((reference: ChatReference) => {
    if (window.matchMedia("(max-width: 800px)").matches) { setChatOpen(false); setPresentExpanded(false); }
    setActiveTab("episodes","workspace");
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
  const chatSettings = useChatSettings(email??null);
  const onChatNotice = useCallback((title: string, detail: string) => { setChatOpen(true); setToast({ id: `chat:${Date.now()}`, title, detail, at: new Date().toISOString(), kind: "error" }); }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSessionError(false);
    const timer = window.setTimeout(() => controller.abort(), 8000);
    void (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Session lookup failed");
        const data = await response.json();
        if (!data || !(data.email === null || (typeof data.email === "string" && data.email && typeof data.subjectId === "string" && data.subjectId))) throw new Error("Invalid session response");
        if (!active) return;
        setEmail(data.email);
        setAccountName(data.name ?? null);
        if (data.email) { setSubjectId(data.subjectId); identifyStudent(data.subjectId, data.email); }
      } catch {
        // Keep the existing cookie: a network failure does not mean the user signed out.
        if (active) setSessionError(true);
      } finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [sessionAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/starter-policy", {signal: controller.signal}).then(response => response.ok ? response.json() : null).then(data => {if(data && !controller.signal.aborted)setStarterRevision(data);}).catch(() => {});
    return () => controller.abort();
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
    const controller = new AbortController();
    let busy = false;
    const refresh = () => {
      if (busy || controller.signal.aborted || document.visibilityState === "hidden") return;
      busy = true;
      void fetch("/api/workspace", {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])}).then(async (response) => {
        if (!response.ok) throw new Error("Workspace data could not be loaded.");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setWorkspace(data);
        setWorkspaceError("");
      }).catch(() => {
        if (!controller.signal.aborted) setWorkspaceError("Workspace data could not be loaded. Please retry.");
      }).finally(() => { busy = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 8000);
    document.addEventListener("visibilitychange", refresh);
    return () => {controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh);};
  }, [email, refreshKey, workspaceKey]);

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = () => {
      if (busy || controller.signal.aborted || document.visibilityState === "hidden") return;
      busy = true;
      void fetch("/api/arena", {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])}).then(async (response) => {
      const data = await response.json();
      if(controller.signal.aborted)return;
      if (!response.ok) throw new Error(data.error ?? "Could not load episodes");
      setArena(data);
      setEpisodes(data.episodes);
      setArenaError("");
    }).catch((cause: Error) => {if(!controller.signal.aborted)setArenaError(cause.message);}).finally(() => { busy = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh);};
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = () => {
      if (busy || controller.signal.aborted || document.visibilityState === "hidden") return;
      busy = true;
      void fetch("/api/coaching", {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])}).then(async (response) => {
      const data = await response.json();
      if(controller.signal.aborted)return;
      if (!response.ok) throw new Error(data.error ?? "Could not load coaching");
      setCoaching(data.sessions);
      setCoachingAvailable(data.available);
      setCoachingError("");
      setCoachingLoaded(true);
    }).catch((cause: Error) => { if(!controller.signal.aborted){setCoachingError(cause.message); setCoachingLoaded(true);} }).finally(() => { busy = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh);};
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const controller = new AbortController();
    const refresh = () => fetch("/api/policy-stats", {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load league policy results");
      if (!cancelled) { setPolicyStats(data); setPolicyStatsError(""); }
    }).catch((cause: Error) => { if (!cancelled) setPolicyStatsError(cause.message); });
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
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
    : workspace?.latest && !latestSavedUpload ? { label: "Upload + play", text: `Revision r${workspace.latest.ir.update.revision} is saved but not uploaded. Upload that revision without editing or resaving, then request one hosted game in the ${league.name} league (${league.id}).` }
    : workspace?.latest && !latestGames.some((game) => game.status === "completed" || !["failed", "canceled", "cancelled"].includes(game.status)) ? { label: latestGames.length ? "Retry hosted game" : "Play hosted game", text: `Use my latest saved revision r${workspace.latest.ir.update.revision}. Upload it if needed and request one hosted game in the ${league.name} league (${league.id}). Do not edit or resave the policy.` } : null;
  const starterPrompt: StarterPrompt | null = workspace && workspace.versions.length === 0 ? {
    label: "Create and upload my starter policy",
    detail: "The official starter hero.bas already plays a full match. Save it as revision 1, upload it to Softmax, and play one hosted game so every later change has a baseline to beat.",
    text: "Create my first policy: save the official starter hero.bas as revision 1 without changes, upload it to Softmax, and run one baseline hosted game so I have something to compare against. Then propose the first change I could try.",
  } : null;


  const boardByPolicy = new Map(policyStats?.policies.map((policy) => [policy.policy_version_id, policy]));
  const policyIds = [...new Set(episodes.flatMap((episode) => episode.scores.map((score) => score.policy_version_id)))];
  const uploadedVersions = [...(workspace?.versions ?? [])].reverse().filter((version): version is WorkspaceVersion & { policyVersionId: string } => !!version.policyVersionId);
  const versionByPolicy = new Map(uploadedVersions.map((version) => [version.policyVersionId, version]));
  const entered = new Set(policyStats?.entered ?? []);
  // Current remote champion drives Performance; local revisions remain editable independently.
  const leagueEntry = uploadedVersions.find((version) => entered.has(version.policyVersionId)) ?? null;
  const currentLeaguePolicyId = policyStats?.currentPolicyId ?? policyStats?.entered[0] ?? "";
  const activePolicyId = selectPerformancePolicy(selectedPolicyId, currentLeaguePolicyId, !!policyStats, latestUpload?.policyVersionId || policyIds[0] || "");
  const activeVersion = versionByPolicy.get(activePolicyId) ?? null;
  const policyLabel = (id: string) => {
    const version = versionByPolicy.get(id);
    const entry = policyStats?.entries.find(e=>e.policyVersionId===id);
    const remoteLabel = entry?.policyLabel ?? boardByPolicy.get(id)?.policy_label;
    if (version) return `r${version.revision} · ${remoteLabel ?? version.label ?? id.slice(0, 8)}`;
    return remoteLabel ?? `Policy ${id.slice(0, 8)}`;
  };
  // Shared by the performance and episodes pickers: the league entry or latest upload first, then every known version.
  const policyVersionOptions = [{ value: "", label: `${currentLeaguePolicyId ? "Current league policy" : "Latest upload"} · all practice games` },
    ...[...new Set([...uploadedVersions.map((version) => version.policyVersionId), ...entered, ...(policyStats?.entries.map(e=>e.policyVersionId)??[]), ...policyIds])].map((id) => ({ value: id, label: `${policyLabel(id)}${entered.has(id) ? " · current" : policyStats?.entries.find(e=>e.policyVersionId===id)?.status==="benched" ? " · benched" : ""}` }))];
  const activePlayer = policyStats?.entries.find(e=>e.policyVersionId===activePolicyId)?.playerName ?? activeVersion?.player ?? defaultPlayer;
  const leaguePolicyId = activePolicyId;
  useEffect(() => {
    if (!email || !leaguePolicyId) { setLeagueFeed(null); setLeagueRecord(null); setLeagueRecordError(""); return; }
    let cancelled = false;
    setLeagueFeed((feed) => (feed?.policyVersionId === leaguePolicyId ? feed : null));
    setLeagueRecord((record) => (record?.policyVersionId === leaguePolicyId ? record : null));
    setLeagueRecordError("");
    setLeagueError("");
    const controller = new AbortController();
    const refreshRecord = () => fetch(`/api/league-record?policyVersionId=${leaguePolicyId}`, {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])}).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the league record");
      if (!cancelled) { setLeagueRecord(data); setLeagueRecordError(""); }
    }).catch((cause: Error) => { if (!cancelled) setLeagueRecordError(cause.message); });
    const refreshEpisodes = () => fetch(`/api/league-episodes?policyVersionId=${leaguePolicyId}`, {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(async (response) => {
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
    const refresh = () => { void refreshEpisodes(); void refreshRecord(); };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
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
  const activeRecord = leagueRecord?.policyVersionId === leaguePolicyId ? leagueRecord : null;
  const leagueReady = !!leagueFeed && leagueFeed.policyVersionId === leaguePolicyId;
  const leagueDecided = leagueRows.filter((episode) => episode.outcome);
  const leagueTally = { won: leagueDecided.filter((episode) => episode.outcome === "won").length, lost: leagueDecided.filter((episode) => episode.outcome === "lost").length, time_limit: leagueDecided.filter((episode) => episode.outcome === "time_limit").length };
  const view = matchView ?? (leagueReady && !leagueRows.length && episodes.length ? "practice" : "league");
  const selectedLeagueEpisode = leagueSelection ? leagueRows.find((episode) => episode.id === leagueSelection.id) : undefined;
  function openLeagueEpisode(episode: LeagueEpisode) {
    if (!leaguePolicyId || recordingCoaching) return;
    setActiveTab("episodes",labMode?"lab":"workspace"); setMatchView("league");
    setSelectedEpisodeId("");
    setLeagueSelection({ id: episode.id, policyVersionId: leaguePolicyId, label: `League round #${episode.round.number} · ${episode.side ?? "both sides"} vs ${leagueAgainst(episode)}` });
    setViewer(null); setReplayError(""); setReplayNote("");
    track(events.replayOpened, { episode_id: episode.id, status: episode.status, source: "league-table", league: true });
    window.setTimeout(() => replayPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }
  const activePlayerId = boardByPolicy.get(activePolicyId)?.player_id ?? policyStats?.entries?.find(e=>e.policyVersionId===activePolicyId)?.playerId;
  const activeStanding = policyStats?.standings?.find(p=>p.player_id===activePlayerId);
  const ownPlayerIds = [...new Set([...(policyStats?.entries?.map(e=>e.playerId) ?? []), ...uploadedVersions.map(v=>boardByPolicy.get(v.policyVersionId)?.player_id)].filter((id):id is string=>!!id))];
  const visibleEpisodes = episodes.filter((episode) => !selectedPolicyId || episode.scores.some((score) => score.policy_version_id === selectedPolicyId));
  const sortedEpisodes = [...visibleEpisodes].sort((a, b) => {
    const value = (episode: ArenaEpisode): string | number | null => {
      const policyId = episodePolicyId(episode);
      if (sort.key === "episode") return (episode.job_index ?? 0) + 1;
      if (sort.key === "development") return selectedPolicyId ? boardByPolicy.get(selectedPolicyId)?.policy_label ?? selectedPolicyId : policyId ? boardByPolicy.get(policyId)?.policy_label ?? policyId : "Mixed";
      if (sort.key === "played") return new Date(episode.completed_at ?? episode.created_at).getTime();
      if (sort.key === "score") return selectedPolicyId ? policyScore(episode, selectedPolicyId) : episodeScore(episode);
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
      if (!cancelled) setViewer({ url: data.viewer_url, ready: data.ready, episodeId: data.episode_id });
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
        if (!cancelled && data.ready) { setReplayError(""); setViewer({ ...viewer, ready: true }); }
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
    setAccountName(data.name ?? null);
    setSubjectId(data.subjectId ?? "");
    if (data.subjectId) identifyStudent(data.subjectId, data.email);
    track(events.signedIn, {});
  }

  async function signOut() {
    companion.stopTalk(); companion.stopScreen();
    track(events.signedOut, {});
    const response = await fetch("/api/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out");
    companion.presentation.reset();
    resetAnalytics();
    setEmail(null);
    setAccountName(null);
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
    setSelectedPolicyId("");
    setSelectedEpisodeId("");
    setLeagueFeed(null);
    setLeagueRecord(null);
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

  const matchStatsBlock = <>
    {matchStats ? <details className="replay-metrics"><summary>Match statistics <span>{matchStats.steps === null ? "" : `${matchStats.steps} steps`}</span></summary>
    <div>{Object.entries(matchStats.game_stats).map(([name, value]) => <span key={name}>{name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>)}
    {matchStats.policy_stats.map((policy) => <span key={policy.position}>Seat {policy.position + 1} reward <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(policy.avg_reward)}</b></span>)}
    {matchStats.policy_stats.flatMap((policy) => Object.entries(policy.avg_metrics).filter(([name]) => name !== "reward").map(([name, value]) => <span key={`${policy.position}-${name}`}>Seat {policy.position + 1} {name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>))}</div>
    </details> : null}
    {matchStatsError && matchStatsError !== replayError ? <p className="error replay-metrics-error">{matchStatsError}</p> : null}
  </>;

  function selectWork(id: string) { if(recordingCoaching)return; setPresentationView(null); setSelectedExperiment(null); setSelectedWork(id); setCreatingWork(false); companion.presentation.manual(); setLabMode(true); selectTab("lab"); if(window.location.pathname!==`/sessions/${id}`)window.history.pushState(null,"",`/sessions/${id}`); }
  useEffect(()=>{
    const restore=()=>{const match=window.location.pathname.match(/^\/sessions\/([^/]+)$/);setSelectedWork(match?.[1]??null);setCreatingWork(false);setPresentationView(null);setSelectedExperiment(null);if(match){selectTab("lab");setLabMode(true);}else{const params=new URLSearchParams(window.location.search);const view=params.get("view");if(params.get("mode")!=="lab"&&(!view||view==="performance"))setSelectedPolicyId("");setLabMode(params.get("mode")==="lab"||!!view&&!["performance","episodes"].includes(view));selectTab(view==="lab"?"lab":workspaceTabs.find(tab=>tab===view)??"performance");setSelectedExperiment(params.get("experiment"));}};
    window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);
  },[]);
  function newWork() { if(recordingCoaching)return; setPresentationView(null); setSelectedExperiment(null); setSelectedWork(null); setCreatingWork(true); setActiveTab("lab"); }
  function labOverview() { setSelectedWork(null); setCreatingWork(false); setPresentationView(null); setActiveTab("lab"); }
  function inspectExperiment(id:string) {
    setSelectedExperiment(id); setSelectedWork(null); setCreatingWork(false); setPresentationView(null);
    companion.presentation.manual(); setLabMode(true); selectTab("experiments");
    const route = `/?view=experiments&experiment=${encodeURIComponent(id)}`;
    if (`${window.location.pathname}${window.location.search}` !== route) window.history.pushState(null, "", route);
  }
  function workOverview() { setSelectedExperiment(null); setSelectedWork(null); setCreatingWork(false); setActiveTab("experiments"); }
  useEffect(() => { if (subjectId) companion.presentation.restoreFor(subjectId); }, [subjectId, companion.presentation.restoreFor]);
  const [wikiPage,setWikiPage]=useState<WikiPage>('overview');
  const [wikiEntry,setWikiEntry]=useState<string|undefined>();
  useEffect(() => { companion.presentation.setHuman({ mode: labMode ? "lab" : "workspace", tab: activeTab, wikiPage, entityId:wikiEntry??null, revision: currentRevision?.ir.update.revision ?? null, branch: branchId ?? null, cycleId: cycleId ?? null, outcomeLast, opponent: opponentFilter, replay: replayId || null }); }, [labMode, activeTab, wikiPage, wikiEntry, currentRevision?.ir.update.revision, branchId, cycleId, outcomeLast, opponentFilter, replayId, companion.presentation.setHuman]);

  const [presentationView,setPresentationView]=useState<WorkspaceView|null>(null);
  const [savedViews,setSavedViews]=useState<{id:string;title:string}[]>([]);
  const [openedViews,setOpenedViews]=useState<WorkspaceView[]>([]);
  useEffect(()=>{setOpenedViews([]);setSavedViews([]);setPresentationView(null);},[email]);
  const viewKey=(view:WorkspaceView)=>view.artifactId ?? JSON.stringify([view.view,view.revision,view.last,view.opponent,view.branchId,view.cycleId,view.highlight,view.wikiPage,view.entityId,view.experimentId,view.opponentPolicyId]);
  const extraViews=[...new Map([...companion.presentation.state.history, ...(companion.presentation.state.current?[companion.presentation.state.current]:[]), ...openedViews,
    ...savedViews.map(v=>({view:"custom" as const,artifactId:v.id,last:10 as const,reason:v.title}))].map(v=>[viewKey(v),v])).values()];
  useEffect(()=>{
    if(!email)return;const abort=new AbortController();
    void fetch("/api/views",{signal:abort.signal}).then(async r=>{if(r.ok)setSavedViews((await r.json()).views);}).catch(()=>{});
    return()=>abort.abort();
  },[email,companion.presentation.state.current?.artifactId]);
  useEffect(()=>{setPresentationView(null);},[activeTab]);
  const openPresentation = useCallback((view: WorkspaceView) => {
    if (recordingCoaching) return;
    const inspect = !!view.revision || !!view.branchId || !!view.cycleId || new URLSearchParams(window.location.search).get("mode") === "lab" || view.view !== "performance";
    setLabMode(inspect);
    window.history.replaceState(null, "", presentationRoute(view) + (inspect && view.view !== "lab" ? "&mode=lab" : ""));
    if(view.view==="custom"){setOpenedViews(old=>[...old.filter(v=>v.artifactId!==view.artifactId),view]);setPresentationView(view);if(window.matchMedia("(max-width: 800px)").matches)closePresent();return;}
    setPresentationView(null);
    setOpponentPolicyId(view.opponentPolicyId);
    selectTab(view.view); if(view.view==="development"){setWikiPage(view.wikiPage??(view.branchId?"source":"overview"));setWikiEntry(view.entityId);} setBranchId(view.branchId); setCycleId(view.cycleId);
    setOutcomeLast(view.last); setOpponentFilter(view.opponent ?? "");
    setViewRevision(view.revision ?? null);
    if ((view.view === "performance" || view.view === "episodes") && !view.revision) setSelectedPolicyId("");
    if (view.revision) {
      const version = workspace?.versions.find(v=>v.revision===view.revision);
      if ((view.view === "performance" || view.view === "episodes") && version?.policyVersionId) setSelectedPolicyId(version.policyVersionId);
    }
    if (view.view === "experiments") { setSelectedExperiment(view.experimentId??null);setSelectedWork(null); setCreatingWork(false); }
    if (window.matchMedia("(max-width: 800px)").matches) closePresent();
  }, [recordingCoaching, workspace?.versions, closePresent]);
  useEffect(()=>companion.presentation.bind(openPresentation),[companion.presentation.bind,openPresentation]);

  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || !email) return;
    const p = new URLSearchParams(window.location.search);
    if (p.has("revision") && !workspace) return;
    deepLinkApplied.current = true;
    if (!p.has("view")) return;
    const result = viewSchema.safeParse({ view: p.get("view"), artifactId:p.get("artifact")??undefined, reason: "Opened from a workspace link", opponentPolicyId:p.get("opponentPolicy")??undefined,experimentId:p.get("experiment")??undefined, wikiPage:p.get("wiki")??undefined, entityId:p.get("entity")??undefined, revision: p.has("revision") ? Number(p.get("revision")) : undefined, branchId: p.get("branch") ?? undefined, cycleId: p.get("cycle") ?? undefined, opponent: p.get("opponent") ?? undefined, last: Number(p.get("last") ?? 10) });
    if (result.success && (!result.data.revision || workspace?.versions.some(v => v.revision === result.data.revision))) openPresentation(result.data);
  }, [email, workspace, openPresentation]);

  const recentRequests=[...requests.requests].sort((a,b)=>Number(b.pinned)-Number(a.pinned));
  const requestLink=(r:typeof requests.requests[number])=><button key={r.id} onClick={()=>requests.open(r.id)} title={r.prompt}><span>{r.pinned?"Pinned":"Recent"}</span><strong>{r.prompt}</strong><span aria-hidden="true">↗</span></button>;
  const workspacePanel = <section className="preview-card" onPointerDownCapture={companion.presentation.manual} onKeyDownCapture={companion.presentation.manual} inert={compactScreen && (presentExpanded || chatOpen)}>
          <div className="tabs" role="tablist" aria-label="Lab views" hidden={!labMode}>
            <div>{labTabs.map(tab=><button key={tab} id={`tab-${tab}`} role="tab" aria-controls={`workspace-${tab}`} aria-selected={activeTab===tab} tabIndex={activeTab===tab?0:-1} className={activeTab===tab?"active":""} disabled={recordingCoaching} onClick={()=>{setPresentationView(null);setSelectedWork(null);setCreatingWork(false);setActiveTab(tab,"lab");}} onKeyDown={e=>{if(!["ArrowRight","ArrowLeft","Home","End"].includes(e.key))return;e.preventDefault();const i=labTabs.indexOf(tab);const next=e.key==="Home"?0:e.key==="End"?labTabs.length-1:(i+(e.key==="ArrowRight"?1:labTabs.length-1))%labTabs.length;setSelectedWork(null);setCreatingWork(false);setPresentationView(null);setActiveTab(labTabs[next],"lab");document.getElementById(`tab-${labTabs[next]}`)?.focus();}}>{tab==="lab"?"Research":tab[0].toUpperCase()+tab.slice(1)}</button>)}</div>
            <span className="league-status"><button type="button" className="notice-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen(!notificationsOpen); if (!notificationsOpen) { track(events.updatesOpened, { unread }); markNoticesRead(); } }}>Updates{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}</button>{defaultPlayer ? <span className="player-label" title="The Softmax player your uploads and league entries are credited to">Player <b>{defaultPlayer}</b></span> : null}<span className="sync-label">{arena ? arena.league.rounds_paused_at ? "Rounds paused" : "Rounds live" : "Connecting…"}<span className="live-indicator" /></span><a className="league-link" href={league.url} target="_blank" rel="noreferrer">League ↗</a></span>
          </div>
          {workspaceError ? <p className="league-data-note" role="status">{workspaceError} {workspace ? "Showing the last loaded data. " : ""}<button className="text-button" onClick={() => setWorkspaceKey(key => key + 1)}>Retry workspace</button></p> : null}
          {extraViews.length && labMode ? <div className="generated-view-tabs" role="tablist" aria-label="Additional views">
            <button role="tab" aria-selected={!presentationView} aria-controls={`workspace-${activeTab}`} onClick={()=>setPresentationView(null)}>Current view</button>
            {extraViews.map(v=><button key={viewKey(v)} id={`extra-${encodeURIComponent(viewKey(v))}`} role="tab" aria-selected={!!presentationView&&viewKey(presentationView)===viewKey(v)} aria-controls="generated-view-panel" title={v.reason} onClick={()=>setPresentationView(v)}>{v.view==="custom" ? savedViews.find(s=>s.id===v.artifactId)?.title ?? v.reason : `${v.view[0].toUpperCase()+v.view.slice(1)}${v.opponent?` · ${v.opponent}`:v.revision?` · r${v.revision}`:" · Preston"}`}</button>)}
          </div> : null}
          {presentationView?<div id="generated-view-panel" role="tabpanel" aria-labelledby={`extra-${encodeURIComponent(viewKey(presentationView))}`}><PresentationPane key={viewKey(presentationView)} view={presentationView} onOpen={openPresentation}/></div>:null}
          {labMode && notificationsOpen ? <div className="notice-panel" role="region" aria-label="Policy updates"><div className="notice-panel-head"><strong>Policy updates</strong><button type="button" className="text-button" onClick={() => setNotificationsOpen(false)}>Close ×</button></div>{notices.length ? notices.map((notice) => <div key={notice.id} className={`notice-row ${notice.kind}`}><b>{notice.title}</b><span>{notice.detail}</span><small>{new Date(notice.at).toLocaleString()}</small></div>) : <p className="muted">Your saves, uploads, and hosted game results appear here.</p>}</div> : null}
          <div className="workspace-tab" id="workspace-performance" role="tabpanel" aria-labelledby="tab-performance" hidden={!!presentationView || activeTab !== "performance"}><div className="episodes-view">
            {labMode?<div className="league-overview-heading"><h2>Performance</h2><button className="text-button" onClick={()=>setRefreshKey(k=>k+1)}>Refresh</button></div>:null}
            <div hidden={labMode||activeTab!=="performance"||!!presentationView}><WorkspaceComposer key={`${subjectId}:${league.id}`} settings={chatSettings} disabled={recordingCoaching||presentBusy} onRequest={(id,text,mode)=>{setChatOpen(false);setPresentExpanded(false);requests.start(id,text,mode,activePolicyId);}}/>{requests.requests.length?<nav className="workspace-recent-requests" aria-label="Recent requests">{recentRequests.slice(0,3).map(requestLink)}{recentRequests.length>3?<details className="workspace-request-history"><summary>All requests ({recentRequests.length})</summary><div>{recentRequests.slice(3).map(requestLink)}</div></details>:null}</nav>:null}</div>
            {!labMode&&activeTab==="performance"&&!presentationView?<CoachingHome standings={policyStats?.standings??[]} activePlayerId={activePlayerId} activePolicyId={activePolicyId} currentPolicyLabel={currentLeaguePolicyId?policyLabel(currentLeaguePolicyId):""} record={activeRecord}
              loading={!policyStats&&!policyStatsError} stale={!!policyStatsError||!!leagueRecordError||!!leagueError||!!workspaceError} replayLoading={!leagueReady&&!leagueError||!arena&&!arenaError} replayError={leagueError||arenaError}
              replays={[...leagueRows.filter(e=>e.status==="completed"&&!!e.replay_url).map(e=>({id:e.id,episodeId:e.episode_id,label:`League round #${e.round.number}`,kind:"league" as const,outcome:e.outcome,createdAt:e.created_at,opponents:leagueAgainst(e)})),...episodes.filter(e=>e.status==="completed"&&!!e.replay_url&&(!activePolicyId||e.scores.some(score=>score.policy_version_id===activePolicyId))).map(e=>({id:e.id,episodeId:e.episode_id,label:e.run_title??"Practice game",kind:"practice" as const,outcome:null,createdAt:e.created_at,opponents:""}))]}
              sessions={coaching} coachingLoaded={coachingLoaded} coachingError={coachingError} tasks={taskFeed.tasks} onInspectTask={selectWork} onDiscuss={(text,context)=>setAnalysisRequest({id:Date.now(),text,context})} onRefresh={()=>setRefreshKey(key=>key+1)}
              onReplay={replay=>{if(replay.kind==="league"){const episode=leagueRows.find(e=>e.id===replay.id);if(episode)openLeagueEpisode(episode);}else{const episode=episodes.find(e=>e.id===replay.id);if(episode)openReference({kind:"replay-note",episodeId:episode.id,runId:episode.run_id,label:replay.label});}}}/>:null}
            {labMode?<section aria-label="Performance details">
            <div className="league-data-note">{policyStatsError || leagueRecordError || leagueError ? "Some results could not refresh. Displayed data may be out of date." : policyStats?.checkedAt ? `Updated ${new Date(policyStats.checkedAt).toLocaleTimeString()} · MMR belongs to the player across policy versions.` : "Loading live league data…"}</div>
            <div className="performance-filters"><SelectField aria-label="Choose policy version" value={selectedPolicyId} disabled={recordingCoaching} onValueChange={setSelectedPolicyId} options={policyVersionOptions.map(o=>({...o,label:o.label.replace(" · all practice games","")}))}/><label>Episodes <SelectField aria-label="Outcome window" value={String(outcomeLast)} onValueChange={v=>setOutcomeLast(Number(v) as 10|25|50)} options={[10,25,50].map(n=>({value:String(n),label:`Last ${n}`}))}/></label><Input className="text-xs" aria-label="Opponent filter" value={opponentFilter} onChange={e=>setOpponentFilter(e.target.value)} placeholder="Filter opponents"/></div>
            <PerformanceEvidence standings={policyStats?.standings ?? []} ownPlayerIds={ownPlayerIds} activePlayerId={activePlayerId} rounds={leagueRows} last={outcomeLast} opponent={opponentFilter} error={leagueError} loading={(!policyStats && !policyStatsError) || (!!leaguePolicyId && !leagueReady && !leagueError)} onRound={id=>{const round=leagueRows.find(r=>r.id===id);if(round)openLeagueEpisode(round);}}/>
            </section>:null}
          </div></div>
          <div className="workspace-tab" id="workspace-episodes" role="tabpanel" aria-labelledby="tab-episodes" hidden={!!presentationView || activeTab !== "episodes"}><div className="episodes-view compact-episodes">
            <div className="episode-toolbar">{!labMode?<button className="text-button" disabled={recordingCoaching} onClick={()=>setActiveTab("performance")}>← Back</button>:null}<h2>{labMode?"Episodes":"Coach this replay"}</h2>{labMode?<SelectField aria-label="Episodes policy version" value={selectedPolicyId} disabled={recordingCoaching} onValueChange={id=>{setSelectedPolicyId(id);setSelectedEpisodeId("");setLeagueSelection(null);setViewer(null);}} options={policyVersionOptions}/>:null}</div>
            {leagueSelection ? <section ref={replayPanelRef} className="replay-panel" aria-label="Selected league replay">
              <div className="replay-head"><div><span className="eyebrow">League replay{selectedLeagueEpisode?.outcome ? ` · ${leagueOutcomeLabel[selectedLeagueEpisode.outcome]}` : ""}</span><strong>{leagueSelection.label}</strong></div>
                <div className="replay-head-actions">
                  <button className="text-button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? "Exit full screen" : "Full screen ⤢"}</button>
                  <button className="text-button" disabled={recordingCoaching} onClick={() => { setLeagueSelection(null); setViewer(null); setReplayError(""); if(!labMode)setActiveTab("performance"); }}>Close ×</button></div></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready && coachingAvailable && viewer.episodeId ? <ReplayCoaching key={leagueSelection.id} episode={{id:leagueSelection.id,episode_id:viewer.episodeId,policyVersionId:leagueSelection.policyVersionId,seats:selectedLeagueEpisode?.seats}} sessions={coaching.filter(item=>item.episode_id===viewer.episodeId)} onSaved={()=>setRefreshKey(key=>key+1)} onDiscuss={session=>discussCoaching(session)} onOpenSession={selectWork} onRecordingChange={setRecordingCoaching} replay={<ReplayFrame episodeId={leagueSelection.id} versionId={workspace?.versions.find(v => v.policyVersionId === leaguePolicyId)?.id} src={viewer.url} title={`Replay for ${leagueSelection.label}`} />}/> : viewer?.ready ? <ReplayFrame episodeId={leagueSelection.id} versionId={workspace?.versions.find(v => v.policyVersionId === leaguePolicyId)?.id} src={viewer.url} title={`Replay for ${leagueSelection.label}`} /> : <div className="replay-state">Starting replay…</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${leagueSelection.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {selectedLeagueEpisode ? <span title={leagueRoster(selectedLeagueEpisode)}>{selectedLeagueEpisode.side ? `Your heroes: ${selectedLeagueEpisode.side} side, seat${selectedLeagueEpisode.seats.length === 1 ? "" : "s"} ${selectedLeagueEpisode.seats.map((seat) => seat + 1).join(", ")}` : ""}</span> : null}
              </div>
              {labMode?matchStatsBlock:null}
              {!coachingAvailable || !viewer?.episodeId ? <div className="replay-note-box"><label htmlFor="league-replay-note">Notice something?</label>
                <div><Textarea className="text-xs" id="league-replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={discussLeagueReplay}>Discuss in chat ↗</button></div></div>:null}
            </section> : null}
            {selectedEpisode ? <section ref={replayPanelRef} className="replay-panel" aria-label="Selected replay">
              <div className="replay-head"><div><span className="eyebrow">Replay · #{(selectedEpisode.job_index ?? 0) + 1}</span><strong>{selectedEpisode.run_title || "Hosted game"}</strong></div>
                <div className="replay-head-actions">
                  <button className="text-button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? "Exit full screen" : "Full screen ⤢"}</button>
                  <button className="text-button" disabled={recordingCoaching} onClick={() => { setSelectedEpisodeId(""); setViewer(null); setReplayError(""); if(!labMode)setActiveTab("performance"); }}>Close ×</button></div></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready && coachingAvailable && selectedEpisode.episode_id ? <ReplayCoaching key={selectedEpisode.id} episode={selectedEpisode} sessions={coaching.filter((item) => item.episode_id === selectedEpisode.episode_id)} onSaved={() => setRefreshKey((key) => key + 1)} onDiscuss={(session) => discussCoaching(session)} onOpenSession={selectWork} onRecordingChange={setRecordingCoaching} focusSessionId={focusCoachingId} replay={<ReplayFrame episodeId={selectedEpisode.id} versionId={workspace?.versions.find(v => selectedEpisode.scores.some(score => score.policy_version_id === v.policyVersionId))?.id} src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} />} /> : viewer?.ready ? <ReplayFrame episodeId={selectedEpisode.id} versionId={workspace?.versions.find(v => selectedEpisode.scores.some(score => score.policy_version_id === v.policyVersionId))?.id} src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} /> : <div className="replay-state">{selectedEpisode.replay_url ? "Starting replay…" : "Replay is not available yet."}</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${selectedEpisode.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {leagueSelection || selectedEpisode ? <BackgroundButton key={leagueSelection?.id??selectedEpisode?.id} label="Analyze replay" onOpen={selectWork} input={{kind:'research',objective:`Analyze episode ${leagueSelection?.id??selectedEpisode?.id}. Read its recorded outcomes, structured statistics and available replay evidence. Explain important decisions only when supported; distinguish measured facts from hypotheses.`,acceptanceCriteria:'Save an evidence-linked analysis, limitations, and concrete follow-up tests.',context:{episodeId:leagueSelection?.id??selectedEpisode?.id,mode:'replay',title:'Replay analysis'}}}/> : null}
                {selectedCoaching?.latest_analysis?.status === "complete" && !viewer?.ready ? <button className="text-button" onClick={() => discussCoaching(selectedCoaching)}>Discuss coaching ↗</button> : null}
                {coachingError ? <span className="error">{coachingError}</span> : null}
              </div>
              {labMode?matchStatsBlock:null}
              {!coachingAvailable ? <div className="replay-note-box"><label htmlFor="replay-note">Notice something?</label>
                <div><Textarea className="text-xs" id="replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={() => discussReplay(selectedEpisode)}>Discuss in chat ↗</button></div></div> : null}
            </section> : null}
            {labMode?<>
            <div className="match-views">
              <div role="tablist" aria-label="Kind of match">
                <button type="button" role="tab" aria-selected={view === "league"} className={view === "league" ? "active" : ""} disabled={recordingCoaching} onClick={() => { setMatchView("league"); track(events.tabViewed, { tab: "league-rounds" }); }}>League rounds <span>{leaguePolicyId ? leagueReady ? `${leagueRows.length}${leagueFeed?.nextCursor ? "+" : ""}` : "…" : 0}</span></button>
                <button type="button" role="tab" aria-selected={view === "practice"} className={view === "practice" ? "active" : ""} disabled={recordingCoaching} onClick={() => { setMatchView("practice"); track(events.tabViewed, { tab: "practice-games" }); }}>Practice games <span>{visibleEpisodes.length}</span></button>
              </div>
              <p>{view === "league" ? "Episodes the league scheduled for this policy version against other players. These decide its rank." : "Hosted self-play that you or the agent requested: one policy controls all ten heroes. These never count in the league."}</p>
            </div>
            {view === "league" ? <>
              {leagueError ? <p className="error">{leagueError}</p> : null}
              {leagueRecordError ? <p className="error">{leagueRecordError}</p> : null}
              {!leaguePolicyId ? <div className="empty-games"><p>League rounds appear here once a revision is uploaded and entered in the league.</p></div>
                : !leagueReady ? leagueError ? null : <p className="muted">Loading league episodes…</p>
                : !leagueRows.length ? <div className="empty-games"><p>{policyLabel(leaguePolicyId)} has not played a league round yet. {entered.has(leaguePolicyId) ? arena?.league.rounds_paused_at ? "It is entered, and league rounds are paused right now." : "It is entered; its first round appears here when the league schedules it." : "It is not entered in the league, so the league does not schedule it."}</p>
                  {leagueEntry && leagueEntry.id !== activeVersion?.id ? <button type="button" className="starter-cta" onClick={() => { setSelectedPolicyId(leagueEntry.policyVersionId); setMatchView("league"); }}>Show league episodes for r{leagueEntry.revision}</button>
                    : activeVersion && !entered.has(leaguePolicyId) ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: `Enter revision r${activeVersion.revision} in the ${league.name} league (${league.id}).` })}>Enter r{activeVersion.revision} in the league ↗</button> : null}</div>
                : <>
                  <p className="league-tally">{leagueDecided.length ? <>Of the {leagueDecided.length} {leagueFeed?.nextCursor ? "newest " : ""}finished episodes: <b>{leagueTally.won} won</b>, <b>{leagueTally.lost} lost</b>, <b>{leagueTally.time_limit} hit the time limit</b> with no fort destroyed. That scores 0 for both sides and is not a win.</> : "No league episode has finished yet."}</p>
                  <div className="episode-table-wrap"><table className="episode-table league-table" aria-label="League episodes"><thead><tr><th>Round</th><th>Played</th><th>Side</th><th>Against</th><th>Result</th><th title="Mean score across the heroes this policy controlled">Score / hero</th></tr></thead><tbody>
                    {leagueRows.map((episode) => {
                      const playable = episode.status === "completed" && !!episode.replay_url && !recordingCoaching;
                      return <tr key={episode.id} className={`${leagueSelection?.id === episode.id ? "selected" : ""}${playable ? "" : " unplayable"}`} tabIndex={playable ? 0 : -1} role="button" data-present-action="click" aria-disabled={!playable} aria-label={`Open replay for league round ${episode.round.number} against ${leagueAgainst(episode)}`} onClick={() => { if (playable) openLeagueEpisode(episode); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                        <td><strong>#{episode.round.number}</strong></td>
                        <td>{new Date(episode.created_at).toLocaleString()}</td>
                        <td>{episode.side ? `${episode.side} · ${episode.seats.length} ${episode.seats.length === 1 ? "hero" : "heroes"}${episode.format === "mixed" ? " · mixed team" : ""}` : "—"}</td>
                        <td className="against-cell" title={leagueRoster(episode)}>{leagueAgainst(episode)}{episode.format === "team" && episode.opponents.length === 1 && episode.opponents[0].player ? <small>{episode.opponents[0].policy}</small> : null}</td>
                        <td className={`result-cell ${episode.outcome ?? ""}`} title={episode.error ?? undefined}>{episode.outcome ? leagueOutcomeLabel[episode.outcome] : leagueStatusLabel[episode.status] ?? "—"}</td>
                        <td className="score-cell">{episode.score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(episode.score)}</td>
                      </tr>;
                    })}</tbody></table></div>
                  <div className="league-more">{leagueFeed?.nextCursor ? <button type="button" className="secondary" disabled={leagueLoading} onClick={loadMoreLeague}>{leagueLoading ? "Loading…" : "Load 50 more"}</button> : null}<span>{leagueFeed?.nextCursor ? `Showing the ${leagueRows.length} newest league episodes for ${policyLabel(leaguePolicyId)}.` : `All ${leagueRows.length} league episodes for ${policyLabel(leaguePolicyId)}.`}</span></div>
                </>}
            </> : <>

            {arenaError ? <p className="error">{arenaError}</p> : null}
            {!arena ? <p className="muted">Loading practice games…</p> : episodes.length === 0 ? <div className="empty-games"><p>{workspace?.experiments.length ? pendingExperiments.length ? "A hosted game is running. Its replay will appear here when ready." : `No playable replay yet. Latest hosted game: ${workspace.experiments[0].status}.` : "No games yet. Ask Preston to upload your policy and start one."}</p>{starterPrompt ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: starterPrompt.text })}>{starterPrompt.label} ↗</button> : workspace?.experiments.length && !pendingExperiments.length ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: "My last hosted game did not produce a replay. Check why, then request one hosted game on my latest saved policy." })}>Check and retry ↗</button> : null}</div> :
              <div className="episode-table-wrap"><table className="episode-table" aria-label="Practice episodes"><thead><tr>{tableColumns.map((column) => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => sortBy(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead><tbody>
                {sortedEpisodes.map((episode) => {
                  const score = selectedPolicyId ? policyScore(episode, selectedPolicyId) : episodeScore(episode);
                  const policyId = selectedPolicyId || episodePolicyId(episode);
                  const standing = policyId ? boardByPolicy.get(policyId) : undefined;
                  return <tr key={episode.id} className={selectedEpisodeId === episode.id ? "selected" : ""} tabIndex={recordingCoaching ? -1 : 0} role="button" data-present-action="click" aria-disabled={recordingCoaching && selectedEpisodeId !== episode.id} aria-label={`Open replay for ${episode.run_title || "hosted game"}, episode ${(episode.job_index ?? 0) + 1}`} onClick={() => { if (recordingCoaching) return; setLeagueSelection(null); setSelectedEpisodeId(episode.id); setViewer(null); setReplayError(""); setReplayNote(""); track(events.replayOpened, { episode_id: episode.id, run_id: episode.run_id, status: episode.status, source: "table" }); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                    <td><strong>#{(episode.job_index ?? 0) + 1}</strong><span>{episode.run_title || "Hosted game"}</span></td>
                    <td className="policy-cell" title={standing?.policy_label ?? policyId ?? "Multiple policies"}>{standing?.policy_label ?? (policyId ? `Policy ${policyId.slice(0, 8)}` : "Mixed")}</td>
                    <td>{new Date(episode.completed_at ?? episode.created_at).toLocaleString()}</td>
                    <td className="score-cell" title={selectedPolicyId ? "Recorded score for the selected policy" : "Average per policy when a match has multiple policies"}>{score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score)}</td>
                  </tr>;
                })}</tbody></table>{!sortedEpisodes.length ? <div className="empty-games">No practice games for this policy version yet.</div> : null}</div>}
            </>}
            </>:null}
          </div></div>
          <div className="workspace-tab" id="workspace-strategy" role="tabpanel" aria-labelledby="tab-strategy" hidden={!!presentationView || activeTab !== "strategy"}><div className="strategy-view"><div className="strategy-version-select"><label>Policy revision <SelectField aria-label="Strategy revision" value={viewRevision === null ? "" : String(viewRevision)} onValueChange={v=>setViewRevision(v ? Number(v) : null)} options={[{value:"",label:"Latest saved policy"},...(workspace?.versions.map(v=>({value:String(v.revision),label:`r${v.revision} · ${v.summary}`})) ?? [])]}/></label></div>{currentRevision ? <StrategyOverview revision={currentRevision} branchId={branchId} onSource={id=>{setBranchId(id);setWikiPage("source");setActiveTab("development");}} onDiscuss={text=>setAnalysisRequest({id:Date.now(),text})}/> : <p>Loading the policy…</p>}<div className="strategy-knowledge-link"><h3>Beliefs and disagreements</h3><p>Inspect our hypotheses, their evidence, and where our views differ.</p><button className="secondary" onClick={()=>{setWikiPage("beliefs");setActiveTab("development");}}>Open shared knowledge ↗</button></div></div></div>
          <div className="workspace-tab" id="workspace-experiments" role="tabpanel" aria-labelledby="tab-experiments" hidden={!!presentationView || activeTab !== "experiments"}><div className="experiments-view">{selectedExperiment ? <ExperimentDetail key={selectedExperiment} id={selectedExperiment} onBack={workOverview} onVersion={revision=>{setViewRevision(revision);setWikiPage("evidence");setActiveTab("development");}} onDiscuss={text=>setAnalysisRequest({id:Date.now(),text})} onReplay={(episodeId,runId)=>openReference({kind:"replay-note",episodeId,runId,label:"Experiment result"})}/> : <ExperimentResults experiments={workspace?.experiments??[]} loading={!workspace&&!workspaceError} error={workspaceError} onInspect={inspectExperiment} onLab={labOverview}/>}</div></div>
          {activeTab==="lab"&&!presentationView ? <section id="workspace-lab" className="preston-lab" role="tabpanel" aria-label="Preston’s Lab">
            <header className="lab-heading"><div><span className="eyebrow">PRESTON’S WORKSPACE</span><h2>Inside the Lab</h2><p>Follow the research, inspect workers, and steer what happens next.</p></div><button className="secondary" disabled={recordingCoaching} onClick={newWork}>New campaign +</button></header>
            <div className="lab-layout"><aside className="lab-sessions"><button className="lab-overview-link" aria-pressed={!selectedWork&&!creatingWork} onClick={labOverview}>Research overview</button><SessionRail feed={taskFeed} selected={selectedWork} onSelect={selectWork} onNew={newWork}/></aside>
              <div className="lab-content">{selectedWork||creatingWork ? <><button className="text-button lab-back" onClick={labOverview}>← Research overview</button><TaskPanel feed={taskFeed} selectedId={selectedWork} creating={creatingWork} onSelect={selectWork} onNew={newWork} onCloseNew={labOverview} onDiscuss={text=>setAnalysisRequest({id:Date.now(),text})}/></> : <ExperimentTable feed={taskFeed} enabled={!selectedWork&&!creatingWork} cycleId={cycleId} onTask={selectWork} onVersion={revision=>{setViewRevision(revision);setActiveTab("strategy");}} onDiscuss={text=>setAnalysisRequest({id:Date.now(),text})} onInspect={inspectExperiment} onExperiment={id=>{const episode=episodes.find(e=>e.run_id===id);if(episode?.replay_url)openReference({kind:"replay-note",episodeId:episode.id,runId:id,label:"Experiment result"});else inspectExperiment(id);}}/>}</div>
            </div>
          </section> : null}
          <div className="workspace-tab" id="workspace-opponents" role="tabpanel" aria-labelledby="tab-opponents" hidden={!!presentationView||activeTab!=="opponents"}>{activeTab==="opponents"?<Opponents initialPolicyId={opponentPolicyId} onSelect={setOpponentPolicyId} onSession={setAnalysisRequest} onOpenTask={selectWork}/>:null}</div>
          <div className="workspace-tab" id="workspace-development" role="tabpanel" aria-labelledby="tab-development" hidden={!!presentationView || activeTab !== "development"}>
            <PolicyWiki revision={currentRevision} page={wikiPage} onPage={setWikiPage} entryId={wikiEntry} onEntry={setWikiEntry} branchId={branchId} onBranch={setBranchId}
              onDiscuss={text=>setAnalysisRequest({id:Date.now(),text})} leagueURL={league.url} experiments={workspace?.experiments??[]}
              onExperiment={inspectExperiment}
              revisionPicker={<SelectField aria-label="Wiki revision" value={viewRevision===null?"":String(viewRevision)} onValueChange={v=>setViewRevision(v?Number(v):null)} options={[{value:"",label:"Latest policy"},...(workspace?.versions.map(v=>({value:String(v.revision),label:`r${v.revision} · ${v.summary}`}))??[])]}/>}
              actions={<><button className="text-button" onClick={downloadPolicy} disabled={!currentRevision}>BASIC ↓</button><button className="text-button" onClick={downloadRevision} disabled={!currentRevision}>IR + BASIC ↓</button></>}
              versions={<>
            {workspace?.latest ? <div className="policy-stages" aria-label="Current policy progress"><span className="done">✓ r{workspace.latest.ir.update.revision} saved</span><span className={latestSavedUpload ? "done" : "waiting"}>{latestSavedUpload ? "✓ Uploaded" : "○ Upload next"}</span><span className={latestGames.some((game) => game.status === "completed") ? "done" : "waiting"}>{latestGames.some((game) => game.status === "completed") ? latestGames.some((game) => game.replayReady) ? "✓ Replay ready" : "✓ Game complete" : latestGames.some((game) => !["failed", "canceled", "cancelled"].includes(game.status)) ? "◌ Hosted game running" : "○ Play hosted game"}</span>{resumePolicy ? <button type="button" className="secondary" onClick={() => setAnalysisRequest({ id: Date.now(), text: resumePolicy.text })}>{resumePolicy.label} ↗</button> : null}</div> : null}
            <div className="policy-toolbar"><div><span className="eyebrow">Symbolic policy</span><h2>hero.bas</h2>
              <p>{viewRevision !== null ? `Revision ${viewRevision}` : workspace?.latest ? `Revision ${workspace.latest.ir.update.revision} · working copy` : "Starter policy"}{currentUpload?.label ? ` · uploaded as ${currentUpload.label}` : ""}{currentUpload ? currentUpload.player ? <> · player <b>{currentUpload.player}</b></> : null : defaultPlayer ? <> · uploads as player <b>{defaultPlayer}</b></> : null}</p></div>
              <div className="policy-actions">
                {currentUpload ? <button className="secondary" onClick={enterLeague}>Enter league ↗</button> : null}</div></div>
            {submission ? <p className="submission">{submission}</p> : null}
            {workspace?.draft ? <div className="draft-banner"><b>{workspace.draft.conflict ? "Draft from an older revision" : "Unsaved policy draft"}</b><span>{Math.ceil(workspace.draft.bytes / 1024)} KiB · kept since {new Date(workspace.draft.updated_at).toLocaleString()}</span><button type="button" className="secondary" onClick={() => setAnalysisRequest({ id: Date.now(), text: workspace.draft?.conflict ? "Merge my older draft/conflicting-hero.bas into the latest saved hero.bas without losing newer changes. Then save, upload, and request one hosted game." : "Finish saving my unsaved hero.bas draft, then upload it and request a hosted game. Check git diff first so you preserve my edit." })}>Finish in chat ↗</button><button type="button" className="text-button" onClick={() => void discardDraft()}>Discard</button></div> : null}
            {workspace?.versions.length ? <ol className="version-history" aria-label="Saved revisions">
              <li className={viewRevision === null ? "active" : ""}><button type="button" onClick={() => setViewRevision(null)}><b>Latest</b><span>Working copy · r{workspace.latest?.ir.update.revision ?? 0}</span></button></li>
              {[...workspace.versions].reverse().map((version) => <li key={version.id} className={viewRevision === version.revision ? "active" : ""}>
                <button type="button" onClick={() => { setViewRevision(version.revision); track(events.revisionViewed, { revision: version.revision, uploaded: !!version.policyVersionId, games: version.games }); }}><b>r{version.revision}</b><span>{version.summary}</span>
                  <small>{new Date(version.created_at).toLocaleString()}{version.label ? ` · ${version.label}${version.player && version.player !== defaultPlayer ? ` · player ${version.player}` : ""}` : " · not uploaded"}{version.scored ? ` · hosted mean ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(version.hostedMean ?? 0)} over ${version.scored} scored seats` : version.games ? ` · ${version.games} game${version.games === 1 ? "" : "s"} requested` : ""}</small></button>
              </li>)}
            </ol> : <div className="version-empty"><p className="muted">No saved revisions yet. Start by uploading the official starter policy as revision 1, then ask Preston for one change at a time. Each save appears here with its hypothesis and results.</p>
              {starterPrompt ? <button type="button" className="starter-cta" onClick={() => setAnalysisRequest({ id: Date.now(), text: starterPrompt.text })}>{starterPrompt.label} ↗</button> : null}</div>}
              </>}
              beliefs={<Together refreshKey={workspaceKey} revision={workspace?.latest?.ir.update.revision ?? null} experiments={workspace?.experiments ?? []}
            onDiscuss={text => setAnalysisRequest({ id: Date.now(), text })} onPolicy={() => {setWikiPage("source");setActiveTab("development");}} onMatches={() => setActiveTab("episodes")}
            onEvidence={(evidence: ClaimInput["evidence"][number]) => {
              if (evidence.kind === "revision") { setViewRevision(Number(evidence.ref));setWikiPage("overview");setActiveTab("development"); }
              else if (evidence.kind === "experiment") {
                const episode = episodes.find(e => e.run_id === evidence.ref);
                if (episode) openReference({ kind: "replay-note", episodeId: episode.id, runId: episode.run_id, label: episode.run_title ?? "Hosted test" });
                else setAnalysisRequest({ id: Date.now(), text: `Inspect hosted test ${evidence.ref} and its evidence for this observation: ${evidence.detail}. Use hosted_game_status; distinguish recorded facts from hypotheses.` });
              }
            }} />}
            />
          </div>

        </section>;

  return <><main inert={requests.isOpen} className={`shell${email ? ` signed-in partner-shell${chatOpen ? " chat-open" : ""}` : ""}`}>
    {toast ? <div className={`app-toast ${toast.kind}`} role="status"><b>{toast.title}</b><span>{toast.detail}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div> : null}
    {!email ? <header className="topbar">
      <a className="brand" href="/">Softmax</a>
      <a className="league-link" href={league.url} target="_blank" rel="noreferrer">{league.name} ↗</a>
    </header> : null}
    {!email ? <div className="intro">
      <p className="eyebrow">Policies, experiments, and replays</p>
      <h1>Build and learn with Preston.</h1>
      <p>Develop game policies together. Test ideas, review what happened, and decide what to try next.</p>
    </div> : null}

    {email === undefined ? <section className="card session-loading" aria-label="Account session"><p role="status">{sessionError ? "Couldn’t connect to your session." : "Loading your session…"}</p>{sessionError ? <button type="button" onClick={() => setSessionAttempt(n => n + 1)}>Retry</button> : null}</section> :
      !email ? <section className="card signin">
        <div><h2>Connect your Softmax account</h2>
          <p>Paste your Softmax user token. We use it to upload and play as you.</p>
          <a href="https://softmax.com/cli-auth" target="_blank" rel="noreferrer">Get a token from Softmax ↗</a>
        </div>
        <form onSubmit={signIn}>
          <label htmlFor="token">User token</label>
          <Input id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required />
          <button type="submit">Get started</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section> : <>
        <header className="partner-header" inert={compactScreen && (presentExpanded || chatOpen)}><div className="partner-brand"><a href="/">Softmax</a><GamePicker leagueName={league.name} onSelect={()=>setActiveTab("performance")} disabled={recordingCoaching} /></div><nav className="workspace-mode-switch" aria-label="Workspace mode">
          <button type="button" aria-pressed={!labMode} disabled={recordingCoaching} onClick={()=>{setPresentationView(null);setSelectedPolicyId("");setActiveTab("performance");}}>Workspace</button>
          <button type="button" aria-pressed={labMode} disabled={recordingCoaching} onClick={()=>{if(selectedWork)selectWork(selectedWork);else{setPresentationView(null);setActiveTab("lab");}}}>Preston’s Lab</button>
        </nav><AccountMenu name={preferredName || accountName?.trim() || defaultPlayer || email.split("@")[0]} email={email} disabled={recordingCoaching} onSignOut={signOut} />
        </header>
        <div className={`partner-body${chatOpen ? " chat-open" : ""}`}>

          {workspacePanel}
        </div>
          <PresentPanel expanded={presentExpanded || chatOpen} busy={presentBusy} activity={presentActivity} feed={taskFeed} waiting={pendingExperiments.length}
            navigationDisabled={recordingCoaching} onClose={closePresent} onOpenSession={selectWork} currentView={activeTab} labMode={labMode} typingOpen={chatOpen}
            onType={()=>{setChatOpen(open=>!open);if(!chatOpen)requestAnimationFrame(()=>chatDock.current?.querySelector<HTMLTextAreaElement>("textarea.aui-composer-input")?.focus());}} onHistory={()=>{setChatAction({id:Date.now(),kind:"history"});setChatOpen(true);}}
            onPrompt={text=>{setChatAction({id:Date.now(),kind:"prompt",text});setChatOpen(true);}}>
          <div ref={chatDock} id="present-chat" className="partner-chat" hidden={!chatOpen} data-composer-open={chatOpen}>
            {/* Hidden chat streams must release HTTP connections. Activity preserves drafts
                and Eve state while detaching effects; durable agent work keeps running. */}
            <Activity mode={companion.phase!=="off"||(chatOpen&&pageVisible&&!requests.isOpen)?"visible":"hidden"}>
              <Chat key={email} action={chatAction} settings={chatSettings} onNeedsInput={openTextChat} onPresence={updatePresence} onActivity={onActivity} onNotice={onChatNotice} onOpenReference={openReference} analysisRequest={analysisRequest} suggestions={[]} starterPrompt={starterPrompt} recordingCoaching={recordingCoaching} playerName={defaultPlayer} />
            </Activity>
          </div>
          </PresentPanel>
          <button id="present-panel-toggle" className="preston-mobile-launcher" type="button" hidden={presentExpanded || chatOpen} aria-label="Open Preston" aria-controls="present-panel" aria-expanded={false} onClick={() => setPresentExpanded(true)}><img src="/preston/preston-kindred-wisp.webp" width={52} height={52} alt="" /></button>
      </>}

  </main><Activity mode={requests.isOpen&&pageVisible?"visible":"hidden"}>{email&&requests.current?<RequestWorkspace key={`${subjectId}:${league.id}:${requests.current.id}`} request={requests.current} leagueId={league.id} leagueName={league.name} settings={chatSettings} feed={taskFeed} visible={requests.isOpen} onUpdate={requests.update} onClose={requests.close} onLab={id=>{requests.close();if(id)selectWork(id);else labOverview();}}/>:null}</Activity></>;
}
