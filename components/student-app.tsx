"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PolicyRevision } from "../lib/semantic-ir";
import { episodeScore, policyScore } from "../lib/policy-metrics";
import { SemanticPolicy } from "./semantic-policy";
import { ReplayCoaching } from "./replay-coaching";
import { Chat, type AnalysisRequest } from "./chat";

type WorkspaceVersion = {
  id: string; revision: number; summary: string; created_at: string;
  policyVersionId: string | null; label: string | null; games: number; hostedMean: number | null; scored: number;
};
type WorkspaceExperiment = { xpRequestId: string; title: string; status: string; created_at: string; revision: number | null };
type Workspace = {
  versions: WorkspaceVersion[]; experiments: WorkspaceExperiment[];
  latest: PolicyRevision | null; latestUpload: { policyVersionId: string; label: string } | null;
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
  const [viewRevision, setViewRevision] = useState<number | null>(null);
  const [viewed, setViewed] = useState<{ revision: PolicyRevision; upload: { policyVersionId: string; label: string | null } | null } | null>(null);
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
  const [recordingCoaching, setRecordingCoaching] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  // Tool results refresh the workspace panel; a finished turn also refreshes the arena feeds.
  const onActivity = useCallback((kind: "tool" | "turn") => {
    setWorkspaceKey((key) => key + 1);
    if (kind === "turn") setRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    fetch("/api/session").then((response) => response.json()).then((data) => setEmail(data.email));
    fetch("/api/starter-policy").then((response) => response.json()).then(setStarterRevision);
  }, []);

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
  const currentUpload = viewRevision === null ? latestUpload : viewed?.upload ?? null;
  const pendingExperiments = workspace?.experiments.filter((experiment) => experiment.status !== "completed" && experiment.status !== "failed") ?? [];

  const boardByPolicy = new Map(policyStats?.policies.map((policy) => [policy.policy_version_id, policy]));
  const policyIds = [...new Set(episodes.flatMap((episode) => episode.scores.map((score) => score.policy_version_id)))];
  const activePolicyId = selectedPolicyId || latestUpload?.policyVersionId || policyIds[0] || "";
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
    setViewer(null);
    setCoaching([]);
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
    const response = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policyVersionId }) });
    const data = await response.json();
    setSubmission(response.ok ? `Entry ${data.id}: ${data.status}` : data.error ?? "Submission failed");
  }

  function downloadPolicy() {
    if (!currentRevision) return;
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
      text: `I watched this replay and noticed: ${note}`,
      context: { kind: "replay-note", xp_request_id: episode.run_id, episode_id: episode.id, hint: "Use coaching_feedback with this episode to read its statistics before responding." },
    });
    setReplayNote("");
  }

  function discussCoaching(item: { id: string }) {
    setAnalysisRequest({
      id: Date.now(),
      text: "Can we talk through what I noticed in this replay?",
      context: { kind: "coaching-session", coaching_session_id: item.id, hint: "Read this coaching session with coaching_feedback first. Start from one observed moment and ask one question." },
    });
  }

  function discussPolicyResults() {
    if (!latestActiveEpisode || !activePolicyId) return;
    setAnalysisRequest({
      id: Date.now(),
      text: "How is my policy doing? Use the league record and the latest hosted game to suggest one testable improvement. Ask me what I noticed in the replay.",
      context: { kind: "policy-results", policy_version_id: activePolicyId, xp_request_id: latestActiveEpisode.run_id, episode_id: latestActiveEpisode.id, hint: "Use league_standing and coaching_feedback with this episode. State sample sizes and keep league and hosted results separate." },
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
        <Chat key={email} onActivity={onActivity} onSignOut={signOut} analysisRequest={analysisRequest} recordingCoaching={recordingCoaching} />
        <section className="preview-card">
          <div className="tabs" role="tablist" aria-label="Workspace views">
            <div><button role="tab" aria-selected={activeTab === "episodes"} className={activeTab === "episodes" ? "active" : ""} onClick={() => setActiveTab("episodes")}>Matches</button>
              <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} disabled={recordingCoaching} onClick={() => setActiveTab("policy")}>Policy <span className="tab-code">hero.bas</span></button></div>
            <span className="sync-label">{arena ? arena.league.rounds_paused_at ? "Rounds paused" : "Rounds live" : "Connecting…"}<span className="live-indicator" /></span>
          </div>
          {activeTab === "policy" ? <div className="policy-view">
            <div className="policy-toolbar"><div><span className="eyebrow">Symbolic policy</span><h2>hero.bas</h2>
              <p>{viewRevision !== null ? `Revision ${viewRevision}` : workspace?.latest ? `Revision ${workspace.latest.ir.update.revision} · working copy` : "Starter policy"}{currentUpload?.label ? ` · uploaded as ${currentUpload.label}` : ""}</p></div>
              <div className="policy-actions">
                <button className="secondary" onClick={downloadPolicy} disabled={!currentRevision}>BASIC ↓</button>
                <button className="secondary" onClick={downloadRevision} disabled={!currentRevision}>IR + BASIC ↓</button>
                {currentUpload ? <button className="secondary" onClick={enterLeague}>Enter league ↗</button> : null}</div></div>
            {submission ? <p className="submission">{submission}</p> : null}
            {workspace?.versions.length ? <ol className="version-history" aria-label="Saved revisions">
              <li className={viewRevision === null ? "active" : ""}><button type="button" onClick={() => setViewRevision(null)}><b>Latest</b><span>Working copy · r{workspace.latest?.ir.update.revision ?? 0}</span></button></li>
              {[...workspace.versions].reverse().map((version) => <li key={version.id} className={viewRevision === version.revision ? "active" : ""}>
                <button type="button" onClick={() => setViewRevision(version.revision)}><b>r{version.revision}</b><span>{version.summary}</span>
                  <small>{new Date(version.created_at).toLocaleString()}{version.label ? ` · ${version.label}` : " · not uploaded"}{version.scored ? ` · hosted mean ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(version.hostedMean ?? 0)} over ${version.scored} scored seats` : version.games ? ` · ${version.games} game${version.games === 1 ? "" : "s"} requested` : ""}</small></button>
              </li>)}
            </ol> : <p className="muted version-empty">No saved revisions yet. Ask the coach to change something in hero.bas; each save appears here with its hypothesis and results.</p>}
            {currentRevision ? <SemanticPolicy key={currentRevision.revisionId} revision={currentRevision} /> : <p className="muted policy-loading">Loading hero.bas…</p>}
          </div> : <div className="episodes-view">
            <div className="episodes-heading"><div><img src="/gota/logo.png" alt="" /><div><h2>Matches</h2><p>{episodes.length} hosted games in {league.name}</p></div></div><a className="text-button" href="https://metta-ai.github.io/polyworld-buff/GOTA/players/" target="_blank" rel="noreferrer">Explore player stats ↗</a></div>
            {pendingExperiments.length ? <div className="job-banner"><span className="status-dot" />
              <span>{pendingExperiments.length === 1 ? `Hosted game running: ${pendingExperiments[0].title}` : `${pendingExperiments.length} hosted games running`}. Results appear here and in the chat when they finish.</span></div> : null}
            {episodes.length ? <section className="policy-performance" aria-label="Policy performance">
              <div className="performance-top"><div><span className="eyebrow">Policy performance</span><strong>{boardByPolicy.get(activePolicyId)?.policy_label ?? (activePolicyId === latestUpload?.policyVersionId ? latestUpload?.label : undefined) ?? (activePolicyId ? `Policy ${activePolicyId.slice(0, 8)}` : "Select a policy")}</strong></div>
                <select aria-label="Choose policy version" value={selectedPolicyId} disabled={recordingCoaching} onChange={(event) => { setSelectedPolicyId(event.target.value); setSelectedEpisodeId(""); setViewer(null); }}>
                  <option value="">All matches · latest policy</option>
                  {[...new Set([latestUpload?.policyVersionId, ...policyIds].filter((id): id is string => !!id))].map((id) => <option key={id} value={id}>{boardByPolicy.get(id)?.policy_label ?? (id === latestUpload?.policyVersionId ? latestUpload.label : `Policy ${id.slice(0, 8)}`)}</option>)}
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
                <button className="text-button" disabled={recordingCoaching} onClick={() => { setSelectedEpisodeId(""); setViewer(null); setReplayError(""); }}>Close ×</button></div>
              {replayError ? <div className="replay-state error">{replayError}</div> : viewer?.ready && coachingAvailable && selectedEpisode.episode_id ? <ReplayCoaching key={selectedEpisode.id} episode={selectedEpisode} sessions={coaching.filter((item) => item.episode_id === selectedEpisode.episode_id)} onSaved={() => setRefreshKey((key) => key + 1)} onDiscuss={discussCoaching} onRecordingChange={setRecordingCoaching} replay={<iframe key={viewer.url} className="replay-frame" src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} allow="autoplay; fullscreen" allowFullScreen />} /> : viewer?.ready ? <iframe key={viewer.url} className="replay-frame" src={viewer.url} title={`Replay for episode ${(selectedEpisode.job_index ?? 0) + 1}`} allow="autoplay; fullscreen" allowFullScreen /> : <div className="replay-state">{selectedEpisode.replay_url ? "Starting replay…" : "Replay is not available yet."}</div>}
              <div className="replay-footer">
                <a href={`https://softmax.com/observatory/v2/episode-requests/${selectedEpisode.id}/watch`} target="_blank" rel="noreferrer">Open on Softmax ↗</a>
                {selectedCoaching?.latest_analysis?.status === "complete" && !viewer?.ready ? <button className="text-button" onClick={() => discussCoaching(selectedCoaching)}>Discuss coaching ↗</button> : null}
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
                  return <tr key={episode.id} className={selectedEpisodeId === episode.id ? "selected" : ""} tabIndex={recordingCoaching ? -1 : 0} role="button" aria-disabled={recordingCoaching && selectedEpisodeId !== episode.id} aria-label={`Open replay for ${episode.run_title || "hosted game"}, episode ${(episode.job_index ?? 0) + 1}`} onClick={() => { if (recordingCoaching) return; setSelectedEpisodeId(episode.id); setViewer(null); setReplayError(""); setReplayNote(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
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
