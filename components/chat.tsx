"use client";

import { useEveAgentRuntime, useEveError } from "@assistant-ui/eve";
import { AssistantRuntimeProvider, AuiConfig, Tools, useAui, useAuiEvent, useAuiState, type AssistantRuntime } from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionState, type ConnectionPhase } from "@/components/assistant-ui/elements/connection-state";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { toolkit } from "@/components/assistant-ui/toolkit";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { track } from "../lib/analytics";
import { events } from "../lib/analytics-events";
import { createChatAdapters } from "./chat-adapters";
import { ChatThreadProvider, ReferenceChip, parseReference, refPattern, studentText, useChatThread, withReference, type AnalysisRequest, type ChatReference, type ChatThreadValue, type StarterPrompt, type SuggestionOrigin } from "./chat-context";

export { withReference };
export type { AnalysisRequest, ChatReference, StarterPrompt };

type ChatRow = { session_id: string; title: string | null; updated_at: string };

const toolConfig = AuiConfig({ tools: Tools({ toolkit }) });
const activeChatKey = "softmax-ide-active-chat";
const sessionGone = /no longer active|session_not_active|not found/i;

const userText = (message: { content: readonly { type: string; text?: string }[] }) => message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");

/** Sends the prompt a workspace action prepared (coaching, replay notes, policy results) once the thread mounts. */
function InitialRequest({ request, sendPrompt }: { request: AnalysisRequest | null; sendPrompt: (text: string, context?: Record<string, string>) => void }) {
  const sent = useRef(false);
  useEffect(() => {
    if (!request || sent.current) return;
    sent.current = true;
    sendPrompt(request.reference ? withReference(request.text, request.reference) : request.text, request.context);
  }, [request, sendPrompt]);
  return null;
}

function Welcome() {
  const { starterPrompt, resuming, sendPrompt } = useChatThread();
  if (resuming) {
    return (
      <div role="status" className="flex flex-col gap-y-5 px-2 pb-6">
        <span className="text-muted-foreground text-xs">Reopening this conversation</span>
        <Skeleton className="ml-auto h-8 w-2/5 motion-reduce:animate-none" />
        <div className="flex flex-col gap-y-2">
          <Skeleton className="h-3.5 w-11/12 motion-reduce:animate-none" />
          <Skeleton className="h-3.5 w-4/5 motion-reduce:animate-none" />
          <Skeleton className="h-3.5 w-3/5 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-col gap-2 px-2">
      {starterPrompt ? (
        <>
          <p className="text-[15px] leading-snug font-semibold tracking-tight">Start with a policy.</p>
          <p className="text-muted-foreground text-[13px] leading-relaxed">{starterPrompt.detail}</p>
          <button
            type="button"
            onClick={() => sendPrompt(starterPrompt.text, "starter_cta")}
            className="bg-primary text-primary-foreground hover:bg-accent-foreground focus-visible:ring-ring w-fit rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:bg-primary/90"
          >
            {starterPrompt.label} <span aria-hidden="true">↗</span>
          </button>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Or describe how you want your hero to play and the Neural Viking Agent turns it into a change to <code className="text-foreground text-xs">hero.bas</code>.
          </p>
        </>
      ) : (
        <>
          <p className="text-[15px] leading-snug font-semibold tracking-tight">What should your hero do differently?</p>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Describe a strategy, ask for a change to <code className="text-foreground text-xs">hero.bas</code>, or bring back what you noticed in a replay. Attach a policy file or a screenshot, or dictate with the microphone. The Neural Viking Agent edits, uploads, and plays hosted games for you.
          </p>
        </>
      )}
    </div>
  );
}

/** The workspace object this conversation is about, pinned above the transcript. */
function ThreadAbout() {
  const { onOpenReference } = useChatThread();
  const raw = useAuiState((s) => {
    for (const message of s.thread.messages) {
      if (message.role !== "user") continue;
      const match = refPattern.exec(userText(message));
      if (match) return match[0];
    }
    return "";
  });
  const reference = raw ? parseReference(raw) : null;
  if (!reference) return null;
  return (
    <div className="border-border flex items-center gap-2.5 border-b px-3 py-1.5">
      <span className="text-muted-foreground text-[10px] font-bold tracking-[0.1em] uppercase">About</span>
      <ReferenceChip reference={reference} onOpen={onOpenReference} />
    </div>
  );
}

/**
 * eve keeps the run going on the server when the tab reloads or the network drops. This reports
 * the reconnect: a resumed in-flight reply after a reload, and offline or back-online transitions.
 */
function StreamStatus({ resumed, sentHere, reconnect }: { resumed: boolean; sentHere: () => boolean; reconnect: () => Promise<void> }) {
  const running = useAuiState((s) => s.thread.isRunning);
  const [phase, setPhase] = useState<ConnectionPhase>("online");
  const announced = useRef(false);

  // A reopened conversation that is still generating, without anything sent from this tab: the stream was picked back up.
  useEffect(() => {
    if (!resumed || !running || announced.current || sentHere()) return;
    announced.current = true;
    setPhase("resumed");
    track(events.chatStreamResumed, { cause: "reload" });
  }, [resumed, running, sentHere]);

  useEffect(() => {
    if (phase !== "resumed" || running) return;
    const timer = setTimeout(() => setPhase("online"), 3500);
    return () => clearTimeout(timer);
  }, [phase, running]);

  const retry = useCallback(() => {
    setPhase("reconnecting");
    reconnect().then(() => { setPhase("resumed"); track(events.chatStreamResumed, { cause: "network" }); }, () => setPhase("dropped"));
  }, [reconnect]);

  useEffect(() => {
    const offline = () => setPhase("dropped");
    const online = () => retry();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, [retry]);

  if (phase === "online") return null;
  return <div className="px-4 pt-3"><ConnectionState className="max-w-full" phase={phase} onRetry={retry} /></div>;
}

function SessionError({ canArchive, onArchive }: { canArchive: boolean; onArchive: () => void }) {
  const error = useEveError();
  // A failed reply already shows its error in the transcript; this banner is for a session that cannot continue.
  const shownInThread = useAuiState((s) => s.thread.messages.at(-1)?.status?.type === "incomplete");
  if (!error) return null;
  const gone = sessionGone.test(error.message);
  if (!gone && shownInThread) return null;
  return (
    <div role="alert" className="border-border flex flex-col items-start gap-2 border-t px-4 py-3">
      <p className="text-[13px] leading-relaxed text-red-700">
        {gone ? "This conversation can no longer be continued. Start a new chat; your saved revisions and results are unaffected." : `${error.message} Try again, or start a new chat if it keeps failing. Your saved revisions and results are unaffected.`}
      </p>
      {gone && canArchive ? (
        <button type="button" onClick={onArchive} className="border-input hover:bg-muted focus-visible:ring-ring rounded-md border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2">
          Remove from the list
        </button>
      ) : null}
    </div>
  );
}

/** Product analytics for what the student does in the composer and transcript. */
function ThreadAnalytics({ noteSent }: { noteSent: () => void }) {
  useAuiEvent("composer.send", () => { noteSent(); track(events.chatMessageSent, { source: "composer" }); });
  return null;
}

function ChatThread({ sessionId, initialRequest, onSession, onActivity, onNotice, onOpenReference, onArchive, fallbackSuggestions, starterPrompt, disabled }: {
  sessionId: string | null; initialRequest: AnalysisRequest | null;
  onSession: (sessionId: string, title: string) => void; onActivity: (kind: "tool" | "turn") => void;
  onNotice: (title: string, detail: string) => void;
  onOpenReference: (reference: ChatReference) => void; onArchive: () => void; fallbackSuggestions: string[];
  starterPrompt: StarterPrompt | null; disabled: boolean;
}) {
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const startedFrom = useRef<string>(initialRequest ? initialRequest.context?.kind ?? "workspace" : "composer");
  const startedReference = useRef(initialRequest?.reference?.kind);
  const createdSession = useRef<string | null>(null);
  const announced = useRef(false);
  const sent = useRef(false);
  const turnStarted = useRef(0);
  const toolsThisTurn = useRef(0);
  const [dictationNotice, setDictationNotice] = useState(false);
  const adapters = useMemo(() => createChatAdapters(() => setDictationNotice(true)), []);

  // A new conversation gets its list entry once eve has assigned the session and the first message is known.
  const announce = useCallback((force: boolean) => {
    if (announced.current || !createdSession.current) return;
    const first = runtimeRef.current?.thread.getState().messages.find((message) => message.role === "user");
    const title = first ? studentText(userText(first)) || (userText(first).includes("<attachment>") ? "Attached file" : "") : "";
    if (!title && !force) return;
    announced.current = true;
    track(events.chatStarted, { source: startedFrom.current, reference_kind: startedReference.current });
    onSession(createdSession.current, title || "New chat");
  }, [onSession]);

  const runtime = useEveAgentRuntime({
    ...(sessionId ? { initialSession: { sessionId, streamIndex: 0 }, resume: true } : {}),
    isDisabled: disabled,
    adapters,
    onSessionChange: (session) => {
      if (!session || sessionId) return;
      createdSession.current = session.sessionId;
      announce(false);
    },
    onEvent: (event) => {
      if (event.type === "message.received" || event.type === "turn.started") announce(false);
      if (event.type === "action.result") {
        onActivity("tool");
        const data = event.data as { status?: string; result?: { toolName?: string } } | undefined;
        toolsThisTurn.current += 1;
        track(events.agentToolCompleted, { tool: data?.result?.toolName, status: data?.status });
        if (data?.status === "failed") onNotice("Policy action failed", `${data.result?.toolName?.replaceAll("_", " ") ?? "Agent tool"} failed. Check chat for the reason; the workspace will show any unsaved draft.`);
      }
      if (event.type === "turn.started") { turnStarted.current = Date.now(); toolsThisTurn.current = 0; }
      if (event.type === "turn.completed") {
        announce(true);
        onActivity("turn");
        track(events.agentTurnCompleted, { duration_ms: turnStarted.current ? Date.now() - turnStarted.current : undefined, tool_calls: toolsThisTurn.current });
      }
      if (event.type === "input.requested") track(events.agentApprovalRequested, {});
    },
    onError: (error) => { track(events.agentError, { message: error.message.slice(0, 200) }); onNotice("Chat could not finish", error.message.slice(0, 200)); },
  });
  runtimeRef.current = runtime;

  const append = useCallback((text: string, context?: Record<string, string>) => {
    sent.current = true;
    runtime.thread.append({ role: "user", content: [{ type: "text", text }], ...(context ? { runConfig: { custom: context } } : {}) });
  }, [runtime]);

  const sendPrompt = useCallback((text: string, origin: SuggestionOrigin) => {
    const state = runtime.thread.getState();
    if (state.isRunning || state.isDisabled) return;
    if (!state.messages.length) startedFrom.current = origin;
    track(events.suggestionClicked, { text: text.slice(0, 120), origin });
    track(events.chatMessageSent, { length: text.length, source: origin });
    append(text);
  }, [append, runtime]);

  const sendInitial = useCallback((text: string, context?: Record<string, string>) => {
    track(events.chatMessageSent, { length: text.length, source: startedFrom.current });
    append(text, context);
  }, [append]);

  const reconnect = useCallback(() => runtime.threads.reloadMainThread(), [runtime]);
  const sentHere = useCallback(() => sent.current, []);
  const noteSent = useCallback(() => { sent.current = true; }, []);

  const value = useMemo<ChatThreadValue>(() => ({ resuming: sessionId !== null, starterPrompt, fallbackSuggestions, onOpenReference, sendPrompt }), [fallbackSuggestions, onOpenReference, sendPrompt, sessionId, starterPrompt]);
  const components = useMemo(() => ({ Welcome }), []);

  return (
    <AssistantRuntimeProvider runtime={runtime} config={toolConfig}>
      <TooltipProvider>
        <ChatThreadProvider value={value}>
          <div className="aui-scope border-border flex min-h-0 flex-1 flex-col border-t">
            <InitialRequest request={initialRequest} sendPrompt={sendInitial} />
            <ThreadAnalytics noteSent={noteSent} />
            <ThreadAbout />
            <StreamStatus resumed={sessionId !== null} sentHere={sentHere} reconnect={reconnect} />
            <div className="flex min-h-0 flex-1 flex-col">
              <Thread components={components} autoFocus={false} />
            </div>
            {dictationNotice ? (
              <p role="status" className="text-muted-foreground border-border border-t px-4 py-2 text-xs">
                Dictation could not start in this browser. It works in Chrome, Edge, and Safari with microphone access allowed.{" "}
                <button type="button" className="text-foreground underline underline-offset-2" onClick={() => setDictationNotice(false)}>Dismiss</button>
              </p>
            ) : null}
            <SessionError canArchive={sessionId !== null} onArchive={onArchive} />
          </div>
        </ChatThreadProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

export function Chat({ onActivity, onNotice, onSignOut, onOpenReference, analysisRequest, suggestions, starterPrompt, recordingCoaching }: {
  onActivity: (kind: "tool" | "turn") => void; onSignOut: () => void; onOpenReference: (reference: ChatReference) => void;
  onNotice: (title: string, detail: string) => void;
  analysisRequest: AnalysisRequest | null; suggestions: string[]; starterPrompt: StarterPrompt | null; recordingCoaching: boolean;
}) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  // `active` is the highlighted conversation; `thread` is what is mounted. A new chat keeps its mount when eve assigns its session.
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<{ key: string; sessionId: string | null }>({ key: "new-0", sessionId: null });
  const [request, setRequest] = useState<AnalysisRequest | null>(null);
  const draftCount = useRef(0);
  const seenRequest = useRef(0);
  const restored = useRef(false);

  const remember = useCallback((sessionId: string | null) => {
    try {
      if (sessionId) window.localStorage.setItem(activeChatKey, sessionId);
      else window.localStorage.removeItem(activeChatKey);
    } catch { /* storage unavailable: the conversation just is not restored after a reload */ }
  }, []);

  const startNew = useCallback((next: AnalysisRequest | null) => {
    draftCount.current += 1;
    setActive(null);
    setRequest(next);
    setThread({ key: `new-${draftCount.current}`, sessionId: null });
    remember(null);
  }, [remember]);

  const open = useCallback((sessionId: string) => {
    setRequest(null);
    setActive(sessionId);
    setThread({ key: sessionId, sessionId });
    remember(sessionId);
  }, [remember]);

  // Reopen the conversation that was on screen before a reload, so an in-flight reply is picked back up.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chats").then((response) => response.json()).then((data: { chats?: ChatRow[] }) => {
      if (cancelled) return;
      const rows = data.chats ?? [];
      setChats(rows);
      if (restored.current) return;
      restored.current = true;
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(activeChatKey); } catch { stored = null; }
      if (stored && seenRequest.current === 0 && rows.some((chat) => chat.session_id === stored)) open(stored);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!analysisRequest || seenRequest.current === analysisRequest.id) return;
    seenRequest.current = analysisRequest.id;
    startNew(analysisRequest);
  }, [analysisRequest, startNew]);

  const onSession = useCallback((sessionId: string, title: string) => {
    const label = title.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
    setChats((current) => [{ session_id: sessionId, title: label, updated_at: new Date().toISOString() }, ...current.filter((chat) => chat.session_id !== sessionId)]);
    setActive(sessionId);
    remember(sessionId);
    void fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, title: label }) });
  }, [remember]);

  const archive = useCallback((sessionId: string) => {
    setChats((current) => current.filter((chat) => chat.session_id !== sessionId));
    if (active === sessionId) startNew(null);
    void fetch("/api/chats", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  }, [active, startNew]);

  return <aside className="chat-rail">
    <div className="rail-top"><a className="brand" href="/">Softmax IDE <span>Beta</span></a>
      <button className="text-button" disabled={recordingCoaching} onClick={onSignOut}>Sign out</button></div>
    <div className="thread-list">
      <div className="thread-list-header"><span>Conversations</span>
        <button type="button" className="new-thread" onClick={() => startNew(null)}><span aria-hidden="true">＋</span> New chat</button></div>
      <div className="thread-items">
        {chats.map((chat) => <div key={chat.session_id} className="thread-item" data-active={active === chat.session_id ? "" : undefined}>
          <button type="button" className="thread-trigger" onClick={() => { if (active !== chat.session_id) open(chat.session_id); }}>{chat.title || "New chat"}</button>
          <button type="button" className="thread-archive" aria-label="Archive chat" onClick={() => archive(chat.session_id)}>×</button>
        </div>)}
        {!chats.length ? <p className="muted thread-empty">Your conversations with the Neural Viking Agent are saved here.</p> : null}
      </div>
    </div>
    <ChatThread key={thread.key} sessionId={thread.sessionId} initialRequest={thread.sessionId ? null : request} onSession={onSession} onActivity={onActivity} onNotice={onNotice} onOpenReference={onOpenReference} onArchive={() => { if (active) archive(active); }} fallbackSuggestions={suggestions} starterPrompt={starterPrompt} disabled={recordingCoaching} />
  </aside>;
}
