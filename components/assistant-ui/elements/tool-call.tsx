"use client";

import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  collapsePanel,
  field,
  mono,
  ShimmerLabel,
  SwapLabel,
} from "./surfaces";

export interface ToolCallProps {
  label: string;
  activeLabel: string;
  query: string;
  request: ReactNode;
  result: ReactNode;
  running: boolean;
  failed?: boolean | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

export function ToolCall({
  label,
  activeLabel,
  query,
  request,
  result,
  running,
  failed,
  open,
  onOpenChange,
  className,
}: ToolCallProps) {
  return (
    <Collapsible
      data-slot="tool-call"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full", className)}
    >
      <CollapsibleTrigger className="group/trigger text-foreground/65 hover:text-foreground flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
        <SwapLabel active={running ? 0 : 1} className="text-start">
          <ShimmerLabel
            active={running}
            className="relative inline-block leading-none"
          >
            {activeLabel}
          </ShimmerLabel>
          <>{label}</>
        </SwapLabel>
        <span
          className={cn(
            mono,
            "bg-foreground/[0.06] text-foreground/70 min-w-0 truncate rounded-md px-1.5 py-0.5",
          )}
        >
          {query}
        </span>
        <span className="ms-auto flex w-4 items-center justify-end">
          {!running &&
            (failed ? (
              <XIcon aria-label="Failed" className="size-3.5 text-red-600" />
            ) : (
              <CheckIcon aria-label="Done" className="fade-in zoom-in-90 animate-in size-3.5 text-emerald-500 duration-200" />
            ))}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className={cn(field, "mt-2 overflow-hidden rounded-2xl text-xs")}>
          <div className="px-3.5 pt-2.5 pb-2">
            <p className={cn(mono, "text-foreground/65 mb-1")}>Request</p>
            <div className="text-foreground/65 font-mono break-words">{request}</div>
          </div>
          <div className="bg-foreground/[0.06] mx-3.5 h-px" />
          <div className="px-3.5 pt-2 pb-2.5">
            <p className={cn(mono, "text-foreground/65 mb-1")}>Result</p>
            <div className="text-foreground/90 break-words">{result}</div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
