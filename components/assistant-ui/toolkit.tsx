"use client";

import { renderGenerativeUI, type GenerativeUILibrary } from "@assistant-ui/react-generative-ui";
import { defineToolkit, type ToolApprovalResponse, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { TrophyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApprovalCard } from "@/components/assistant-ui/elements/approval-card";
import { Chart } from "@/components/assistant-ui/elements/chart";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/assistant-ui/elements/data-table";
import { ElicitationForm, type ElicitationField } from "@/components/assistant-ui/elements/elicitation-form";
import { styledGenerativeUILibrary } from "@/components/assistant-ui/elements/generative-ui";
import { OptionList } from "@/components/assistant-ui/elements/option-list";
import { field, inkButton, mono } from "@/components/assistant-ui/elements/surfaces";
import { TerminalBlock } from "@/components/assistant-ui/elements/terminal-block";
import { ToolCall } from "@/components/assistant-ui/elements/tool-call";
import { WebSearch } from "@/components/assistant-ui/elements/web-search";
import { track } from "@/lib/analytics";
import { events } from "@/lib/analytics-events";
import { fromWire, presentLibrary } from "@/lib/genui-library";
import { cn } from "@/lib/utils";
import league from "@/league.json";

type Props<TArgs = Record<string, unknown>, TResult = unknown> = ToolCallMessagePartProps<TArgs, TResult>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const basename = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
const errorText = (result: unknown) => (typeof result === "string" ? result : isRecord(result) && typeof result.message === "string" ? result.message : isRecord(result) && typeof result.error === "string" ? result.error : "The tool failed.");
const score = (value: number) => value.toFixed(Math.abs(value) >= 100 ? 0 : 2);

/** One compact, expandable line per routine tool call: a past-tense verb, the thing it acted on, and the result behind a disclosure. */
function ToolRow({ label, activeLabel, query, request, result, status, isError }: { label: string; activeLabel: string; query: string; request: ReactNode; result: ReactNode; status: Props["status"]; isError?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const running = status.type === "running";
  const failed = isError || (status.type === "incomplete" && status.reason === "error");
  return (
    <ToolCall
      label={failed ? `${label} failed` : status.type === "incomplete" ? `${label} stopped` : label}
      activeLabel={activeLabel}
      query={clip(query, 44)}
      request={request}
      result={result}
      running={running}
      failed={failed || status.type === "incomplete"}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

const TableCaption = ({ children }: { children: ReactNode }) => <figcaption className="text-muted-foreground mb-1 text-[10px] font-bold tracking-[0.1em] uppercase">{children}</figcaption>;

const Pre = ({ children }: { children: string }) => <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">{children}</pre>;

function Bash({ args, result, status }: Props<{ command?: string }, { stdout?: string; stderr?: string; exitCode?: number; truncated?: boolean }>) {
  const lines = (result?.stdout ?? "").replace(/\n$/, "").split("\n").filter((line, index, all) => line.length > 0 || all.length > 1);
  const stderr = (result?.stderr ?? "").replace(/\n$/, "").split("\n").filter(Boolean);
  return (
    <TerminalBlock
      className="my-1.5 max-w-full"
      command={args.command ?? ""}
      lines={lines}
      visibleCount={lines.length}
      done={status.type !== "running"}
      exitCode={result?.exitCode}
      stderr={stderr}
      truncated={result?.truncated}
      maxCollapsedLines={8}
    />
  );
}

function ReadFile({ args, result, status, isError }: Props<{ filePath?: string }, { content?: string; totalLines?: number; truncated?: boolean }>) {
  const path = args.filePath ?? "";
  return <ToolRow label="Read" activeLabel="Reading" query={basename(path)} status={status} isError={isError} request={path}
    result={isError ? errorText(result) : result?.content ? <Pre>{clip(result.content, 2400)}</Pre> : `${result?.totalLines ?? 0} lines`} />;
}

function WriteFile({ args, result, status, isError }: Props<{ filePath?: string; content?: string }, { existed?: boolean; path?: string }>) {
  const path = args.filePath ?? "";
  const lines = (args.content ?? "").split("\n").length;
  return <ToolRow label={result?.existed === false ? "Created" : "Wrote"} activeLabel="Writing" query={basename(path)} status={status} isError={isError} request={`${path} · ${lines} lines`}
    result={isError ? errorText(result) : <Pre>{clip(args.content ?? "", 2400)}</Pre>} />;
}

function WebFetch({ args, result, status, isError }: Props<{ url?: string }, unknown>) {
  let target = args.url ?? "";
  try { const url = new URL(target); target = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`; } catch { /* keep the raw value */ }
  const text = typeof result === "string" ? result : isRecord(result) && typeof result.content === "string" ? result.content : result === undefined ? "" : JSON.stringify(result);
  return <ToolRow label="Fetched" activeLabel="Fetching" query={target} status={status} isError={isError} request={args.url ?? ""} result={<Pre>{clip(text, 1600)}</Pre>} />;
}

function WebSearchTool({ args, result, status }: Props<{ query?: string }, unknown>) {
  const found: { title: string; domain: string }[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) {
      if (typeof value.url === "string" && typeof value.title === "string") {
        try { found.push({ title: value.title, domain: new URL(value.url).hostname.replace(/^www\./, "") }); } catch { /* skip malformed result */ }
      } else Object.values(value).forEach(visit);
    }
  };
  visit(result);
  const results = found.slice(0, 5);
  return <WebSearch className="my-1.5" query={args.query ?? ""} results={results} visibleResults={results.length} searching={status.type === "running"} cycle={0} />;
}

function Generic({ label, activeLabel, query }: { label: string; activeLabel: string; query: (args: Record<string, unknown>, result: unknown) => string }) {
  return function GenericTool({ args, argsText, result, status, isError }: Props) {
    return <ToolRow label={label} activeLabel={activeLabel} query={query(args, result) || "…"} status={status} isError={isError} request={<Pre>{clip(argsText || "{}", 800)}</Pre>}
      result={isError ? errorText(result) : <Pre>{clip(typeof result === "string" ? result : JSON.stringify(result ?? null, null, 2), 2400)}</Pre>} />;
  };
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback);
const field_ = (key: string, fallback = "") => (args: Record<string, unknown>, result: unknown) => text(args[key]) || (isRecord(result) ? text(result[key]) : "") || fallback;

type GameResult = {
  title?: string; status?: string; caveat?: string;
  counts?: { pending?: number; running?: number; completed?: number; failed?: number };
  episodes?: { id: string; status: string; our_scores?: number[] }[];
  summary?: { games_completed?: number; games_failed?: number; mean_policy_score?: number | null };
};

function HostedGame({ args, result, status, isError }: Props<{ xp_request_id?: string }, GameResult>) {
  if (status.type === "running") return <p className="text-foreground/65 my-1.5 text-[13px]"><span className="shimmer">Checking the hosted game</span></p>;
  if (isError || !result) return <p role="alert" className="my-1.5 text-[13px] text-red-600">{errorText(result)}</p>;
  const points = (result.episodes ?? []).flatMap((episode) => episode.our_scores ?? []);
  const mean = result.summary?.mean_policy_score;
  const counts = result.counts ?? {};
  const waiting = (counts.pending ?? 0) + (counts.running ?? 0);
  if (points.length < 2 || mean === null || mean === undefined) {
    return (
      <p className="text-foreground/75 my-1.5 text-[13px]">
        <span className="font-semibold">{result.title ?? "Hosted game"}</span>{" "}
        {waiting > 0 ? `is still playing: ${counts.completed ?? 0} of ${(counts.completed ?? 0) + waiting + (counts.failed ?? 0)} episodes finished.` : points.length === 1 ? `finished with a policy score of ${score(points[0]!)} in 1 episode of self-play.` : `has status ${result.status ?? "unknown"} and no scored episodes yet.`}
      </p>
    );
  }
  return (
    <figure className="my-2">
      <Chart className="max-w-md p-0" label={`${result.title ?? "Hosted game"} · mean policy score`} value={score(mean)} points={points} visibleCount={points.length} variant="bars" />
      <figcaption className="text-foreground/70 mt-1.5 text-xs">
        One bar per seat-episode score, {points.length} scores from {result.summary?.games_completed ?? 0} finished episodes of self-play{(counts.failed ?? 0) > 0 ? `, ${counts.failed} failed` : ""}. Not league results.
      </figcaption>
    </figure>
  );
}

type LeagueState = "not_uploaded" | "not_entered" | "entered_no_games" | "played";
type Revisions = {
  revisions?: {
    revision: number; summary?: string; uploaded_as?: string | null;
    hosted_mean_score?: number | null; hosted_scored_seats?: number; hosted_completed_games?: number;
    league_state?: LeagueState;
    league_result_72h?: { rank: number; score: number; wins: number; games: number } | null;
  }[];
  best_league_revision_72h?: number | null;
  note?: string;
};
const leagueStateLabel: Record<LeagueState, string> = { not_uploaded: "Not uploaded", not_entered: "Not entered", entered_no_games: "Entered, no games yet", played: "Played" };
const revisionColumns: readonly DataTableColumn[] = [
  { key: "revision", label: "Rev", priority: "primary", sortable: true, width: "3rem" },
  { key: "summary", label: "What changed", priority: "primary" },
  { key: "mean", label: "Hosted mean", format: { kind: "number", decimals: 2 }, align: "end", sortable: true, width: "5.5rem" },
  { key: "seats", label: "Seats", format: { kind: "number" }, align: "end", sortable: true, width: "3.5rem" },
];
const revisionLeagueColumns: readonly DataTableColumn[] = [
  ...revisionColumns,
  { key: "league", label: "League, 72h", width: "8.5rem" },
];

function Revisions({ result, status, isError }: Props<Record<string, never>, Revisions>) {
  if (status.type === "running") return <p className="text-foreground/65 my-1.5 text-[13px]"><span className="shimmer">Reading saved revisions</span></p>;
  if (isError || !result) return <p role="alert" className="my-1.5 text-[13px] text-red-600">{errorText(result)}</p>;
  const revisions = result.revisions ?? [];
  // Hosted self-play and league results are different measurements, so they stay in separate columns.
  const withLeague = revisions.some((item) => item.league_state !== undefined);
  const rows: DataTableRow[] = revisions.map((item) => ({
    revision: `r${item.revision}`,
    summary: `${item.summary ?? ""}${item.uploaded_as ? ` (uploaded as ${item.uploaded_as})` : " (not uploaded)"}`,
    mean: item.hosted_mean_score ?? null,
    seats: item.hosted_scored_seats ?? 0,
    ...(withLeague ? { league: item.league_result_72h && item.league_result_72h.games > 0 ? `Score ${score(item.league_result_72h.score)}, rank ${item.league_result_72h.rank}, ${item.league_result_72h.games} games` : item.league_state ? leagueStateLabel[item.league_state] : "" } : {}),
  }));
  return (
    <figure className="my-2">
      <TableCaption>{withLeague ? "Saved revisions · hosted self-play mean per scored seat, and league results" : "Saved revisions · hosted self-play, mean score per scored seat"}</TableCaption>
      <DataTable className="max-w-full" caption="Saved policy revisions with hosted self-play scores and league results" columns={withLeague ? revisionLeagueColumns : revisionColumns} rows={rows} rowKey="revision" emptyMessage={result.note ?? "No saved revisions yet."} />
      {typeof result.best_league_revision_72h === "number" ? <p className="text-foreground/65 mt-1.5 text-xs">Best league score in the last 72 hours: r{result.best_league_revision_72h}.</p> : null}
    </figure>
  );
}

type Standing = {
  league?: { name?: string; rounds_paused?: boolean }; window_hours?: number; entries?: number; note?: string;
  my_standing?: { rank: number; wins: number; games: number; win_rate: number; score: number } | null;
  my_revision?: { revision: number; uploaded_as: string | null } | null;
  league_state?: LeagueState;
  submission?: { status?: string } | null;
  top?: { rank: number; policy: string; player: string; win_rate: number; games: number; score: number }[];
};
const standingColumns: readonly DataTableColumn[] = [
  { key: "rank", label: "#", priority: "primary", format: { kind: "number" }, width: "2.25rem" },
  { key: "policy", label: "Policy", priority: "primary" },
  { key: "player", label: "Player" },
  { key: "win_rate", label: "Win rate", format: { kind: "percent", decimals: 0 }, align: "end" },
  { key: "games", label: "Games", format: { kind: "number" }, align: "end" },
  { key: "score", label: "Score", format: { kind: "number", decimals: 2 }, align: "end" },
];

function LeagueStanding({ result, status, isError }: Props<{ revision?: number }, Standing>) {
  if (status.type === "running") return <p className="text-foreground/65 my-1.5 text-[13px]"><span className="shimmer">Reading the league</span></p>;
  if (isError || !result) return <p role="alert" className="my-1.5 text-[13px] text-red-600">{errorText(result)}</p>;
  const leagueName = result.league?.name ?? league.name;
  const window = result.window_hours ?? 72;
  const rows: DataTableRow[] = (result.top ?? []).map((row) => ({ ...row }));
  const mine = result.my_standing;
  const revision = result.my_revision ? `r${result.my_revision.revision}` : null;
  // The standing is one result: say it as a sentence with its sample size and window, not as a bare tile.
  const summary = mine && revision
    ? `Your ${revision} is ranked ${mine.rank} of ${result.entries ?? "?"} in ${leagueName}: score ${score(mine.score)}, ${mine.wins} wins in ${mine.games} games over the last ${window} hours.`
    : result.submission && revision
      ? `Your ${revision} is submitted to ${leagueName} (${result.submission.status ?? "status unknown"}) and has no games in the last ${window} hours yet.`
      : revision && result.league_state !== "not_uploaded"
        ? `Your ${revision} is uploaded but not entered in ${leagueName}. A policy plays here only after you enter the league.`
        : "You have no uploaded revision in the league yet.";
  return (
    <div className="my-2 flex flex-col gap-1.5">
      {rows.length ? (
        <figure>
          <TableCaption>{`${leagueName} · top ${rows.length} of ${result.entries ?? rows.length} entries, last ${window} hours`}</TableCaption>
          <DataTable className="max-w-full" caption={`${leagueName}: top ${rows.length} of ${result.entries ?? rows.length} entries over the last ${window} hours`} columns={standingColumns} rows={rows} rowKey="rank" emptyMessage="No entries yet." />
        </figure>
      ) : null}
      <p className={cn("text-[13px]", rows.length ? "text-foreground/65 text-xs" : "text-foreground/85")}>
        {summary}
        {result.league?.rounds_paused ? " Rounds are paused right now." : ""}
      </p>
    </div>
  );
}

const answer = async (respond: Props["respondToApproval"], response: ToolApprovalResponse, kind: string, setError: (message: string | null) => void) => {
  setError(null);
  track(events.agentApprovalAnswered, { kind, option: "optionId" in response && response.optionId !== undefined ? response.optionId : "approved" in response && response.approved === false ? "deny" : response.text !== undefined ? "text" : "approve" });
  try {
    await respond(response);
  } catch (failure) {
    setError(failure instanceof Error ? failure.message : String(failure));
    throw failure;
  }
};

function EnterLeague({ args, approval, respondToApproval, result, isError }: Props<{ revision?: number }, { revision?: number; policy_label?: string; status?: string }>) {
  const [error, setError] = useState<string | null>(null);
  const open = approval !== undefined && approval.approved === undefined && approval.resolution === undefined;
  const state = !approval ? (result === undefined ? "running" : "done") : approval.approved === false || approval.resolution ? "denied" : approval.approved === undefined ? "request" : result === undefined ? "running" : "done";
  const respond = (response: ToolApprovalResponse) => void answer(respondToApproval, response, "enter_league", setError).catch(() => undefined);
  return (
    <div className="my-2 flex flex-col gap-1.5">
      <ApprovalCard
        className="max-w-md"
        state={state}
        icon={<TrophyIcon className="size-4" />}
        title="Enter the league"
        subtitle={league.name}
        description="Submits this uploaded revision to the live league, where it plays other students' policies. Your earlier entries stay on the board."
        details={[
          { label: "Revision", value: args.revision ? `r${args.revision}` : result?.revision ? `r${result.revision}` : "Latest uploaded" },
          ...(result?.policy_label ? [{ label: "Entered as", value: result.policy_label }] : []),
        ]}
        allowOnceLabel="Enter the league"
        denyLabel="Not now"
        statusLabel={state === "denied" ? (approval?.resolution ? "Closed without a decision" : "Not entered") : isError ? errorText(result) : state === "running" ? "Approved, submitting" : `Submitted${result?.status ? `, ${result.status}` : ""}`}
        {...(open ? { onAllowOnce: () => respond({ approved: true }), onDeny: () => respond({ approved: false, reason: "The student chose not to enter the league now." }) } : {})}
      />
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

type AskArgs = { question?: string; options?: { label: string; description?: string }[] };
type AskResult = { status?: "answered" | "dismissed" | "unavailable"; answer?: string };

function AskQuestion({ args, approval, respondToApproval, result, status }: Props<AskArgs, AskResult>) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = approval !== undefined && approval.approved === undefined && approval.resolution === undefined && result === undefined;
  // eve assigns the option ids; fall back to labels while the arguments are still streaming.
  const options = approval?.options?.length
    ? approval.options.map((option, index) => ({ id: option.id, label: option.label ?? args.options?.[index]?.label ?? option.id, description: option.description ?? args.options?.[index]?.description }))
    : (args.options ?? []).filter((option) => option?.label).map((option) => ({ id: option.label, label: option.label, description: option.description }));
  const chosen = approval?.optionId ? [approval.optionId] : result?.answer ? options.filter((option) => option.label === result.answer).map((option) => option.id) : undefined;
  const typed = result?.status === "answered" && result.answer && !chosen?.length ? result.answer : approval?.text;
  const settled = result !== undefined || (approval !== undefined && (approval.approved !== undefined || approval.resolution !== undefined));
  const submitText = () => {
    const value = draft.trim();
    if (!value) return;
    void answer(respondToApproval, { text: value }, "ask_question", setError).then(() => setDraft("")).catch(() => undefined);
  };
  return (
    <div className="my-2 flex max-w-md flex-col gap-2">
      <p className="text-[13.5px] leading-relaxed font-medium">{args.question ?? approval?.prompt ?? ""}</p>
      {options.length > 0 && !typed ? (
        <OptionList
          className="max-w-md"
          aria-label={args.question ?? "Question from the agent"}
          options={options}
          choice={chosen?.length ? chosen : settled ? [] : undefined}
          // eve's question options carry custom kinds, which must be answered with an explicit approval
          // alongside the option id. The list shows a rejected answer itself, so no second error line here.
          onConfirm={open ? (ids) => answer(respondToApproval, { optionId: ids[0]!, approved: true }, "ask_question", () => undefined) : undefined}
        />
      ) : null}
      {typed ? <p className={cn(field, "text-foreground/85 rounded-md px-3 py-2 text-[13px]")}><span className={cn(mono, "text-foreground/65 mr-2")}>Your answer</span>{typed}</p> : null}
      {result?.status === "dismissed" ? <p className="text-foreground/70 text-xs">Left unanswered; the conversation moved on.</p> : null}
      {open && (approval?.allowFreeform || options.length === 0) ? (
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); submitText(); }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Type your own answer" placeholder={options.length ? "Or type your own answer" : "Type your answer"}
            className={cn(field, "border-input focus-visible:border-ring h-8 min-w-0 flex-1 rounded-md border px-2.5 text-[13px] outline-none")} />
          <button type="submit" disabled={!draft.trim()} className={cn(inkButton, "h-8 rounded-md px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40")}>Answer</button>
        </form>
      ) : null}
      {status.type === "running" && !approval ? <p className="text-foreground/70 text-xs"><span className="shimmer">Preparing a question</span></p> : null}
      {error && open ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

type DetailField = { name: string; label: string; kind: "text" | "choice" | "toggle"; options?: string[]; default?: string; required?: boolean };
type DetailsArgs = { title?: string; message?: string; fields?: DetailField[] };
type DetailsResult = { status?: "answered" | "declined" | "dismissed" | "unavailable"; values?: Record<string, string>; text?: string };

function RequestDetails({ args, approval, respondToApproval, result }: Props<DetailsArgs, DetailsResult>) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = approval !== undefined && approval.approved === undefined && approval.resolution === undefined && result === undefined;
  const defined = (args.fields ?? []).filter((item): item is DetailField => Boolean(item?.name && item.label && item.kind));
  const fields: ElicitationField[] = defined.map((item) => ({
    name: item.name, label: item.label, kind: item.kind, required: item.required,
    ...(item.options ? { options: item.options } : {}),
    value: result?.values?.[item.name] ?? values[item.name] ?? item.default ?? (item.kind === "toggle" ? "false" : ""),
  }));
  const send = (payload: Record<string, unknown>) => {
    setBusy(true);
    void answer(respondToApproval, { text: JSON.stringify(payload) }, "request_details", setError).catch(() => undefined).finally(() => setBusy(false));
  };
  const state = result?.status === "answered" && result.values ? "accepted" : result !== undefined || approval?.resolution ? "declined" : "request";
  return (
    <div className="my-2 flex flex-col gap-1.5">
      <ElicitationForm
        server={args.title ?? "A few details"}
        message={args.message ?? ""}
        fields={state === "declined" ? [] : fields}
        state={state}
        busy={busy}
        error={error}
        {...(open ? {
          onFieldChange: (name: string, value: string) => setValues((current) => ({ ...current, [name]: value })),
          onAccept: () => send(Object.fromEntries(fields.map((item) => [item.name, item.kind === "toggle" ? item.value === "true" : item.value]))),
          onDecline: () => send({ declined: true }),
        } : {})}
      />
      {result?.status === "answered" && result.text ? <p className={cn(field, "text-foreground/85 max-w-md rounded-md px-3 py-2 text-[13px]")}><span className={cn(mono, "text-foreground/65 mr-2")}>Your answer</span>{result.text}</p> : null}
    </div>
  );
}

// The same display-only vocabulary the agent's `present` schema is built from, with the markdown renderer swapped in.
const presentVocabulary: GenerativeUILibrary = { ...presentLibrary, Markdown: styledGenerativeUILibrary.Markdown! };

function Present({ args, status, result, isError }: Props) {
  if (isError) return <p role="alert" className="my-1.5 text-[13px] text-red-600">{errorText(result)}</p>;
  return (
    <div className="my-2 max-w-full overflow-x-auto">
      <div data-aui="root">{renderGenerativeUI(fromWire(args), presentVocabulary, { status: status.type === "complete" ? "done" : "streaming" })}</div>
    </div>
  );
}

/**
 * Chat renderers for the eve agent's tools. Schemas and executors live in `agent/tools/`;
 * every entry here is render-only (`type: "backend"`). `standalone` entries sit in the reply
 * itself; the rest fold into the collapsible tool group as one line each.
 */
export const toolkit = defineToolkit({
  bash: { type: "backend", render: Bash },
  read_file: { type: "backend", render: ReadFile },
  write_file: { type: "backend", render: WriteFile },
  web_fetch: { type: "backend", render: WebFetch },
  web_search: { type: "backend", render: WebSearchTool },
  load_skill: { type: "backend", render: Generic({ label: "Loaded rules", activeLabel: "Loading rules", query: field_("name", "game rules") }) },
  save_policy_version: { type: "backend", render: Generic({ label: "Saved revision", activeLabel: "Saving revision", query: (args, result) => (isRecord(result) && typeof result.revision === "number" ? `r${result.revision} · ` : "") + text(args.summary) }) },
  upload_policy: { type: "backend", render: Generic({ label: "Uploaded to Softmax", activeLabel: "Uploading to Softmax", query: (args, result) => (isRecord(result) ? text(result.policy_label) : "") || text(args.policy_name) || (args.revision ? `r${text(args.revision)}` : "latest revision") }) },
  request_hosted_game: { type: "backend", render: Generic({ label: "Requested hosted game", activeLabel: "Requesting hosted game", query: field_("title") }) },
  load_attachment: { type: "backend", render: Generic({ label: "Read attached file", activeLabel: "Reading attached file", query: (args, result) => (isRecord(result) ? basename(text(result.path)) : "") || text(args.type, "file") }) },
  coaching_feedback: { type: "backend", render: Generic({ label: "Read replay coaching", activeLabel: "Reading replay coaching", query: (args) => text(args.coaching_session_id) || (isRecord(args.episode) ? text(args.episode.episode_id) : "") || "sessions" }) },
  hosted_game_status: { type: "backend", display: "standalone", render: HostedGame },
  list_policy_versions: { type: "backend", render: Revisions },
  league_standing: { type: "backend", render: LeagueStanding },
  enter_league: { type: "backend", display: "standalone", render: EnterLeague },
  ask_question: { type: "backend", display: "standalone", render: AskQuestion },
  request_details: { type: "backend", display: "standalone", render: RequestDetails },
  present: { type: "backend", display: "standalone", render: Present },
});
