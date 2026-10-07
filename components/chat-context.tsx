"use client";

import { createContext, useContext } from "react";
import { track } from "../lib/analytics";
import { events } from "../lib/analytics-events";
import type { ReasoningEffort } from "../lib/reasoning";

export type ChatReference = {
  kind: "coaching-session" | "replay-note" | "policy-results" | "league-episode";
  label: string;
  episodeId: string;
  /** The student's hosted run. Empty for a league-round episode, which is addressed by `policyVersionId`. */
  runId: string;
  coachingSessionId?: string;
  policyVersionId?: string;
};
export type AnalysisRequest = { id: number; text: string; title?: string; sessionId?: string; opponent?: {policyId: string; leagueId: string}; context?: Record<string, string>; reference?: ChatReference };
export type StarterPrompt = { label: string; text: string; detail: string };
export type SuggestionOrigin = "coach" | "fallback" | "starter_cta";

export const refPattern = /\s*<ref>([\s\S]*?)<\/ref>\s*$/;
export const attachmentPattern = /\s*<attachment>([\s\S]*?)<\/attachment>/g;
/** Pastes longer than this become a text attachment instead of filling the composer. */
export const longPasteLength = 4000;

export type MessageAttachment = { name: string; type: string; bytes: number };

/** Files named by `<attachment>` tags in a student message. */
export function parseAttachments(text: string): MessageAttachment[] {
  return [...text.matchAll(attachmentPattern)].flatMap((match): MessageAttachment[] => {
    try {
      const item = JSON.parse(match[1]!) as Partial<MessageAttachment>;
      return typeof item.name === "string" && typeof item.type === "string" && typeof item.bytes === "number" ? [item as MessageAttachment] : [];
    } catch {
      return [];
    }
  });
}

/** A student message as typed: without the reference and attachment tags the app appended. */
export const studentText = (text: string) => text.replace(refPattern, "").replace(attachmentPattern, "").trim();
const nextPattern = /\s*<next>([\s\S]*?)<\/next>\s*$/;
// While a reply streams, the block is still open: hide from the opening tag onward.
const openNextPattern = /\s*<next>[\s\S]*$/;
const partialTagPattern = /\s*<(?:n(?:e(?:x(?:t)?)?)?)?$/;

/** Serialize a workspace reference into the message so the durable transcript and the agent both carry it. */
export function withReference(text: string, reference: ChatReference) {
  return `${text}\n\n<ref>${JSON.stringify(reference)}</ref>`;
}

export function parseReference(text: string): ChatReference | null {
  const match = refPattern.exec(text);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]!) as Partial<ChatReference>;
    if (!value.kind || !value.label || !value.episodeId) return null;
    if (value.kind === "league-episode" ? !value.policyVersionId : !value.runId) return null;
    return value as ChatReference;
  } catch {
    return null;
  }
}

export function parseSuggestions(text: string): string[] {
  const match = nextPattern.exec(text);
  if (!match) return [];
  try {
    const value = JSON.parse(match[1]!) as unknown;
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4);
  } catch {
    return match[1]!.split("\n").map((line) => line.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 4);
  }
  return [];
}

/** The reply as the student should read it: without the machine-readable suggestion block. */
export const stripAgentBlocks = (text: string) => text.replace(openNextPattern, "").replace(partialTagPattern, "");

/** The reply as it should be spoken: no suggestion block, no code, no markdown punctuation. */
export const speakable = (text: string) => stripAgentBlocks(text)
  .replace(/```[\s\S]*?```/g, " Code omitted. ")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^[#>\-*+]+\s*/gm, "")
  .replace(/[*_~|]/g, "")
  .replace(/\s+\n/g, "\n")
  .trim();

const referenceKindLabel: Record<ChatReference["kind"], string> = { "coaching-session": "Coaching session", "replay-note": "Replay note", "policy-results": "Policy results", "league-episode": "League episode" };

export function ReferenceChip({ reference, onOpen }: { reference: ChatReference; onOpen: (reference: ChatReference) => void }) {
  return (
    <button
      type="button"
      title="Open in the workspace"
      onClick={() => { track(events.referenceOpened, { kind: reference.kind }); onOpen(reference); }}
      className="group/ref border-border text-foreground hover:border-input hover:bg-accent focus-visible:ring-ring inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-start text-xs transition-colors outline-none focus-visible:ring-2"
    >
      <span className="text-muted-foreground shrink-0 text-[10px] font-bold tracking-[0.08em] uppercase">{referenceKindLabel[reference.kind]}</span>
      <span className="min-w-0 truncate font-medium">{reference.label}</span>
      <span aria-hidden="true" className="text-muted-foreground group-hover/ref:text-accent-foreground shrink-0">↗</span>
    </button>
  );
}

export type ChatThreadValue = {
  /** True while a saved conversation is being replayed from the server. */
  resuming: boolean;
  starterPrompt: StarterPrompt | null;
  fallbackSuggestions: readonly string[];
  onOpenReference: (reference: ChatReference) => void;
  /** Send a prepared prompt as the student. */
  sendPrompt: (text: string, origin: SuggestionOrigin) => void;
  /** How much the agent reasons before acting; saved per student and applied from the next model call. */
  chatModel: import("../lib/model-selection").ChatModel;
  onChatModel: (model: import("../lib/model-selection").ChatModel) => void;
  modelSettingsSaving: boolean;
  reasoningEffort: ReasoningEffort;
  onReasoningEffort: (effort: ReasoningEffort) => void;
  /** The Softmax player the student's uploads and league entries are credited to, when known. */
  playerName: string | null;
};

const ChatThreadContext = createContext<ChatThreadValue | null>(null);
export const ChatThreadProvider = ChatThreadContext.Provider;

export function useChatThread(): ChatThreadValue {
  const value = useContext(ChatThreadContext);
  if (!value) throw new Error("useChatThread must be used inside a chat thread.");
  return value;
}
