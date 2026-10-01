"use client";

import { useEveAgent, type EveMessage, type EveMessagePart } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { track } from "../lib/analytics";
import { events } from "../lib/analytics-events";

export type ChatReference = {
  kind: "coaching-session" | "replay-note" | "policy-results";
  label: string;
  episodeId: string;
  runId: string;
  coachingSessionId?: string;
  policyVersionId?: string;
};
export type AnalysisRequest = { id: number; text: string; context?: Record<string, string>; reference?: ChatReference };
type ChatRow = { session_id: string; title: string | null; updated_at: string };

const refPattern = /\s*<ref>([\s\S]*?)<\/ref>\s*$/;
const attachmentPattern = /\s*<attachment>([\s\S]*?)<\/attachment>/g;
const nextPattern = /\s*<next>([\s\S]*?)<\/next>\s*$/;

/** Serialize a workspace reference into the message so the durable transcript and the agent both carry it. */
export function withReference(text: string, reference: ChatReference) {
  return `${text}\n\n<ref>${JSON.stringify(reference)}</ref>`;
}

function parseReference(text: string): ChatReference | null {
  const match = refPattern.exec(text);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Partial<ChatReference>;
    if (!value.kind || !value.label || !value.episodeId || !value.runId) return null;
    return value as ChatReference;
  } catch {
    return null;
  }
}

function parseSuggestions(text: string): string[] {
  const match = nextPattern.exec(text);
  if (!match) return [];
  try {
    const value = JSON.parse(match[1]) as unknown;
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4);
  } catch {
    return match[1].split("\n").map((line) => line.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 4);
  }
  return [];
}

const referenceKindLabel: Record<ChatReference["kind"], string> = { "coaching-session": "Coaching session", "replay-note": "Replay note", "policy-results": "Policy results" };

function ReferenceChip({ reference, onOpen }: { reference: ChatReference; onOpen: (reference: ChatReference) => void }) {
  return <button type="button" className="ref-chip" onClick={() => { track(events.referenceOpened, { kind: reference.kind }); onOpen(reference); }} title="Open in the workspace">
    <span className="ref-kind">{referenceKindLabel[reference.kind]}</span><span className="ref-label">{reference.label}</span><span aria-hidden="true">↗</span>
  </button>;
}

const toolLabels: Record<string, string> = {
  bash: "Ran a shell command", read_file: "Read a file", write_file: "Wrote a file", glob: "Listed files", grep: "Searched files",
  web_fetch: "Fetched a page", web_search: "Searched the web", load_skill: "Loaded the rules",
  save_policy_version: "Saved a revision", upload_policy: "Uploaded to Softmax", request_hosted_game: "Requested a hosted game",
  hosted_game_status: "Checked a hosted game", list_policy_versions: "Reviewed saved revisions", league_standing: "Read the league",
  coaching_feedback: "Read replay coaching", enter_league: "League entry",
  load_attachment: "Read an attached file",
};

const backgroundTools = new Set(["bash", "read_file", "glob", "grep", "web_fetch", "web_search", "load_skill", "list_policy_versions", "league_standing", "hosted_game_status", "coaching_feedback"]);

function visibleTool(part: Extract<EveMessagePart, { type: "dynamic-tool" }>) {
  return !backgroundTools.has(part.toolName) || part.state === "output-error" || part.state === "approval-requested";
}

function toolLine(part: Extract<EveMessagePart, { type: "dynamic-tool" }>) {
  const base = toolLabels[part.toolName] ?? part.toolName.replaceAll("_", " ");
  const input = part.input as Record<string, unknown> | undefined;
  const detail = part.toolName === "write_file" && typeof input?.filePath === "string" ? input.filePath
    : part.toolName === "save_policy_version" && typeof input?.summary === "string" ? input.summary
    : part.toolName === "request_hosted_game" && typeof input?.title === "string" ? input.title
    : "";
  return { base, detail: detail.length > 90 ? `${detail.slice(0, 87)}…` : detail };
}

function ToolPart({ part, onRespond, disabled }: { part: Extract<EveMessagePart, { type: "dynamic-tool" }>; onRespond: (requestId: string, optionId: string) => void; disabled: boolean }) {
  const { base, detail } = toolLine(part);
  const display = part.state === "output-error" ? `Failed: ${base.toLowerCase()}` : base;
  const request = part.toolMetadata?.eve?.inputRequest;
  const pending = part.state === "approval-requested" && request;
  const status = part.state === "output-error" ? "failed" : part.state === "output-denied" ? "declined" : part.state === "output-available" ? "done" : part.state === "approval-requested" ? "needs approval" : "running";
  return <div className={`tool-line ${status.replace(" ", "-")}`} title={detail || base}>
    <span className="tool-dot" aria-hidden="true" />
    <span className="tool-text"><b>{display}</b>{detail ? <code>{detail}</code> : null}</span>
    {part.state === "output-error" ? <em className="tool-error">{part.errorText}</em> : null}
    {pending ? <span className="tool-approve">
      <span>{request.prompt}</span>
      {(request.options ?? [{ id: "approve", label: "Approve" }, { id: "deny", label: "Decline" }]).map((option) => <button key={option.id} type="button" disabled={disabled} className={option.style === "danger" ? "secondary" : ""} onClick={() => onRespond(request.requestId, option.id)}>{option.label}</button>)}
    </span> : null}
  </div>;
}

function Message({ message, onRespond, onOpenReference, disabled }: { message: EveMessage; onRespond: (requestId: string, optionId: string) => void; onOpenReference: (reference: ChatReference) => void; disabled: boolean }) {
  const parts = message.parts.filter((part) => part.type === "text" || part.type === "dynamic-tool" || part.type === "authorization");
  if (!parts.length) return null;
  if (message.role === "user") {
    const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const reference = parseReference(text);
    const attachments = [...text.matchAll(attachmentPattern)].flatMap((match): { name: string; type: string; bytes: number }[] => {
      try { const item = JSON.parse(match[1]); return typeof item.name === "string" && typeof item.type === "string" && typeof item.bytes === "number" ? [item] : []; }
      catch { return []; }
    });
    return <article className="message user"><span className="message-label">You</span>
      <p>{text.replace(refPattern, "").replace(attachmentPattern, "")}</p>
      {attachments.map((item, index) => <span key={index} className="message-attachment">{item.type === "policy" ? "BASIC policy" : "Text"} · {item.name} · {Math.ceil(item.bytes / 1024)} KiB</span>)}
      {reference ? <ReferenceChip reference={reference} onOpen={onOpenReference} /> : null}</article>;
  }
  // Show actions that change the student's policy; the reply explains read-only checks.
  const grouped: (EveMessagePart | EveMessagePart[])[] = [];
  for (const part of parts) {
    const last = grouped.at(-1);
    if (part.type === "dynamic-tool" && !visibleTool(part)) continue;
    if (part.type === "dynamic-tool" && Array.isArray(last)) last.push(part);
    else if (part.type === "dynamic-tool") grouped.push([part]);
    else grouped.push(part);
  }
  return <article className={`message assistant${message.metadata?.status === "failed" ? " failed" : ""}`}><span className="message-label">Neural Viking Agent</span>
    {grouped.map((entry, index) => Array.isArray(entry)
      ? <div key={index} className="tool-list">{entry.map((part) => part.type === "dynamic-tool" ? <ToolPart key={part.toolCallId} part={part} onRespond={onRespond} disabled={disabled} /> : null)}</div>
      : entry.type === "text" ? (entry.text.replace(nextPattern, "").trim() ? <div key={index} className="message-text"><Markdown>{entry.text.replace(nextPattern, "")}</Markdown></div> : null)
      : entry.type === "authorization" ? <div key={index} className="tool-line"><span className="tool-dot" /><span className="tool-text"><b>{entry.displayName}</b> {entry.description}</span></div> : null)}
    {message.metadata?.status === "failed" ? <p className="error">The Neural Viking Agent could not finish this reply. Send the message again.</p> : null}
  </article>;
}

export type StarterPrompt = { label: string; text: string; detail: string };

function Thread({ sessionId, initialRequest, onSession, onActivity, onNotice, onOpenReference, onArchive, fallbackSuggestions, starterPrompt, disabled }: {
  sessionId: string | null; initialRequest: AnalysisRequest | null;
  onSession: (sessionId: string, title: string) => void; onActivity: (kind: "tool" | "turn") => void;
  onNotice: (title: string, detail: string) => void;
  onOpenReference: (reference: ChatReference) => void; onArchive: () => void; fallbackSuggestions: string[];
  starterPrompt: StarterPrompt | null; disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [composerError, setComposerError] = useState("");
  const [sending, setSending] = useState(false);
  const firstText = useRef<string>(initialRequest?.text ?? "");
  const started = useRef(false);
  const turnStarted = useRef(0);
  const toolsThisTurn = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const agent = useEveAgent({
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: sessionId !== null,
    onSessionChange: (session) => { if (session && !sessionId) onSession(session.sessionId, firstText.current); },
    onEvent: (event) => {
      if (event.type === "action.result") {
        onActivity("tool");
        const data = event.data as { status?: string; result?: { toolName?: string } } | undefined;
        toolsThisTurn.current += 1;
        track(events.agentToolCompleted, { tool: data?.result?.toolName, status: data?.status });
        if (data?.status === "failed") onNotice("Policy action failed", `${data.result?.toolName?.replaceAll("_", " ") ?? "Agent tool"} failed. Check chat for the reason; the workspace will show any unsaved draft.`);
      }
      if (event.type === "turn.started") { turnStarted.current = Date.now(); toolsThisTurn.current = 0; }
      if (event.type === "turn.completed") {
        onActivity("turn");
        track(events.agentTurnCompleted, { duration_ms: turnStarted.current ? Date.now() - turnStarted.current : undefined, tool_calls: toolsThisTurn.current });
      }
      if (event.type === "input.requested") track(events.agentApprovalRequested, {});
    },
    onError: (error) => { track(events.agentError, { message: error.message.slice(0, 200) }); onNotice("Chat could not finish", error.message.slice(0, 200)); },
  });
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const locked = agent.status === "resuming" || disabled;

  useEffect(() => {
    if (!initialRequest || started.current) return;
    started.current = true;
    const text = initialRequest.reference ? withReference(initialRequest.text, initialRequest.reference) : initialRequest.text;
    track(events.chatStarted, { source: initialRequest.context?.kind ?? "workspace", reference_kind: initialRequest.reference?.kind });
    void agent.send(text, initialRequest.context ? { clientContext: initialRequest.context } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest]);

  useEffect(() => { viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); }, [agent.data.messages]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !attachment) || locked || sending) return;
    setSending(true);
    setComposerError("");
    try {
      let message = text;
      const longPaste = text.length > 4000;
      if (attachment || longPaste) {
        const upload = async (name: string, content: string) => {
          const response = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, content }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not attach the file");
          return { id: data.id as string, type: data.type as string, name, bytes: data.bytes as number };
        };
        const files = [];
        if (attachment) files.push(await upload(attachment.name, await attachment.text()));
        if (longPaste) files.push(await upload("pasted-message.txt", text));
        message = `${longPaste ? "I pasted a long message. Please read the attached text." : text || "Please use my attached file."}\n\n${files.map((file) => `<attachment>${JSON.stringify(file)}</attachment>`).join("\n")}`;
      }
      if (!firstText.current) { firstText.current = message; track(events.chatStarted, { source: "composer" }); }
      await agent.send(message, busy ? { turnPolicy: "steer" } : undefined);
      setDraft("");
      setAttachment(null);
      track(events.chatMessageSent, { length: text.length, steer: busy, source: "composer", attachment: !!attachment || longPaste });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  }, [agent, attachment, busy, draft, locked, sending]);

  const respond = useCallback((requestId: string, optionId: string) => {
    track(events.agentApprovalAnswered, { option: optionId });
    void agent.respond([{ requestId, optionId }]);
  }, [agent]);

  const sendSuggestion = useCallback((text: string, origin: "coach" | "fallback" | "starter_cta") => {
    if (locked || busy) return;
    if (!firstText.current) { firstText.current = text; track(events.chatStarted, { source: origin }); }
    track(events.suggestionClicked, { text: text.slice(0, 120), origin });
    track(events.chatMessageSent, { length: text.length, steer: false, source: origin });
    void agent.send(text);
  }, [agent, busy, locked]);

  const messages = agent.data.messages;
  const threadReference = useMemo(() => {
    for (const message of messages) {
      if (message.role !== "user") continue;
      const reference = parseReference(message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
      if (reference) return reference;
    }
    return null;
  }, [messages]);
  const suggestions = useMemo((): { text: string; origin: "coach" | "fallback" }[] => {
    if (busy || agent.status === "resuming") return [];
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    const fromCoach = last ? parseSuggestions(last.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")) : [];
    return fromCoach.length ? fromCoach.map((text) => ({ text, origin: "coach" as const })) : fallbackSuggestions.map((text) => ({ text, origin: "fallback" as const }));
  }, [agent.status, busy, fallbackSuggestions, messages]);

  return <div className="thread">
    {threadReference ? <div className="thread-about"><span>About</span><ReferenceChip reference={threadReference} onOpen={onOpenReference} /></div> : null}
    <div className="messages" ref={viewport}>
      {agent.data.messages.length === 0 && agent.status !== "resuming" ? <div className="chat-empty"><span className="chat-empty-icon">✳</span>
        {starterPrompt ? <>
          <p><b>Start with a policy.</b> {starterPrompt.detail}</p>
          <button type="button" className="starter-cta" disabled={locked} onClick={() => sendSuggestion(starterPrompt.text, "starter_cta")}>{starterPrompt.label} ↗</button>
          <p>Or describe how you want your hero to play and the Neural Viking Agent turns it into a change to <code>hero.bas</code>.</p>
        </> : <p>Describe how you want your hero to play, ask for a change to <code>hero.bas</code>, or bring back what you noticed in a replay. The Neural Viking Agent edits, uploads, and plays hosted games for you.</p>}</div> : null}
      {agent.status === "resuming" ? <p className="muted chat-state">Reopening this conversation…</p> : null}
      {agent.data.messages.map((message) => <Message key={message.id} message={message} onRespond={respond} onOpenReference={onOpenReference} disabled={locked || busy} />)}
      {busy ? <p className="muted chat-state"><span className="status-dot" /> The Neural Viking Agent is working…</p> : null}
      {agent.error ? <div className="chat-state error-state">
        <p className="error">{/no longer active|session_not_active|not found/i.test(agent.error.message) ? "This conversation can no longer be continued. Start a new chat; your saved revisions and results are unaffected." : agent.error.message}</p>
        {sessionId && /no longer active|session_not_active|not found/i.test(agent.error.message) ? <button type="button" className="secondary" onClick={onArchive}>Remove from the list</button> : null}
      </div> : null}
    </div>
    <div className="composer-wrap">
      {suggestions.length ? <div className="suggestions" aria-label="Suggested next asks">
        {suggestions.map(({ text, origin }) => <button key={text} type="button" className="suggestion" disabled={locked} onClick={() => sendSuggestion(text, origin)}>{text}</button>)}
      </div> : null}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {attachment ? <div className="attachment-chip">{attachment.name} · {Math.ceil(attachment.size / 1024)} KiB <button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}>×</button></div> : null}
      <textarea className="composer-input" placeholder="Describe a strategy, or tell the Neural Viking Agent what to change in hero.bas…" value={draft} disabled={locked}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => track(events.chatPasteAttempted, { length: event.clipboardData.getData("text").length })}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className="composer-footer"><span>{busy ? "Sending now steers the current turn" : "Enter to send · Shift+Enter for a new line"}</span>
        <span className="composer-buttons"><label className="attach-button" title="Attach a .bas or text file">Attach<input type="file" accept=".bas,.txt,.md,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setAttachment(file); setComposerError(""); } event.target.value = ""; }} /></label>{busy ? <button type="button" className="text-button" onClick={() => void agent.cancel()}>Stop</button> : null}
          <button type="submit" className="send-button" disabled={locked || sending || (!draft.trim() && !attachment)}>{sending ? "Attaching…" : "Send"} <span aria-hidden="true">↗</span></button></span></div>
    </form>{composerError ? <p className="error composer-error" role="alert">{composerError}</p> : null}<p className="attachment-help">Large pastes become text attachments. BASIC files: 64 KiB max; notes: 256 KiB max.</p></div>
  </div>;
}

export function Chat({ onActivity, onNotice, onSignOut, onOpenReference, analysisRequest, suggestions, starterPrompt, recordingCoaching }: {
  onActivity: (kind: "tool" | "turn") => void; onSignOut: () => void; onOpenReference: (reference: ChatReference) => void;
  onNotice: (title: string, detail: string) => void;
  analysisRequest: AnalysisRequest | null; suggestions: string[]; starterPrompt: StarterPrompt | null; recordingCoaching: boolean;
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
    <div className="rail-top"><a className="brand" href="/">Softmax IDE <span>Beta</span></a>
      <button className="text-button" disabled={recordingCoaching} onClick={onSignOut}>Sign out</button></div>
    <div className="thread-list">
      <div className="thread-list-header"><span>Conversations</span>
        <button type="button" className="new-thread" onClick={() => { setActive(null); setRequest(null); setDraftKey((key) => key + 1); }}><span aria-hidden="true">＋</span> New chat</button></div>
      <div className="thread-items">
        {chats.map((chat) => <div key={chat.session_id} className="thread-item" data-active={active === chat.session_id ? "" : undefined}>
          <button type="button" className="thread-trigger" onClick={() => { setRequest(null); setActive(chat.session_id); }}>{chat.title || "New chat"}</button>
          <button type="button" className="thread-archive" aria-label="Archive chat" onClick={() => archive(chat.session_id)}>×</button>
        </div>)}
        {!chats.length ? <p className="muted thread-empty">Your conversations with the Neural Viking Agent are saved here.</p> : null}
      </div>
    </div>
    <Thread key={threadKey} sessionId={active} initialRequest={active ? null : request} onSession={onSession} onActivity={onActivity} onNotice={onNotice} onOpenReference={onOpenReference} onArchive={() => { if (active) archive(active); }} fallbackSuggestions={suggestions} starterPrompt={starterPrompt} disabled={recordingCoaching} />
  </aside>;
}
