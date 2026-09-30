"use client";

import { useEveAgent, type EveMessage, type EveMessagePart } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";

export type AnalysisRequest = { id: number; text: string; context?: Record<string, string> };
type ChatRow = { session_id: string; title: string | null; updated_at: string };

const toolLabels: Record<string, string> = {
  bash: "Ran a shell command", read_file: "Read a file", write_file: "Wrote a file", glob: "Listed files", grep: "Searched files",
  web_fetch: "Fetched a page", web_search: "Searched the web", load_skill: "Loaded the rules",
  save_policy_version: "Saved a revision", upload_policy: "Uploaded to Softmax", request_hosted_game: "Requested a hosted game",
  hosted_game_status: "Checked a hosted game", list_policy_versions: "Reviewed saved revisions", league_standing: "Read the league",
  coaching_feedback: "Read replay coaching", enter_league: "League entry",
};

function toolLine(part: Extract<EveMessagePart, { type: "dynamic-tool" }>) {
  const base = toolLabels[part.toolName] ?? part.toolName.replaceAll("_", " ");
  const input = part.input as Record<string, unknown> | undefined;
  const detail = part.toolName === "bash" && typeof input?.command === "string" ? input.command
    : (part.toolName === "write_file" || part.toolName === "read_file") && typeof input?.filePath === "string" ? input.filePath
    : part.toolName === "save_policy_version" && typeof input?.summary === "string" ? input.summary
    : part.toolName === "request_hosted_game" && typeof input?.title === "string" ? input.title
    : "";
  return { base, detail: detail.length > 90 ? `${detail.slice(0, 87)}…` : detail };
}

function ToolPart({ part, onRespond, disabled }: { part: Extract<EveMessagePart, { type: "dynamic-tool" }>; onRespond: (requestId: string, optionId: string) => void; disabled: boolean }) {
  const { base, detail } = toolLine(part);
  const request = part.toolMetadata?.eve?.inputRequest;
  const pending = part.state === "approval-requested" && request;
  const status = part.state === "output-error" ? "failed" : part.state === "output-denied" ? "declined" : part.state === "output-available" ? "done" : part.state === "approval-requested" ? "needs approval" : "running";
  return <div className={`tool-line ${status.replace(" ", "-")}`}>
    <span className="tool-dot" aria-hidden="true" />
    <span className="tool-text"><b>{base}</b>{detail ? <code>{detail}</code> : null}{part.state === "output-error" ? <em>{part.errorText}</em> : null}</span>
    {pending ? <span className="tool-approve">
      <span>{request.prompt}</span>
      {(request.options ?? [{ id: "approve", label: "Approve" }, { id: "deny", label: "Decline" }]).map((option) => <button key={option.id} type="button" disabled={disabled} className={option.style === "danger" ? "secondary" : ""} onClick={() => onRespond(request.requestId, option.id)}>{option.label}</button>)}
    </span> : null}
  </div>;
}

function Message({ message, onRespond, disabled }: { message: EveMessage; onRespond: (requestId: string, optionId: string) => void; disabled: boolean }) {
  const parts = message.parts.filter((part) => part.type === "text" || part.type === "dynamic-tool" || part.type === "authorization");
  if (!parts.length) return null;
  if (message.role === "user") {
    return <article className="message user"><span className="message-label">You</span>
      <p>{message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")}</p></article>;
  }
  return <article className={`message assistant${message.metadata?.status === "failed" ? " failed" : ""}`}><span className="message-label">Coach</span>
    {parts.map((part, index) => part.type === "text" ? (part.text.trim() ? <div key={index} className="message-text"><Markdown>{part.text}</Markdown></div> : null)
      : part.type === "dynamic-tool" ? <ToolPart key={part.toolCallId} part={part} onRespond={onRespond} disabled={disabled} />
      : <div key={index} className="tool-line"><span className="tool-dot" /><span className="tool-text"><b>{part.displayName}</b> {part.description}</span></div>)}
    {message.metadata?.status === "failed" ? <p className="error">The coach could not finish this reply. Send the message again.</p> : null}
  </article>;
}

function Thread({ sessionId, initialRequest, onSession, onActivity, disabled }: {
  sessionId: string | null; initialRequest: AnalysisRequest | null;
  onSession: (sessionId: string, title: string) => void; onActivity: (kind: "tool" | "turn") => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const firstText = useRef<string>(initialRequest?.text ?? "");
  const started = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const agent = useEveAgent({
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: sessionId !== null,
    onSessionChange: (session) => { if (session && !sessionId) onSession(session.sessionId, firstText.current); },
    onEvent: (event) => {
      if (event.type === "action.result") onActivity("tool");
      if (event.type === "turn.completed") onActivity("turn");
    },
    onError: () => undefined,
  });
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const locked = agent.status === "resuming" || disabled;

  useEffect(() => {
    if (!initialRequest || started.current) return;
    started.current = true;
    void agent.send(initialRequest.text, initialRequest.context ? { clientContext: initialRequest.context } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest]);

  useEffect(() => { viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); }, [agent.data.messages]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || locked) return;
    if (!firstText.current) firstText.current = text;
    setDraft("");
    void agent.send(text, busy ? { turnPolicy: "steer" } : undefined);
  }, [agent, busy, draft, locked]);

  const respond = useCallback((requestId: string, optionId: string) => {
    void agent.respond([{ requestId, optionId }]);
  }, [agent]);

  return <div className="thread">
    <div className="messages" ref={viewport}>
      {agent.data.messages.length === 0 && agent.status !== "resuming" ? <div className="chat-empty"><span className="chat-empty-icon">✳</span>
        <p>Describe a strategy, ask about the rules, or bring back what you noticed in a replay.</p></div> : null}
      {agent.status === "resuming" ? <p className="muted chat-state">Reopening this conversation…</p> : null}
      {agent.data.messages.map((message) => <Message key={message.id} message={message} onRespond={respond} disabled={locked || busy} />)}
      {busy ? <p className="muted chat-state"><span className="status-dot" /> The coach is working…</p> : null}
      {agent.error ? <p className="error chat-state">{agent.error.message}</p> : null}
    </div>
    <div className="composer-wrap"><form className="composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea className="composer-input" placeholder="Ask about strategy, or tell the coach what to change…" value={draft} disabled={locked}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} />
      <div className="composer-footer"><span>{busy ? "Sending now steers the current turn" : "Enter to send · Shift+Enter for a new line"}</span>
        <span className="composer-buttons">{busy ? <button type="button" className="text-button" onClick={() => void agent.cancel()}>Stop</button> : null}
          <button type="submit" className="send-button" disabled={locked || !draft.trim()}>Send <span aria-hidden="true">↗</span></button></span></div>
    </form></div>
  </div>;
}

export function Chat({ onActivity, onSignOut, analysisRequest, recordingCoaching }: {
  onActivity: (kind: "tool" | "turn") => void; onSignOut: () => void; analysisRequest: AnalysisRequest | null; recordingCoaching: boolean;
}) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [request, setRequest] = useState<AnalysisRequest | null>(null);
  const seenRequest = useRef(0);

  const loadChats = useCallback(() => fetch("/api/chats").then((response) => response.json()).then((data) => setChats(data.chats ?? [])).catch(() => undefined), []);
  useEffect(() => { void loadChats(); }, [loadChats]);

  useEffect(() => {
    if (!analysisRequest || seenRequest.current === analysisRequest.id) return;
    seenRequest.current = analysisRequest.id;
    setActive(null);
    setRequest(analysisRequest);
    setDraftKey((key) => key + 1);
  }, [analysisRequest]);

  const onSession = useCallback((sessionId: string, title: string) => {
    const label = title.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
    setChats((current) => [{ session_id: sessionId, title: label, updated_at: new Date().toISOString() }, ...current.filter((chat) => chat.session_id !== sessionId)]);
    setActive(sessionId);
    void fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, title: label }) });
  }, []);

  const archive = useCallback((sessionId: string) => {
    setChats((current) => current.filter((chat) => chat.session_id !== sessionId));
    if (active === sessionId) { setActive(null); setRequest(null); setDraftKey((key) => key + 1); }
    void fetch("/api/chats", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  }, [active]);

  const threadKey = useMemo(() => active ?? `new-${draftKey}`, [active, draftKey]);

  return <aside className="chat-rail">
    <div className="rail-top"><a className="brand" href="/">NEURALHUB <span>×</span> ARENA</a>
      <button className="text-button" disabled={recordingCoaching} onClick={onSignOut}>Sign out</button></div>
    <div className="thread-list">
      <div className="thread-list-header"><span>Conversations</span>
        <button type="button" className="new-thread" onClick={() => { setActive(null); setRequest(null); setDraftKey((key) => key + 1); }}><span aria-hidden="true">＋</span> New chat</button></div>
      <div className="thread-items">
        {chats.map((chat) => <div key={chat.session_id} className="thread-item" data-active={active === chat.session_id ? "" : undefined}>
          <button type="button" className="thread-trigger" onClick={() => { setRequest(null); setActive(chat.session_id); }}>{chat.title || "New chat"}</button>
          <button type="button" className="thread-archive" aria-label="Archive chat" onClick={() => archive(chat.session_id)}>×</button>
        </div>)}
        {!chats.length ? <p className="muted thread-empty">Your conversations with the coach are saved here.</p> : null}
      </div>
    </div>
    <Thread key={threadKey} sessionId={active} initialRequest={active ? null : request} onSession={onSession} onActivity={onActivity} disabled={recordingCoaching} />
  </aside>;
}
