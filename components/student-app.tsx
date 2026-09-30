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

type Job = {
  status: string;
  result?: {
    source: string;
    summary: string;
    policyVersionId: string;
    policyLabel: string;
    xpRequestId: string;
  };
};

type League = { id: string; name: string };
type Experience = {
  id: string; status: string; episode_count: number; completed_count: number;
  failed_count: number; created_at: string; title?: string | null;
};
type Episode = {
  id: string; status: string; replay_url: string | null; live_url: string | null;
  error: string | null; job_index: number | null; completed_at: string | null;
  participant_scores: { position: number; score: number }[];
};
type ArenaData = {
  league: {
    name: string; description: string | null; rounds_paused_at: string | null;
    submissions_locked_at: string | null; settings: { ladder: { enabled: boolean } };
  };
  experiences: Experience[];
};
type ExperienceDetail = Experience & { episodes: Episode[] };
type AnalysisRequest = { id: number; prompt: string };

function ChatMessage() {
  const role = useAuiState((state) => state.message.role);
  return <MessagePrimitive.Root className={`message ${role}`}>
    <span className="message-label">{role === "user" ? "You" : "Assistant"}</span>
    <MessagePrimitive.Parts components={{ Text: role === "user" ? ({ text }) => <p>{text}</p> : () => <MarkdownTextPrimitive /> }} />
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
          messages: messages.map((message) => ({
            role: message.role,
            text: message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
          })).filter((message) => message.role === "user" || message.role === "assistant").slice(-20),
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
            <p>Describe a strategy, or choose a recorded episode to review.</p></div></ThreadPrimitive.Empty>
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
  const [starterSource, setStarterSource] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "policy">("overview");
  const [arena, setArena] = useState<ArenaData | null>(null);
  const [arenaError, setArenaError] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const [runDetail, setRunDetail] = useState<ExperienceDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [analysisRequest, setAnalysisRequest] = useState<AnalysisRequest | null>(null);
  const onJob = useCallback(() => { setActiveTab("overview"); setRefreshKey((key) => key + 1); }, []);

  useEffect(() => {
    fetch("/api/session").then((response) => response.json()).then((data) => setEmail(data.email));
    fetch("/hero.bas").then((response) => response.text()).then(setStarterSource);
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
      if (!response.ok) throw new Error(data.error ?? "Could not load arena");
      setArena(data);
      setArenaError("");
      setSelectedRun((current) => current || data.experiences[0]?.id || "");
    }).catch((cause: Error) => setArenaError(cause.message));
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [email, refreshKey]);

  useEffect(() => {
    if (!email || !selectedRun) return;
    const refresh = () => fetch(`/api/arena/${selectedRun}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load episodes");
      setRunDetail(data);
      setArenaError("");
    }).catch((cause: Error) => setArenaError(cause.message));
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [email, selectedRun, refreshKey]);

  useEffect(() => {
    if (job.result?.xpRequestId) setSelectedRun(job.result.xpRequestId);
  }, [job.result?.xpRequestId]);

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
    setRunDetail(null);
    setSelectedRun("");
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

  function analyzeEpisode(episode: Episode) {
    setAnalysisRequest({
      id: Date.now(),
      prompt: `Analyze episode ${episode.id} from run ${selectedRun}. My notes: ${notes.trim() || "No additional observations."}`,
    });
    setNotes("");
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
          <div className="workspace-topbar"><span>GODS OF THE ARENA</span>
            <a className="league-link" href={`https://softmax.com/observatory/v2?tab=leagues&detail=league:${league.id}`} target="_blank" rel="noreferrer">{league.name} ↗</a></div>
          <div className="preview-header">
            <div><p className="eyebrow">Student workspace</p><h2>Play, review, improve.</h2>
              <p className="preview-subtitle">Your policy and hosted episodes, all in one place.</p></div>
            <div className="preview-actions"><a href="https://softmax.com/gods-of-the-arena/wiki/policy-and-host-surface" target="_blank" rel="noreferrer">Policy guide ↗</a>
              <a href="/hero.bas" download>Starter file ↓</a></div>
          </div>
          <div className="tabs" role="tablist" aria-label="Workspace views">
            <button role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Overview</button>
            <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} onClick={() => setActiveTab("policy")}>hero.bas</button>
          </div>
          {activeTab === "policy" ? <div className="policy-view">
            <div className="policy-toolbar"><span className="status-dot" /> <span>{job.result ? "Your latest policy" : "Official starter policy"}</span>
              {job.result ? <button className="text-button" onClick={downloadPolicy}>Download file ↓</button> : null}</div>
            <pre className="policy-code"><code>{job.result?.source ?? starterSource ?? "Loading hero.bas…"}</code></pre>
          </div> : <div className="overview">
            <section className="league-panel">
              <div className="panel-title"><div><p className="eyebrow">Live league</p><h3>{arena?.league.name ?? league.name}</h3></div>
                <span className={`live-pill ${arena?.league.rounds_paused_at ? "paused" : ""}`}><span />{arena ? arena.league.rounds_paused_at ? "Paused" : "Live" : "Loading"}</span></div>
              <p>{arena?.league.description ?? "Loading league status…"}</p>
              <div className="league-facts"><div><span>Rounds</span><strong>{arena ? arena.league.rounds_paused_at ? "Paused" : "Running" : "—"}</strong></div>
                <div><span>Entries</span><strong>{arena ? arena.league.submissions_locked_at ? "Closed" : "Open" : "—"}</strong></div>
                <div><span>Ladder</span><strong>{arena ? arena.league.settings.ladder.enabled ? "On" : "Off" : "—"}</strong></div></div>
              {job.status !== "idle" ? <div className="job-banner"><span className="status-dot" />
                <span>{job.status === "completed" ? job.result?.summary : job.status === "failed" ? "The last policy job failed. Ask the coach to try again." : "The cloud agent is building your policy and requesting a hosted episode."}</span></div> : null}
              {job.result ? <div className="league-actions"><button className="secondary" onClick={enterLeague}>Enter the league ↗</button>
                {submission ? <span className="submission">{submission}</span> : null}</div> : null}
            </section>
            <section className="episodes-panel">
              <div className="panel-title"><div><p className="eyebrow">Your hosted games</p><h3>Recorded episodes</h3></div>
                <span className="sync-label">Updates every 15s</span></div>
              {arenaError ? <p className="error">{arenaError}</p> : null}
              {!arena ? <p className="muted">Loading your games…</p> : arena.experiences.length === 0 ?
                <p className="muted">No hosted games yet. Ask the coach to build a policy to start one.</p> :
                <div className="run-layout"><div className="run-list" aria-label="Hosted runs">
                  {arena.experiences.map((run) => <button key={run.id} className={`run-row ${selectedRun === run.id ? "selected" : ""}`} onClick={() => { setSelectedRun(run.id); setRunDetail(null); setNotes(""); }}>
                    <span><strong>{run.title || `Hosted run · ${new Date(run.created_at).toLocaleDateString()}`}</strong>
                      <small>{new Date(run.created_at).toLocaleString()} · {run.completed_count}/{run.episode_count} complete</small></span>
                    <span className={`run-status ${run.status}`}>{run.status}</span>
                  </button>)}</div>
                  <div className="run-detail">
                    {!runDetail || runDetail.id !== selectedRun ? <p className="muted">Loading episodes…</p> : <>
                      <div className="run-detail-head"><div><strong>{runDetail.completed_count} of {runDetail.episode_count} completed</strong>
                        <p>{runDetail.failed_count ? `${runDetail.failed_count} failed · ` : ""}Run {runDetail.status}</p></div>
                        <a href={`https://softmax.com/observatory/v2?tab=experience-requests&detail=experience-request:${selectedRun}`} target="_blank" rel="noreferrer">Open on Softmax ↗</a></div>
                      <div className="episode-list">{runDetail.episodes.map((episode) => <div className="episode-row" key={episode.id}>
                        <div className="episode-main"><span className="episode-index">#{(episode.job_index ?? 0) + 1}</span>
                          <span><strong>{episode.status === "completed" ? "Episode recorded" : `Episode ${episode.status}`}</strong>
                            <small>{episode.completed_at ? new Date(episode.completed_at).toLocaleString() : episode.error ?? "Waiting for the hosted game"}</small></span></div>
                        <div className="episode-actions">
                          {episode.replay_url ? <a href={`https://softmax.com/observatory/v2?tab=overview&detail=episode-request:${episode.id}`} target="_blank" rel="noreferrer">Replay ↗</a> : null}
                          {episode.status === "completed" ? <button onClick={() => analyzeEpisode(episode)}>Record &amp; analyze ↗</button> : null}
                        </div>
                      </div>)}</div>
                      {runDetail.episodes.some((episode) => episode.status === "completed") ? <div className="notes-box">
                        <label htmlFor="episode-notes">What did you notice? <span>Optional</span></label>
                        <textarea id="episode-notes" value={notes} onChange={(event) => setNotes(event.target.value.slice(0, 1200))} placeholder="e.g. My hero got stuck near the tower…" />
                        <p>Choose “Record &amp; analyze” above. Your notes and the episode results go into a new saved chat.</p>
                      </div> : null}
                    </>}
                  </div></div>}
            </section>
          </div>}
        </section>
      </div>}
  </main>;
}
