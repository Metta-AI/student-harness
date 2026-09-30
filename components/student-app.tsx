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
  episode_id: string | null; error: string | null; job_index: number | null; completed_at: string | null;
  participant_scores: { position: number; score: number }[];
};
type CoachingSession = {
  id: string; episode_id: string; status: string; created_at: string; duration_ms: number | null;
  latest_analysis: { id: string; status: string } | null;
  feed: { summary: string | null; quote: string | null; insights: string[] } | null;
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
  const [starterSource, setStarterSource] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "policy">("overview");
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);
  const [arena, setArena] = useState<ArenaData | null>(null);
  const [arenaError, setArenaError] = useState("");
  const [coaching, setCoaching] = useState<CoachingSession[]>([]);
  const [coachingAvailable, setCoachingAvailable] = useState<boolean | null>(null);
  const [coachingError, setCoachingError] = useState("");
  const [selectedRun, setSelectedRun] = useState("");
  const [runDetail, setRunDetail] = useState<ExperienceDetail | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [replayNote, setReplayNote] = useState("");
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
    const refresh = () => fetch("/api/coaching").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load coaching sessions");
      setCoaching(data.sessions);
      setCoachingAvailable(data.available);
      setCoachingError("");
    }).catch((cause: Error) => setCoachingError(cause.message));
    refresh();
    const timer = window.setInterval(refresh, 15000);
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
    setCoaching([]);
    setCoachingAvailable(null);
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

  function discussCoaching(item: CoachingSession) {
    setAnalysisRequest({
      id: Date.now(),
      prompt: `Can we talk through what I noticed in this replay?\n\n[coaching-session:${item.id}]`,
    });
  }

  function discussReplay(episode: Episode) {
    const note = replayNote.trim();
    if (!note) return;
    setAnalysisRequest({
      id: Date.now(),
      prompt: `I watched this replay and noticed: ${note}\n\n[replay-note:${episode.id}:${selectedRun}]`,
    });
    setReplayNote("");
  }

  const selectedEpisode = runDetail?.episodes.find((episode) => episode.id === selectedEpisodeId)
    ?? runDetail?.episodes.find((episode) => episode.status === "completed");

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
            <div><button role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Arena</button>
              <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} onClick={() => setActiveTab("policy")}>Policy <span className="tab-code">hero.bas</span></button></div>
            <span className="sync-label">{arena ? arena.league.rounds_paused_at ? "Rounds paused" : "Rounds live" : "Connecting…"}<span className="live-indicator" /></span>
          </div>
          {activeTab === "policy" ? <div className="policy-view">
            <div className="policy-toolbar"><div><span className="eyebrow">02 / Symbolic</span><h2>Policy source</h2><p>{job.result ? "Your latest hosted policy" : "The official starter policy"}</p></div>
              {job.result ? <button className="secondary" onClick={downloadPolicy}>Download hero.bas ↓</button> : <a className="secondary" href="/hero.bas" download="hero.bas">Download hero.bas ↓</a>}</div>
            <pre className="policy-code"><code>{job.result?.source ?? starterSource ?? "Loading hero.bas…"}</code></pre>
          </div> : <div className="overview">
            <section className="arena-hero">
              <div className="hero-copy"><p className="eyebrow">01 / Semantic <span>→</span> 02 / Symbolic <span>→</span> 03 / Replay</p>
                <h2>Ideas become<br /><em>arena moves.</em></h2>
                <p>Shape a strategy in chat. Watch it play. Bring the replay back to improve it.</p>
                <div className="hero-actions">
                  {job.result ? <button className="primary-action" onClick={enterLeague}>Enter the league ↗</button> : <button className="primary-action" onClick={() => setActiveTab("policy")}>Explore the policy ↗</button>}
                  <a href={`https://softmax.com/observatory/v2?tab=leagues&detail=league:${league.id}`} target="_blank" rel="noreferrer">View league ↗</a>
                </div>
              </div>
              <div className="hero-art"><div className="art-grid" aria-hidden="true" /><img className="gota-logo" src="/gota/logo.png" alt="Gods of the Arena" />
                <div className="hero-portraits" aria-hidden="true"><img src="/gota/vanguard-knight.png" alt="" /><img src="/gota/warlock.png" alt="" /><img src="/gota/druid-warden.png" alt="" /></div></div>
            </section>
            {job.status !== "idle" ? <div className="job-banner"><span className="status-dot" />
              <span>{job.status === "completed" ? job.result?.summary : job.status === "failed" ? "The last policy job failed. Ask the coach to try again." : "The cloud agent is building your policy and requesting a hosted episode."}</span></div> : null}
            {submission ? <p className="submission">{submission}</p> : null}
            <section className="episodes-panel">
              <div className="panel-title"><div><p className="eyebrow">03 / Replay</p><h3>Games</h3></div><span className="sync-label">Updates every 15s</span></div>
              {arenaError ? <p className="error">{arenaError}</p> : null}
              {!arena ? <p className="muted">Loading your games…</p> : arena.experiences.length === 0 ?
                <div className="empty-games"><span>◈</span><p>No games yet. Ask the coach to build a policy and start one.</p></div> :
                <div className="run-layout"><div className="run-list" aria-label="Hosted runs">
                  {arena.experiences.slice(0, showAllRuns ? undefined : 4).map((run) => <button key={run.id} className={`run-row ${selectedRun === run.id ? "selected" : ""}`} onClick={() => { setSelectedRun(run.id); setRunDetail(null); setSelectedEpisodeId(""); setReplayNote(""); setShowAllEpisodes(false); }}>
                    <span><strong>{run.title || `Hosted run · ${new Date(run.created_at).toLocaleDateString()}`}</strong>
                      <small>{new Date(run.created_at).toLocaleString()} · {run.completed_count}/{run.episode_count} complete</small></span>
                    <span className={`run-status ${run.status}`}>{run.status}</span>
                  </button>)}
                  {arena.experiences.length > 4 ? <button className="show-more" onClick={() => setShowAllRuns(!showAllRuns)}>{showAllRuns ? "Show recent games ↑" : `All ${arena.experiences.length} games ↓`}</button> : null}</div>
                  <div className="run-detail">
                    {!runDetail || runDetail.id !== selectedRun ? <p className="muted">Loading episodes…</p> : <>
                      <div className="run-detail-head"><div><strong>{runDetail.completed_count} of {runDetail.episode_count} completed</strong>
                        <p>{runDetail.failed_count ? `${runDetail.failed_count} failed · ` : ""}Run {runDetail.status}</p></div>
                        <a href={`https://softmax.com/observatory/v2?tab=experience-requests&detail=experience-request:${selectedRun}`} target="_blank" rel="noreferrer">Run details ↗</a></div>
                      <div className="episode-list">{runDetail.episodes.slice().reverse().slice(0, showAllEpisodes ? undefined : 3).map((episode) => <div className="episode-row" key={episode.id}>
                        <div className="episode-main"><span className="episode-index">#{(episode.job_index ?? 0) + 1}</span>
                          <span><strong>{episode.status === "completed" ? "Replay ready" : `Episode ${episode.status}`}</strong>
                            <small>{episode.completed_at ? new Date(episode.completed_at).toLocaleString() : episode.error ?? "Waiting for the hosted game"}</small></span></div>
                        <div className="episode-actions">
                          {episode.episode_id && episode.replay_url ? <a className="coach-replay-link" href={coachingAvailable ? `https://softmax.com/observatory/v2?tab=overview&detail=episode-coaching:${episode.episode_id}` : `https://softmax.com/observatory/v2?tab=overview&detail=episode-request:${episode.id}`} target="_blank" rel="noreferrer">{coachingAvailable ? "Watch & coach ↗" : "Watch replay ↗"}</a> : null}
                          {coachingAvailable === false && episode.status === "completed" ? <button onClick={() => { setSelectedEpisodeId(episode.id); setReplayNote(""); }}>Add a note</button> : null}
                        </div>
                      </div>)}</div>
                      {runDetail.episodes.length > 3 ? <button className="show-more" onClick={() => setShowAllEpisodes(!showAllEpisodes)}>{showAllEpisodes ? "Show fewer episodes ↑" : `All ${runDetail.episodes.length} episodes ↓`}</button> : null}
                    </>}
                  </div></div>}
              {coachingAvailable === false && selectedEpisode ? <div className="replay-note-box">
                <label htmlFor="replay-note">What stood out in episode #{(selectedEpisode.job_index ?? 0) + 1}?</label>
                <p>Watch the replay, then jot down a moment in your own words. A timestamp helps you return to it.</p>
                <textarea id="replay-note" value={replayNote} onChange={(event) => setReplayNote(event.target.value.slice(0, 1200))} placeholder="At 01:20, my hero kept retreating after its health recovered…" />
                <button className="secondary" disabled={!replayNote.trim()} onClick={() => discussReplay(selectedEpisode)}>Talk it through ↗</button>
              </div> : null}
            </section>
            {coachingAvailable ? <section className="coaching-panel">
              <div className="panel-title"><div><p className="eyebrow">Feedback → next move</p><h3>Replay notes</h3></div>
                <a href="https://softmax.com/observatory/coaching-sessions" target="_blank" rel="noreferrer">All coaching ↗</a></div>
              {coachingError ? <p className="error">{coachingError}</p> : null}
              {coaching.length ? <div className="coaching-list">{coaching.slice(0, 2).map((item) => <div className="coaching-row" key={item.id}>
                <div><span className="coaching-date">{new Date(item.created_at).toLocaleString()} · {item.latest_analysis?.status === "complete" ? "Feedback ready" : item.latest_analysis?.status ?? item.status}</span>
                  <strong>{item.feed?.summary || "Replay coaching session"}</strong>
                  {item.feed?.insights[0] ? <p>{item.feed.insights[0]}</p> : null}</div>
                <div className="coaching-actions"><a href={`https://softmax.com/observatory/v2?tab=overview&detail=coaching-session:${item.id}`} target="_blank" rel="noreferrer">Review ↗</a>
                  {item.latest_analysis?.status === "complete" ? <button onClick={() => discussCoaching(item)}>Discuss in chat ↗</button> : null}</div>
              </div>)}</div> : !coachingError ? <p className="muted">Your replay feedback will appear here after you coach a game.</p> : null}
            </section> : null}
          </div>}
        </section>
      </div>}
  </main>;
}
