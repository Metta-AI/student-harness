"use client";

import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  WebSpeechDictationAdapter,
  WebSpeechSynthesisAdapter,
  type AttachmentAdapter,
  type CompleteAttachment,
  type DictationAdapter,
  type PendingAttachment,
  type SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { track } from "../lib/analytics";
import { events } from "../lib/analytics-events";
import { speakable } from "./chat-context";

const maxImageBytes = 4 * 1024 * 1024;
const maxPolicyBytes = 64 * 1024;
const maxTextBytes = 256 * 1024;
const textExtensions = [".bas", ".txt", ".md", ".json", ".csv", ".log", ".yaml", ".yml"];

/** Images go to the model as images, capped so one screenshot cannot blow the request size. */
class ImageAttachments extends SimpleImageAttachmentAdapter {
  override async add(state: { file: File }) {
    if (state.file.size > maxImageBytes) throw new Error("Images must be under 4 MB. Crop or compress the screenshot and try again.");
    track(events.chatAttachmentAdded, { kind: "image", bytes: state.file.size });
    return super.add(state);
  }

  // Keep the file name with the image so the transcript shows it after a reload.
  override async send(attachment: PendingAttachment, options?: { signal?: AbortSignal }): Promise<CompleteAttachment> {
    const complete = await super.send(attachment, options);
    return { ...complete, content: complete.content.map((part) => (part.type === "image" ? { ...part, filename: attachment.name } : part)) };
  }
}

/**
 * Policy sources and notes. The file is stored in the student's workspace through
 * `/api/attachments`, and the message carries only an `<attachment>` tag with its id; the agent
 * opens it with `load_attachment`. A `.bas` file has no registered MIME type, so files are
 * matched by extension.
 */
class WorkspaceFileAttachments implements AttachmentAdapter {
  accept = [...textExtensions, "text/plain", "text/markdown", "text/csv", "application/json"].join(",");

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const policy = file.name.toLowerCase().endsWith(".bas");
    const limit = policy ? maxPolicyBytes : maxTextBytes;
    if (file.size > limit) throw new Error(`${policy ? "BASIC policies" : "Text attachments"} must be under ${limit / 1024} KiB. This file is ${Math.ceil(file.size / 1024)} KiB.`);
    track(events.chatAttachmentAdded, { kind: policy ? "policy" : "text", bytes: file.size });
    return { id: crypto.randomUUID(), type: "document", name: file.name, contentType: file.type || "text/plain", file, status: { type: "requires-action", reason: "composer-send" } };
  }

  async send(attachment: PendingAttachment, options?: { signal?: AbortSignal }): Promise<CompleteAttachment> {
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: attachment.name.slice(0, 100), content: await attachment.file.text() }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    const data = (await response.json()) as { id?: string; type?: string; bytes?: number; error?: string };
    if (!response.ok || !data.id) throw new Error(data.error ?? "Could not attach the file.");
    const tag = `<attachment>${JSON.stringify({ id: data.id, type: data.type, name: attachment.name, bytes: data.bytes })}</attachment>`;
    return { ...attachment, status: { type: "complete" }, content: [{ type: "text", text: tag }] };
  }

  async remove() {}
}

/** Reads the reply the way it is shown: without the suggestion block, code, or markdown punctuation. */
class ReadableSpeech implements SpeechSynthesisAdapter {
  private readonly inner = new WebSpeechSynthesisAdapter();
  speak(text: string) {
    return this.inner.speak(speakable(text));
  }
}

/** Browser dictation, with a callback when the browser exposes the API but cannot actually transcribe. */
class Dictation implements DictationAdapter {
  private readonly inner = new WebSpeechDictationAdapter({ continuous: true, interimResults: true });
  constructor(private readonly onUnavailable: () => void) {}
  listen() {
    const session = this.inner.listen();
    track(events.chatDictationStarted, {});
    const timer = setInterval(() => {
      if (session.status.type !== "ended") return;
      clearInterval(timer);
      if (session.status.reason === "error") this.onUnavailable();
    }, 300);
    return session;
  }
}

export function createChatAdapters(onDictationUnavailable: () => void) {
  const attachments = new CompositeAttachmentAdapter([new ImageAttachments(), new WorkspaceFileAttachments()]);
  if (typeof window === "undefined") return { attachments };
  return {
    attachments,
    ...("speechSynthesis" in window ? { speech: new ReadableSpeech() } : {}),
    ...(WebSpeechDictationAdapter.isSupported() ? { dictation: new Dictation(onDictationUnavailable) } : {}),
  };
}
