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
type AnalysisRequest = { id: number; prompt: string };
const contextMarker = /\n\n\[(?:coaching-session:csn_[0-9a-f-]{36}|replay-note:ereq_[0-9a-f-]{36}:xreq_[0-9a-f-]{36})\]$/;

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
  const [coaching, setCoaching] = useState<CoachingSession[]>([]);
  const [coachingAvailable, setCoachingAvailable] = useState(false);
  const [coachingError, setCoachingError] = useState("");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [viewer, setViewer] = useState<{ url: string; ready: boolean } | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replayNote, setReplayNote] = useState("");
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
    setSelectedEpisodeId("");
    setViewer(null);
    setCoaching([]);
    setCoachingError("");
    setReplayNote("");
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
            <div><button role="tab" aria-selected={activeTab === "episodes"} className={activeTab === "episodes" ? "active" : ""} onClick={() => setActiveTab("episodes")}>Episodes</button>
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
            <div className="episodes-heading"><div><img src="/gota/logo.png" alt="" /><div><h2>Episodes</h2><p>{episodes.length} games played in {league.name}</p></div></div><span className="sync-label">Updates every 30s</span></div>
            {job.status !== "idle" && job.status !== "completed" ? <div className="job-banner"><span className="status-dot" />
              <span>{job.status === "failed" ? "The last policy job failed. Ask the coach to try again." : "Building your policy and requesting a hosted episode…"}</span></div> : null}
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
              <div className="replay-note-box"><label htmlFor="replay-note">Notice something?</label>
                <div><textarea id="replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero retreated too early…" />
                  <button className="secondary" disabled={!replayNote.trim()} onClick={() => discussReplay(selectedEpisode)}>Discuss in chat ↗</button></div></div>
            </section> : null}
            {arenaError ? <p className="error">{arenaError}</p> : null}
            {!arena ? <p className="muted">Loading episodes…</p> : episodes.length === 0 ? <div className="empty-games"><p>No games yet. Ask the coach to build a policy and start one.</p></div> :
              <div className="episode-table-wrap"><table className="episode-table"><thead><tr><th>Episode</th><th>Played</th><th>Score</th><th>Status</th></tr></thead><tbody>
                {episodes.map((episode) => {
                  const recordedScores = episode.scores.length ? episode.scores.map((item) => item.score) : episode.participant_scores.map((item) => item.score);
                  const score = recordedScores.length ? recordedScores.reduce((total, value) => total + value, 0) / recordedScores.length : null;
                  return <tr key={episode.id} className={selectedEpisodeId === episode.id ? "selected" : ""} tabIndex={0} role="button" aria-label={`Open replay for ${episode.run_title || "hosted game"}, episode ${(episode.job_index ?? 0) + 1}`} onClick={() => { setSelectedEpisodeId(episode.id); setViewer(null); setReplayError(""); setReplayNote(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
                    <td><strong>#{(episode.job_index ?? 0) + 1}</strong><span>{episode.run_title || "Hosted game"}</span></td>
                    <td>{new Date(episode.completed_at ?? episode.created_at).toLocaleString()}</td>
                    <td className="score-cell" title="Average per policy when an episode has multiple policy scores">{score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score)}</td>
                    <td><span className={`episode-status ${episode.status}`}>{episode.status}</span><span className="row-arrow">↗</span></td>
                  </tr>;
                })}</tbody></table></div>}
          </div>}
        </section>
      </div>}
  </main>;
}
