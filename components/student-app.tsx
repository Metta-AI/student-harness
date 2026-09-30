"use client";

import {
  AssistantCloud,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PolicyRevision } from "../lib/semantic-ir";
import { episodeScore, policyScore } from "../lib/policy-metrics";
import { SemanticPolicy } from "./semantic-policy";

type Job = {
  status: string;
  result?: {
    source: string;
    revision: PolicyRevision;
    summary: string;
    policyVersionId: string;
    policyLabel: string;
    xpRequestId: string;
  };
};

type League = { id: string; name: string };
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
type PolicyStats = { division: string; windowHours: number; policies: LeaguePolicy[] };
type MatchStats = { steps: number | null; game_stats: Record<string, number>; policy_stats: { position: number; policy_name: string | null; avg_reward: number; avg_metrics: Record<string, number> }[] };
type ReplaySnapshot = { id: string; games: number; windowStart: string; windowEnd: string; record: { wins: number; losses: number; draws: number }; values: Record<string, number> };
type AnalysisRequest = { id: number; prompt: string };
type SortKey = "episode" | "policy" | "played" | "score" | "winRate";
const tableColumns: { key: SortKey; label: string }[] = [
  { key: "episode", label: "Episode" }, { key: "policy", label: "Policy" },
  { key: "played", label: "Played" }, { key: "score", label: "Score" },
  { key: "winRate", label: "Policy win %" },
];
const contextMarker = /\n\n\[(?:coaching-session:csn_[0-9a-f-]{36}|replay-note:ereq_[0-9a-f-]{36}:xreq_[0-9a-f-]{36}|policy-stats:[0-9a-f-]{36}:xreq_[0-9a-f-]{36}:ereq_[0-9a-f-]{36})\]$/;

function episodePolicyId(episode: ArenaEpisode) {
  return episode.scores.length === 1 ? episode.scores[0].policy_version_id : null;
}

function ChatMessage() {
  const role = useAuiState((state) => state.message.role);
  return <MessagePrimitive.Root className={`message ${role}`}>
    <span className="message-label">{role === "user" ? "You" : "Assistant"}</span>
    <MessagePrimitive.Parts components={{ Text: role === "user" ? ({ text }) => <p>{text.replace(contextMarker, "")}</p> : () => <MarkdownTextPrimitive /> }} />
  </MessagePrimitive.Root>;
}

function Chat({ onJob, onSignOut, analysisRequest }: {
  onJob: () => void; onSignOut: () => void; analysisRequest: AnalysisRequest | null;
}) {
  const cloud = useMemo(() => new AssistantCloud({
    baseUrl: process.env.NEXT_PUBLIC_ASSISTANT_BASE_URL!,
    authToken: async () => {
      const response = await fetch("/api/assistant-ui-token", { method: "POST" });
      return response.ok ? response.text() : null;
    },
  }), []);
  const adapter = useMemo<ChatModelAdapter>(() => ({
    async run({ messages, abortSignal }) {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: (() => {
            const all = messages.map((message) => ({
            role: message.role,
            text: message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
            })).filter((message) => message.role === "user" || message.role === "assistant");
            const recent = all.slice(-20);
            const anchor = all.find((message) => contextMarker.test(message.text));
            return anchor && !recent.includes(anchor) ? [anchor, ...all.slice(-19)] : recent;
          })(),
        }),
        signal: abortSignal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Chat request failed");
      if (data.runId) onJob();
      return { content: [{ type: "text", text: data.message }] };
    },
  }), [onJob]);
  const runtime = useLocalRuntime(adapter, { cloud });
  const lastAnalysis = useRef(0);

  useEffect(() => {
    if (!analysisRequest || lastAnalysis.current === analysisRequest.id) return;
    lastAnalysis.current = analysisRequest.id;
    void runtime.threads.switchToNewThread().then(() => runtime.thread.append(analysisRequest.prompt));
  }, [analysisRequest, runtime]);

  return <AssistantRuntimeProvider runtime={runtime}>
    <aside className="chat-rail">
      <div className="rail-top"><a className="brand" href="/">NEURALHUB <span>×</span> ARENA</a>
        <button className="text-button" onClick={onSignOut}>Sign out</button></div>
      <ThreadListPrimitive.Root className="thread-list">
        <div className="thread-list-header"><span>Conversations</span>
          <ThreadListPrimitive.New className="new-thread" aria-label="New chat"><span aria-hidden="true">＋</span> New chat</ThreadListPrimitive.New></div>
        <div className="thread-items"><ThreadListPrimitive.Items>
          {() => <ThreadListItemPrimitive.Root className="thread-item">
            <ThreadListItemPrimitive.Trigger className="thread-trigger">
              <ThreadListItemPrimitive.Title fallback="New chat" />
            </ThreadListItemPrimitive.Trigger>
            <ThreadListItemPrimitive.Archive className="thread-archive" aria-label="Archive chat">×</ThreadListItemPrimitive.Archive>
          </ThreadListItemPrimitive.Root>}
        </ThreadListPrimitive.Items></div>
      </ThreadListPrimitive.Root>
      <ThreadPrimitive.Root className="thread">
        <ThreadPrimitive.Viewport className="messages">
          <ThreadPrimitive.Empty><div className="chat-empty"><span className="chat-empty-icon">✳</span>
            <p>Describe a strategy, or bring back feedback from a replay.</p></div></ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
        </ThreadPrimitive.Viewport>
        <div className="composer-wrap"><ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input className="composer-input" placeholder="Ask about strategy or build a policy…" />
          <div className="composer-footer"><span>Ask, build, or review a game</span>
            <ComposerPrimitive.Send className="send-button">Send <span aria-hidden="true">↗</span></ComposerPrimitive.Send></div>
        </ComposerPrimitive.Root></div>
      </ThreadPrimitive.Root>
    </aside>
  </AssistantRuntimeProvider>;
}

export function StudentApp({ league }: { league: League }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job>({ status: "idle" });
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
  const [coachingAvailable, setCoachingAvailable] = useState(false);
  const [coachingError, setCoachingError] = useState("");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [viewer, setViewer] = useState<{ url: string; ready: boolean } | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replayNote, setReplayNote] = useState("");
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null);
  const [matchStatsError, setMatchStatsError] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest | null>(null);
  const onJob = useCallback(() => { setActiveTab("episodes"); setRefreshKey((key) => key + 1); }, []);

  useEffect(() => {
    fetch("/api/session").then((response) => response.json()).then((data) => setEmail(data.email));
    fetch("/api/starter-policy").then((response) => response.json()).then(setStarterRevision);
  }, []);

  useEffect(() => {
    if (!email) return;
    const refresh = () => fetch("/api/job").then((response) => response.json()).then(setJob);
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey]);

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
    }).catch((cause: Error) => setCoachingError(cause.message));
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

  const boardByPolicy = new Map(policyStats?.policies.map((policy) => [policy.policy_version_id, policy]));
  const policyIds = [...new Set(episodes.flatMap((episode) => episode.scores.map((score) => score.policy_version_id)))];
  const activePolicyId = selectedPolicyId || job.result?.policyVersionId || policyIds[0] || "";
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

  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId);
  const selectedCoaching = coaching.find((item) => item.episode_id === selectedEpisode?.episode_id);

  useEffect(() => {
    if (!selectedEpisode?.replay_url) return;
    let cancelled = false;
    fetch("/api/replay-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: selectedEpisode.run_id, episodeId: selectedEpisode.id }),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open replay");
      if (!cancelled) setViewer({ url: data.viewer_url, ready: data.ready });
    }).catch((cause: Error) => { if (!cancelled) setReplayError(cause.message); });
    return () => { cancelled = true; };
  }, [selectedEpisode?.id, selectedEpisode?.replay_url, selectedEpisode?.run_id]);

  useEffect(() => {
    if (!selectedEpisode || selectedEpisode.status !== "completed") return;
    let cancelled = false;
    setMatchStats(null);
    setMatchStatsError("");
    fetch(`/api/episode-stats?runId=${encodeURIComponent(selectedEpisode.run_id)}&episodeId=${encodeURIComponent(selectedEpisode.id)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load match statistics");
        return data;
      }).then((data) => { if (!cancelled) setMatchStats(data); })
      .catch((cause: Error) => { if (!cancelled) setMatchStatsError(cause.message); });
    return () => { cancelled = true; };
  }, [selectedEpisode?.id, selectedEpisode?.status, selectedEpisode?.run_id]);

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
  }

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    setEmail(null);
    setJob({ status: "idle" });
    setSubmission("");
    setArena(null);
    setEpisodes([]);
    setPolicyStats(null);
    setPolicyStatsError("");
    setReplaySnapshot(null);
    setSnapshotError("");
    setSelectedPolicyId("");
    setSelectedEpisodeId("");
    setViewer(null);
    setCoaching([]);
    setCoachingError("");
    setReplayNote("");
    setMatchStats(null);
    setMatchStatsError("");
    setAnalysisRequest(null);
  }

  async function enterLeague() {
    const response = await fetch("/api/submit", { method: "POST" });
    const data = await response.json();
    setSubmission(response.ok ? `Entry ${data.id}: ${data.status}` : data.error ?? "Submission failed");
  }

  function downloadPolicy() {
    if (!job.result) return;
    const url = URL.createObjectURL(new Blob([job.result.source], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hero.bas";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadRevision() {
    const revision = job.result?.revision ?? starterRevision;
    if (!revision) return;
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
    setAnalysisRequest({
      id: Date.now(),
      prompt: `I watched this replay and noticed: ${note}\n\n[replay-note:${episode.id}:${episode.run_id}]`,
    });
    setReplayNote("");
  }

  function discussCoaching(item: CoachingSession) {
    setAnalysisRequest({
      id: Date.now(),
      prompt: `Can we talk through what I noticed in this replay?\n\n[coaching-session:${item.id}]`,
    });
  }

  function discussPolicyResults() {
    if (!latestActiveEpisode || !activePolicyId) return;
    setAnalysisRequest({
      id: Date.now(),
      prompt: `How is my policy doing? Use the league record and the latest hosted game to suggest one testable improvement. Ask me what I noticed in the replay.\n\n[policy-stats:${activePolicyId}:${latestActiveEpisode.run_id}:${latestActiveEpisode.id}]`,
    });
  }

  return <main className={`shell${email ? " signed-in" : ""}`}>
    {!email ? <header className="topbar">
      <a className="brand" href="/">NEURALHUB <span>×</span> GODS OF THE ARENA</a>
      <a className="league-link" href={`https://softmax.com/observatory/v2?tab=leagues&detail=league:${league.id}`} target="_blank" rel="noreferrer">{league.name} ↗</a>
    </header> : null}
    {!email ? <div className="intro">
      <p className="eyebrow">Diablo Valley College · student arena</p>
      <h1>Describe your strategy.<br /><em>Watch your hero play.</em></h1>
      <p>Ask the coach to build a policy. It writes one BASIC file, uploads it, and starts a hosted game for you.</p>
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
      </section> : <div className="workspace">
        <Chat key={email} onJob={onJob} onSignOut={signOut} analysisRequest={analysisRequest} />
        <section className="preview-card">
          <div className="tabs" role="tablist" aria-label="Workspace views">
            <div><button role="tab" aria-selected={activeTab === "episodes"} className={activeTab === "episodes" ? "active" : ""} onClick={() => setActiveTab("episodes")}>Matches</button>
              <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} onClick={() => setActiveTab("policy")}>Policy <span className="tab-code">hero.bas</span></button></div>
            <span className="sync-label">{arena ? arena.league.rounds_paused_at ? "Rounds paused" : "Rounds live" : "Connecting…"}<span className="live-indicator" /></span>
          </div>
          {activeTab === "policy" ? <div className="policy-view">
            <div className="policy-toolbar"><div><span className="eyebrow">Symbolic policy</span><h2>hero.bas</h2><p>{job.result ? "Latest hosted policy" : "Starter policy"}</p></div>
              <div className="policy-actions">{job.result ? <button className="secondary" onClick={downloadPolicy}>BASIC ↓</button> : <a className="secondary" href="/hero.bas" download="hero.bas">BASIC ↓</a>}
                <button className="secondary" onClick={downloadRevision} disabled={!job.result?.revision && !starterRevision}>IR + BASIC ↓</button>
                {job.result ? <button className="secondary" onClick={enterLeague}>Enter league ↗</button> : null}</div></div>
            {submission ? <p className="submission">{submission}</p> : null}
            {job.result?.revision ?? starterRevision ? <SemanticPolicy key={job.result?.revision?.revisionId ?? "starter"} revision={job.result?.revision ?? starterRevision!} /> : <p className="muted policy-loading">Loading hero.bas…</p>}
          </div> : <div className="episodes-view">
            <div className="episodes-heading"><div><img src="/gota/logo.png" alt="" /><div><h2>Matches</h2><p>{episodes.length} hosted games in {league.name}</p></div></div><a className="text-button" href="https://metta-ai.github.io/polyworld-buff/GOTA/players/" target="_blank" rel="noreferrer">Explore player stats ↗</a></div>
            {job.status !== "idle" && job.status !== "completed" ? <div className="job-banner"><span className="status-dot" />
              <span>{job.status === "failed" ? "The last policy job failed. Ask the coach to try again." : "Building your policy and requesting a hosted episode…"}</span></div> : null}
            {episodes.length ? <section className="policy-performance" aria-label="Policy performance">
              <div className="performance-top"><div><span className="eyebrow">Policy performance</span><strong>{boardByPolicy.get(activePolicyId)?.policy_label ?? job.result?.policyLabel ?? (activePolicyId ? `Policy ${activePolicyId.slice(0, 8)}` : "Select a policy")}</strong></div>
                <select aria-label="Choose policy version" value={selectedPolicyId} onChange={(event) => { setSelectedPolicyId(event.target.value); setSelectedEpisodeId(""); setViewer(null); }}>
                  <option value="">All matches · latest policy</option>
                  {[...new Set([job.result?.policyVersionId, ...policyIds].filter((id): id is string => !!id))].map((id) => <option key={id} value={id}>{boardByPolicy.get(id)?.policy_label ?? (id === job.result?.policyVersionId ? job.result.policyLabel : `Policy ${id.slice(0, 8)}`)}</option>)}
                </select></div>
              <div className="performance-values">
                <div><strong>{activeStanding ? `${(activeStanding.win_rate * 100).toFixed(1)}%` : "—"}</strong><span>League win % · {activeStanding ? `${activeStanding.wins}/${activeStanding.episodes_played} games` : "No league games in window"}</span></div>
                <div><strong>{activeStanding ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(activeStanding.score) : "—"}</strong><span>League score · 72h</span></div>
                <div><strong>{hostedMean === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hostedMean)}</strong><span>Hosted mean score · {activeScores.length} games</span></div>
              </div>
              {replaySnapshot ? <div className="snapshot-metrics"><div><strong>Replay behavior · {replaySnapshot.games} hero-games</strong><span>{new Date(replaySnapshot.windowStart).toLocaleDateString()} – {new Date(replaySnapshot.windowEnd).toLocaleDateString()} · dated snapshot</span></div>
                {["kills", "deaths", "tower_kills", "xp", "rejected_share"].map((name) => <div key={name}><b>{replaySnapshot.values[name] === undefined ? "—" : name === "rejected_share" ? `${(replaySnapshot.values[name] * 100).toFixed(1)}%` : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(replaySnapshot.values[name])}</b><span>{name.replaceAll("_", " ")}</span></div>)}
              </div> : null}
              <div className="performance-bottom"><span>League win % uses competition games from the last 72 hours. Ties for first count as wins. Hosted self-play is scored separately.</span>
                <button className="secondary" disabled={!latestActiveEpisode} onClick={discussPolicyResults}>Discuss results ↗</button></div>
              {policyStatsError ? <p className="error">{policyStatsError}</p> : null}
              {snapshotError ? <p className="error">{snapshotError}</p> : null}
            </section> : null}
            {selectedEpisode ? <section className="replay-panel" aria-label="Selected replay">
              <div className="replay-head"><div><span className="eyebrow">Replay · #{(selectedEpisode.job_index ?? 0) + 1}</span><strong>{selectedEpisode.run_title || "Hosted game"}</strong></div>
                <button className="text-button" onClick={() => { setSelectedEpisodeId(""); setViewer(null); setReplayError(""); }}>Close ×</button></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready ? <iframe key={viewer.url} className="replay-frame" src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} allow="autoplay; fullscreen" allowFullScreen /> : <div className="replay-state">{selectedEpisode.replay_url ? "Starting replay…" : "Replay is not available yet."}</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${selectedEpisode.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {coachingAvailable && selectedEpisode.episode_id ? <a href={`https://softmax.com/observatory/v2?tab=overview&detail=episode-coaching:${selectedEpisode.episode_id}`} target="_blank" rel="noreferrer">Coach this replay ↗</a> : null}
                {selectedCoaching?.latest_analysis?.status === "complete" ? <button className="text-button" onClick={() => discussCoaching(selectedCoaching)}>Discuss coaching ↗</button> : null}
                {coachingError ? <span className="error">{coachingError}</span> : null}
              </div>
              {matchStats ? <details className="replay-metrics"><summary>Match statistics <span>{matchStats.steps === null ? "" : `${matchStats.steps} steps`}</span></summary>
                <div>{Object.entries(matchStats.game_stats).map(([name, value]) => <span key={name}>{name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>)}
                  {matchStats.policy_stats.map((policy) => <span key={policy.position}>Seat {policy.position + 1} reward <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(policy.avg_reward)}</b></span>)}
                  {matchStats.policy_stats.flatMap((policy) => Object.entries(policy.avg_metrics).filter(([name]) => name !== "reward").map(([name, value]) => <span key={`${policy.position}-${name}`}>Seat {policy.position + 1} {name.replaceAll("_", " ")} <b>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}</b></span>))}</div>
              </details> : null}
              {matchStatsError ? <p className="error replay-metrics-error">{matchStatsError}</p> : null}
              <div className="replay-note-box"><label htmlFor="replay-note">Notice something?</label>
                <div><textarea id="replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={() => discussReplay(selectedEpisode)}>Discuss in chat ↗</button></div></div>
            </section> : null}
            {arenaError ? <p className="error">{arenaError}</p> : null}
            {!arena ? <p className="muted">Loading episodes…</p> : episodes.length === 0 ? <div className="empty-games"><p>No games yet. Ask the coach to build a policy and start one.</p></div> :
              <div className="episode-table-wrap"><table className="episode-table"><thead><tr>{tableColumns.map((column) => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => sortBy(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead><tbody>
                {sortedEpisodes.map((episode) => {
                  const score = selectedPolicyId ? policyScore(episode, selectedPolicyId) : episodeScore(episode);
                  const policyId = selectedPolicyId || episodePolicyId(episode);
                  const standing = policyId ? boardByPolicy.get(policyId) : undefined;
                  return <tr key={episode.id} className={selectedEpisodeId === episode.id ? "selected" : ""} tabIndex={0} role="button" aria-label={`Open replay for ${episode.run_title || "hosted game"}, episode ${(episode.job_index ?? 0) + 1}`} onClick={() => { setSelectedEpisodeId(episode.id); setViewer(null); setReplayError(""); setReplayNote(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                    <td><strong>#{(episode.job_index ?? 0) + 1}</strong><span>{episode.run_title || "Hosted game"}</span></td>
                    <td className="policy-cell" title={standing?.policy_label ?? policyId ?? "Multiple policies"}>{standing?.policy_label ?? (policyId ? `Policy ${policyId.slice(0, 8)}` : "Mixed")}</td>
                    <td>{new Date(episode.completed_at ?? episode.created_at).toLocaleString()}</td>
                    <td className="score-cell" title={selectedPolicyId ? "Recorded score for the selected policy" : "Average per policy when a match has multiple policies"}>{score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score)}</td>
                    <td className="win-cell" title="This exact policy version’s win rate in league games over the last 72 hours; not this hosted match’s outcome">{standing ? `${(standing.win_rate * 100).toFixed(1)}%` : "—"}</td>
                  </tr>;
                })}</tbody></table>{!sortedEpisodes.length ? <div className="empty-games">No hosted matches for this policy version yet.</div> : null}</div>}
          </div>}
        </section>
      </div>}
  </main>;
}
