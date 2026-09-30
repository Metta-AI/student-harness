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
import { useCallback, useEffect, useMemo, useState } from "react";

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

function ChatMessage() {
  const role = useAuiState((state) => state.message.role);
  return <MessagePrimitive.Root className={`message ${role}`}>
    <span className="message-label">{role === "user" ? "You" : "Arena coach"}</span>
    <MessagePrimitive.Parts components={{ Text: ({ text }) => <p>{text}</p> }} />
  </MessagePrimitive.Root>;
}

function Chat({ onJob, onSignOut }: { onJob: () => void; onSignOut: () => void }) {
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

  return <AssistantRuntimeProvider runtime={runtime}>
    <aside className="chat-rail">
      <div className="rail-top"><a className="brand" href="/">NEURALHUB <span>×</span> ARENA</a>
        <button className="text-button" onClick={onSignOut}>Sign out</button></div>
      <div className="rail-heading"><p className="eyebrow">Arena coach</p><h1>What should your hero do?</h1></div>
      <ThreadListPrimitive.Root className="thread-list">
        <ThreadListPrimitive.New className="new-thread"><span aria-hidden="true">＋</span> New chat</ThreadListPrimitive.New>
        <p className="section-label">Recent chats</p>
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
          <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
        </ThreadPrimitive.Viewport>
        <div className="composer-wrap"><ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input className="composer-input" placeholder="Ask about strategy or build a policy…" />
          <ComposerPrimitive.Send className="send-button">Send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
        <p className="hint">Try: “Build a policy that prioritizes enemy towers.”</p></div>
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
  const [activeTab, setActiveTab] = useState<"policy" | "game">("policy");
  const onJob = useCallback(() => { setActiveTab("game"); setRefreshKey((key) => key + 1); }, []);

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
        <Chat key={email} onJob={onJob} onSignOut={signOut} />
        <section className="preview-card">
          <div className="workspace-topbar"><span>GODS OF THE ARENA</span>
            <a className="league-link" href={`https://softmax.com/observatory/v2?tab=leagues&detail=league:${league.id}`} target="_blank" rel="noreferrer">{league.name} ↗</a></div>
          <div className="preview-header">
            <div><p className="eyebrow">Student workspace</p><h2>Your hero is taking shape.</h2>
              <p className="preview-subtitle">One BASIC file. One hosted game. Your strategy.</p></div>
            <div className="preview-actions"><a href="https://softmax.com/gods-of-the-arena/wiki/policy-and-host-surface" target="_blank" rel="noreferrer">Policy guide ↗</a>
              <a href="/hero.bas" download>Starter file ↓</a></div>
          </div>
          <div className="tabs" role="tablist" aria-label="Workspace views">
            <button role="tab" aria-selected={activeTab === "policy"} className={activeTab === "policy" ? "active" : ""} onClick={() => setActiveTab("policy")}>hero.bas</button>
            <button role="tab" aria-selected={activeTab === "game"} className={activeTab === "game" ? "active" : ""} onClick={() => setActiveTab("game")}>Hosted game</button>
          </div>
          {activeTab === "policy" ? <div className="policy-view">
            <div className="policy-toolbar"><span className="status-dot" /> <span>{job.result ? "Your latest policy" : "Official starter policy"}</span>
              {job.result ? <button className="text-button" onClick={downloadPolicy}>Download file ↓</button> : null}</div>
            <pre className="policy-code"><code>{job.result?.source ?? starterSource ?? "Loading hero.bas…"}</code></pre>
          </div> : <div className="game-view">
          <p className="eyebrow">Hosted match</p>
          <h2>{job.status === "idle" ? "Ready when you are" : job.status === "completed" ? "Game requested" : job.status === "failed" ? "Job failed" : "Agent at work"}</h2>
          <p className="status-copy">{job.status === "idle" ? "Tell the coach to build or improve a policy to start." :
            job.status === "completed" ? job.result?.summary :
            job.status === "failed" ? "Ask the coach to try again. Your previous policy is still available on Softmax." :
            "The cloud job continues even if you close this page."}</p>
          {job.result ? <div className="result">
            <div><span>Policy</span><strong>{job.result.policyLabel}</strong></div>
            <div><span>Hosted request</span><a href={`https://softmax.com/observatory/v2?tab=experience-requests&detail=experience-request:${job.result.xpRequestId}`} target="_blank" rel="noreferrer">{job.result.xpRequestId} ↗</a></div>
            <button className="secondary" onClick={enterLeague}>Enter {league.name}</button>
            {submission ? <p className="submission">{submission}</p> : null}
          </div> : null}
          </div>}
        </section>
      </div>}
  </main>;
}
