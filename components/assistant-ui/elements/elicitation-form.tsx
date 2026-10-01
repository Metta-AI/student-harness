"use client";

import type { ComponentProps } from "react";
import { CheckIcon, ListChecksIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, inkButton, mono, paper } from "./surfaces";

export type ElicitationState = "request" | "accepted" | "declined";

export interface ElicitationField {
  name: string;
  label: string;
  value: string;
  kind: "text" | "choice" | "toggle";
  options?: readonly string[];
  required?: boolean;
}

/**
 * The assistant-ui elicitation form, made editable: the agent asks for a few fields mid-run,
 * the student fills them in place, and the form settles into a receipt of what was sent.
 * `onFieldChange` is what turns the controls live; without it the form only displays values.
 */
export function ElicitationForm({
  server,
  message,
  fields,
  state,
  busy,
  error,
  onFieldChange,
  onAccept,
  onDecline,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "server" | "message" | "fields" | "state" | "onAccept" | "onDecline"> & {
  /** Who is asking, shown as the form's heading. */
  server: string;
  message: string;
  fields: readonly ElicitationField[];
  state: ElicitationState;
  busy?: boolean;
  error?: string | null;
  onFieldChange?: (name: string, value: string) => void;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const editable = state === "request" && onFieldChange !== undefined && !busy;
  const missing = fields.some((item) => item.required && item.kind !== "toggle" && !item.value.trim());

  return (
    <div data-slot="elicitation-form" data-state={state} role="group" aria-label={server} className={cn(paper, "flex w-full max-w-md flex-col gap-3.5 rounded-md p-4", className)} {...props}>
      <div className="flex items-center gap-2.5">
        <ListChecksIcon aria-hidden className="text-foreground/70 size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{server}</span>
        {state === "request" ? <span className={cn(mono, "text-foreground/70 shrink-0")}>needs your input</span> : null}
      </div>

      <p className="text-foreground/65 text-xs leading-relaxed">{message}</p>

      <div className="flex flex-col gap-3">
        {fields.map((item) => {
          const id = `elicit-${item.name}`;
          return (
            <div key={item.name} className="flex flex-col gap-1.5">
              <label htmlFor={item.kind === "text" ? id : undefined} id={`${id}-label`} className={cn(mono, "text-foreground/65")}>
                {item.label}
                {item.required ? <span className="text-foreground/70"> (required)</span> : null}
              </label>
              {item.kind === "choice" ? (
                <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
                  {item.options?.map((option) => {
                    const selected = option === item.value;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!editable}
                        onClick={() => onFieldChange?.(item.name, option)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected ? "border-accent-foreground/30 bg-accent text-accent-foreground font-medium" : "border-border text-foreground/65",
                          editable && !selected && "hover:bg-foreground/[0.04] hover:text-foreground",
                          !editable && "cursor-default",
                        )}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : item.kind === "toggle" ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={item.value === "true"}
                  aria-labelledby={`${id}-label`}
                  disabled={!editable}
                  onClick={() => onFieldChange?.(item.name, item.value === "true" ? "false" : "true")}
                  className={cn("flex w-fit items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", !editable && "cursor-default")}
                >
                  <span aria-hidden className={cn("flex h-4 w-7 items-center rounded-full p-0.5 transition-colors duration-200", item.value === "true" ? "bg-accent-foreground" : "bg-foreground/20")}>
                    <span className={cn("bg-background size-3 rounded-full transition-transform duration-200 motion-reduce:transition-none", item.value === "true" && "translate-x-3")} />
                  </span>
                  <span className="text-foreground/65 text-xs">{item.value === "true" ? "Yes" : "No"}</span>
                </button>
              ) : editable ? (
                <input
                  id={id}
                  value={item.value}
                  onChange={(event) => onFieldChange?.(item.name, event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !missing) onAccept?.(); }}
                  className={cn(field, "text-foreground border-input focus-visible:border-ring rounded-md border px-2.5 py-1.5 text-xs outline-none")}
                />
              ) : (
                <span className={cn(field, "text-foreground/80 rounded-md px-2.5 py-1.5 text-xs")}>{item.value || "No answer"}</span>
              )}
            </div>
          );
        })}
      </div>

      {error ? <p role="alert" className="text-xs break-words text-red-600">{error}</p> : null}

      <div className="flex min-h-8 items-center justify-end gap-2">
        {state === "request" ? (
          <>
            {onDecline ? (
              <button type="button" disabled={busy} onClick={onDecline} className="text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground h-8 rounded-md px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Skip
              </button>
            ) : null}
            {onAccept ? (
              <button type="button" disabled={busy || missing} onClick={onAccept} className={cn(inkButton, "flex h-8 items-center rounded-md px-3.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40")}>
                {busy ? "Sending" : "Send answers"}
              </button>
            ) : null}
          </>
        ) : (
          <span key={state} className="fade-in animate-in text-foreground/65 flex items-center gap-2 text-xs duration-300">
            {state === "accepted" ? (<><CheckIcon aria-hidden className="size-3.5 text-emerald-600" />Answers sent</>) : (<><XIcon aria-hidden className="text-foreground/70 size-3.5" />Skipped</>)}
          </span>
        )}
      </div>
    </div>
  );
}
