"use client";

import { convertEveMessages, getEveMessageContent, toEveInputResponse } from "@assistant-ui/eve";
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type DictationAdapter,
  type ExternalStoreThreadListAdapter,
  type ExternalThreadQueueAdapter,
  type SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { useEveAgent, type EveMessage } from "eve/react";
import { useCallback, useMemo, useRef } from "react";

type AgentOptions = NonNullable<Parameters<typeof useEveAgent>[0]>;

export type EveChatRuntimeOptions = {
  /** A saved session to reopen and follow, or null for a new conversation. */
  sessionId: string | null;
  disabled: boolean;
  adapters: { attachments?: AttachmentAdapter; speech?: SpeechSynthesisAdapter; dictation?: DictationAdapter };
  /** The student's saved conversations, so assistant-ui's thread list can render and switch them. */
  threadList: ExternalStoreThreadListAdapter;
  onSessionChange: NonNullable<AgentOptions["onSessionChange"]>;
  onEvent: NonNullable<AgentOptions["onEvent"]>;
  onError: (error: Error) => void;
  /** A message was sent while a reply was in flight. */
  onSteer: () => void;
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
export function useEveChatRuntime({ sessionId, disabled, adapters, threadList, onSessionChange, onEvent, onError, onSteer }: EveChatRuntimeOptions) {
  const agent = useEveAgent({
    ...(sessionId ? { initialSession: { sessionId, streamIndex: 0 }, resume: true } : {}),
    onSessionChange,
    onEvent,
    onError,
  });
  const busy = agent.status === "submitted" || agent.status === "streaming";

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

  const send = useCallback((message: AppendMessage, steer: boolean) => {
    const context = message.runConfig?.custom;
    const clientContext = context && Object.keys(context).length > 0 ? (context as Record<string, string>) : undefined;
    if (steer) steerNotice.current();
    // A rejected send is reported through the hook's `error` and `onError`; nothing else to do here.
    live.current.send(getEveMessageContent(message), { ...(steer ? { turnPolicy: "steer" as const } : {}), ...(clientContext ? { clientContext } : {}) }).catch(() => undefined);
  }, []);

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
    messages,
    isRunning: busy,
    isDisabled: disabled || agent.status === "resuming",
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
