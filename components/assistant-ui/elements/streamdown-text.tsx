"use client";

import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { memo } from "react";
import { stripAgentBlocks } from "@/components/chat-context";

const plugins = { code };
const shikiTheme = ["github-light", "github-light"] as [string, string];
const linkSafety = { enabled: false };

/**
 * Assistant text rendered with Streamdown: block-level streaming, repaired half-written
 * markdown, and Shiki-highlighted code. The agent's trailing `<next>` block is removed
 * before parsing, including while it is still being written.
 */
const StreamdownTextImpl = () => (
  <StreamdownTextPrimitive
    plugins={plugins}
    shikiTheme={shikiTheme as never}
    preprocess={stripAgentBlocks}
    linkSafety={linkSafety}
    caret="block"
    defer
    containerClassName="aui-md"
  />
);

export const StreamdownText = memo(StreamdownTextImpl);
