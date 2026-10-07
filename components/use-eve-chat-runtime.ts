"use client";

import { convertEveMessages, getEveMessageContent, toEveInputResponse } from "@assistant-ui/eve";
import {
  useExternalStoreRuntime,
  fromThreadMessageLike,
  type AppendMessage,
  type AttachmentAdapter,
  type DictationAdapter,
  type ExternalStoreThreadListAdapter,
  type ExternalThreadQueueAdapter,
  type SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { useEveAgent, type EveMessage } from "eve/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { isInactiveSession, sendWithSessionRecovery } from "../lib/chat-recovery";
import { spokenMessages, mergeSpokenMessages } from "../lib/voice/conversation";
import { useCompanion } from "./partner/companion";

type AgentOptions = NonNullable<Parameters<typeof useEveAgent>[0]>;

export type EveChatRuntimeOptions = {
  /** A saved session to reopen and follow, or null for a new conversation. */
  sessionId: string | null;
  disabled: boolean;
  submissionDisabled?: boolean;
  adapters: { attachments?: AttachmentAdapter; speech?: SpeechSynthesisAdapter; dictation?: DictationAdapter };
  /** The student's saved conversations, so assistant-ui's thread list can render and switch them. */
  threadList: ExternalStoreThreadListAdapter;
  onSessionChange: NonNullable<AgentOptions["onSessionChange"]>;
  onEvent: NonNullable<AgentOptions["onEvent"]>;
  onError: (error: Error) => void;
  /** A message was sent while a reply was in flight. */
  onSteer: () => void;
  onNeedsInput?: () => void;
};

const noItems: ExternalThreadQueueAdapter["items"] = [];

/**
 * assistant-ui runtime over an eve session.
 *
 * It follows `useEveAgentRuntime` from `@assistant-ui/eve` and reuses its message conversion, with
 * one difference: a message sent while a reply is in flight goes to eve straight away as steering
 * instead of waiting behind the running turn. eve folds it into the same turn at the next safe
 * boundary. The composer stays usable during a run because the runtime exposes a queue surface
 * whose lanes are always empty: nothing waits client-side, eve owns the ordering.
 */
export function useEveChatRuntime({ sessionId, disabled, submissionDisabled=false, adapters, threadList, onSessionChange, onEvent, onError, onSteer, onNeedsInput }: EveChatRuntimeOptions) {
  const { workspace, presentation, bind, updateVoice, stopTalk, stopScreen, recentTranscript, transcripts, historyLoading, liveCaptions, phase } = useCompanion();
  const sending = useRef(false);
  const sendError = useRef<Error | undefined>(undefined);
  const agent = useEveAgent({
    ...(sessionId ? { initialSession: { sessionId, streamIndex: 0 }, resume: true } : {}),
    onSessionChange,
    onEvent,
    onError: error => { sendError.current = error; if (!isInactiveSession(error)) onError(error); },
  });
  const presentationSession = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (presentationSession.current === undefined || presentationSession.current !== null && presentationSession.current !== sessionId) presentation.begin();
    presentationSession.current = sessionId;
  }, [sessionId, presentation.begin]);
  const terminal = agent.events.some(event => event.type === "session.completed" || event.type === "session.failed");
  const busy = agent.status === "submitted" || agent.status === "streaming";
  useEffect(() => { if (disabled) { stopTalk(); stopScreen(); } }, [disabled, stopTalk, stopScreen]);

  // Handlers below outlive a render, so they read the live agent through a ref.
  const live = useRef(agent);
  live.current = agent;
  const steerNotice = useRef(onSteer);
  steerNotice.current = onSteer;

  // eve messages carry no timestamp; keep the first time each one was seen so ordering metadata is stable.
  const firstSeen = useRef(new Map<string, Date>());
  const messages = useMemo(() => convertEveMessages(agent.data, {
    isRunning: busy,
    error: agent.error,
    getCreatedAt: (message: EveMessage) => {
      const known = firstSeen.current.get(message.id);
      if (known) return known;
      const now = new Date();
      firstSeen.current.set(message.id, now);
      return now;
    },
  }), [agent.data, agent.error, busy]);

  const conversationMessages=useMemo(()=>mergeSpokenMessages(messages,spokenMessages(transcripts).map(turn=>({
    ...fromThreadMessageLike({id:turn.id,role:turn.role,createdAt:turn.createdAt,content:[{type:'text',text:turn.text}],metadata:{modality:'voice'},...(turn.role==='assistant'?{status:{type:'complete' as const,reason:'stop' as const}}:{})},turn.id,{type:'complete',reason:'stop'}),after:turn.after,
  }))),[messages,transcripts]);
  const conversationRef=useRef(conversationMessages);conversationRef.current=conversationMessages;

  const send = useCallback((message: AppendMessage, steer: boolean) => {
    const context = message.runConfig?.custom;
    presentation.begin();
    const clientContext = { ...(context ?? {}), presentScreen: workspace.context(), presentation: presentation.context(), recentVoice: recentTranscript() };
    if (steer) steerNotice.current();
    const previousConversation = live.current.data.messages.filter(m => m.role === "user" || m.role === "assistant").slice(-12).map(m => ({ role: m.role, text: m.parts.filter(p => p.type === "text").map(p => p.type === "text" ? p.text : "").join("\n").slice(-2000) }));
    sending.current = true;
    void sendWithSessionRecovery(async recovered => {
      sendError.current = undefined;
      await live.current.send(getEveMessageContent(message), {
      ...(!recovered && steer ? { turnPolicy: "steer" as const } : {}),
      clientContext: { ...clientContext, ...(recovered ? { previousConversation, continuationNote: "The prior session ended. These prior messages are reference context, not new requests. Recheck workspace state before mutations. Do not repeat completed actions; respond only to the newly submitted message." } : {}) },
      });
      // Eve reports primary-send failures through onError and resolves send().
      // Read the callback receipt before deciding whether a safe retry is needed.
      if (sendError.current) throw sendError.current;
    }, () => live.current.reset()).catch(error => { if (isInactiveSession(error)) onError(error); }).finally(() => { sending.current = false; });
  }, [workspace, presentation.begin, presentation.context, recentTranscript, onError]);

  useEffect(() => {
    if (!sending.current && isInactiveSession(agent.error)) live.current.reset();
  }, [agent.error]);

  useEffect(() => {
    const needsInput = agent.data.messages.some(m => m.parts.some(p => p.type === "dynamic-tool" && p.state === "approval-requested" && p.toolName !== "workspace_screen"));
    if (needsInput && !terminal) onNeedsInput?.();
  }, [agent.data.messages, onNeedsInput, terminal]);

  // Only the mounted conversation can drive this browser. Grants never survive a remount.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => bind({
    anchor:()=>live.current.data.messages.at(-1)?.id??null,
    history: ()=>conversationRef.current.filter(m=>m.role==='user'||m.role==='assistant').slice(-12).map(m=>({role:m.role as 'user'|'assistant',text:m.content.filter(p=>p.type==='text').map(p=>p.type==='text'?p.text:'').join('').slice(-1500)})),
    ready: () => !disabledRef.current && !["resuming", "submitted", "streaming"].includes(live.current.status),
    cancel: () => { void live.current.cancel(); },
    send: (text, replayAnchor, momentId) => { live.current.send(text, { clientContext: { presentScreen: workspace.context(), ...(replayAnchor ? { replayAnchor } : {}), ...(momentId ? { momentId } : {}), voice: "Reply conversationally; this answer will be spoken aloud." } }).catch(() => updateVoice(false)); },
  }), [bind, workspace, updateVoice]);

  // Speak only a newly completed reply from work observed in this mount, never restored history.
  const voiceTurn = useRef(false);
  const spoken = useRef(new Set<string>());
  useEffect(() => {
    if (busy) { voiceTurn.current = true; updateVoice(true); return; }
    if (agent.status === "resuming") return;
    const pending = agent.data.messages.some(m => m.parts.some(p => p.type === "dynamic-tool" && p.state === "approval-requested"));
    if (pending) {
      if (voiceTurn.current) {
        voiceTurn.current = false;
        updateVoice(false, "I need your decision before continuing. The exact request is in Chat; confirm it there or tell me what to change.");
      }
      return;
    }
    const last = messages.filter(m => m.role === "assistant").at(-1);
    if (voiceTurn.current) {
      voiceTurn.current = false;
      const reply = last && !spoken.current.has(last.id) ? last.content.filter(p => p.type === "text").map(p => p.text).join("\n") : undefined;
      if (last) spoken.current.add(last.id);
      updateVoice(false, reply);
    }
  }, [busy, agent.status, agent.data.messages, messages, updateVoice]);

  // View outputs are declarative and render as soon as their tool completes. No parked approval turn.
  const shownViews = useRef(new Set<string>());
  useEffect(() => {
    for (const message of agent.data.messages) for (const part of message.parts) {
      if (part.type !== "dynamic-tool" || !["present_view","create_view"].includes(part.toolName) || part.state !== "output-available" || shownViews.current.has(part.toolCallId)) continue;
      shownViews.current.add(part.toolCallId);
      const output = part.output as { presentation?: unknown } | undefined;
      if (output?.presentation) presentation.present(output.presentation);
    }
  }, [agent.data.messages, presentation.present]);

  // Eve parks workspace_screen as an input request. Execute against the live grant, then
  // return its receipt (including pixels) to the same durable tool call. No render-time effects.
  const receipts = useRef(new Map<string, string>());
  const answering = useRef(false);
  const failed = useRef(new Set<string>());
  useEffect(() => {
    if (busy || terminal || agent.error || agent.status === "resuming" || answering.current) return;
    const part = agent.data.messages.flatMap(m => m.parts).find(p => p.type === "dynamic-tool" && p.toolName === "workspace_screen" && p.state === "approval-requested" && p.toolMetadata?.eve?.inputRequest?.kind === "question" && !failed.current.has(p.toolMetadata.eve.inputRequest.requestId));
    if (!part || part.type !== "dynamic-tool") return;
    const request = part.toolMetadata!.eve!.inputRequest!;
    answering.current = true;
    void (async () => {
      let text = receipts.current.get(request.requestId);
      if (!text) {
        const receipt = disabledRef.current ? { ok: false, detail: "Workspace interaction is paused while coaching is recording." } : await workspace.execute(part.input);
        text = JSON.stringify(receipt); receipts.current.set(request.requestId, text);
      }
      // The result is cached before sending so stream redelivery cannot repeat a click.
      await live.current.respond([{ requestId: request.requestId, text }], { clientContext: { presentScreen: workspace.context() } });
    })().catch(error => { failed.current.add(request.requestId); onError(error instanceof Error ? error : new Error("Could not deliver the workspace result.")); })
      .finally(() => { answering.current = false; });
  }, [agent.data.messages, agent.status, agent.error, terminal, busy, onError, workspace]);

  const queue = useMemo<ExternalThreadQueueAdapter>(() => ({
    items: noItems,
    steerItems: noItems,
    enqueue: (message) => send(message, false),
    steer: (message) => send(message, true),
    move: () => undefined,
    edit: () => undefined,
    remove: () => undefined,
  }), [send]);

  const runtime = useExternalStoreRuntime({
    messages: liveCaptions || phase === "off" ? conversationMessages : messages,
    isRunning: busy,
    isDisabled: disabled || submissionDisabled || historyLoading || agent.status === "resuming",
    queue,
    adapters: { ...adapters, threadList },
    onNew: async (message) => send(message, false),
    onCancel: async () => { await live.current.cancel(); },
    onRefetchThread: async () => { if (live.current.session) await live.current.resume(); },
    onRespondToToolApproval: async (response) => {
      // The card appears as soon as the request event arrives, but eve keeps the turn open until the
      // session reports it is waiting, which on a fresh session can take most of a minute. An answer
      // sent inside that gap is rejected as a second turn, so hold it until the turn has parked.
      for (let waited = 0; waited < 120000 && (live.current.status === "submitted" || live.current.status === "streaming"); waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const current = live.current;
      let request;
      for (const message of current.data.messages) {
        for (const part of message.parts) {
          if (part.type === "dynamic-tool" && part.approval?.id === response.approvalId) request = part.toolMetadata?.eve?.inputRequest;
        }
      }
      await current.respond([toEveInputResponse(response, request)]);
    },
  });

  return { runtime, error: agent.error, status: agent.status };
}
