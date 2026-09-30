"use client";

import { useEffect, useMemo, useRef } from "react";

const keywords = new Set(["and", "as", "byref", "call", "case", "const", "dim", "do", "else", "elseif", "end", "exit", "false", "for", "function", "if", "mod", "next", "not", "or", "return", "select", "step", "sub", "then", "to", "true", "until", "wend", "while"]);
const token = /'[^\n]*|"(?:""|[^"])*"|\b(?:\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_0-9]*)\b|[+*/=<>&-]+/g;

function highlight(line: string) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(token)) {
    const value = match[0];
    const start = match.index;
    if (start > cursor) parts.push(line.slice(cursor, start));
    const kind = value.startsWith("'") ? "comment" : value.startsWith('"') ? "string" : /^\d/.test(value) ? "number" : keywords.has(value.toLowerCase()) ? "keyword" : /^[+*/=<>&-]+$/.test(value) ? "operator" : /\($/.test(line.slice(start + value.length)) ? "function" : "identifier";
    parts.push(<span key={`${start}-${value}`} className={`basic-${kind}`}>{value}</span>);
    cursor = start + value.length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

export function BasicCode({ source, selected, onSelectOffset }: { source: string; selected?: { start: number; end: number }; onSelectOffset: (offset: number) => void }) {
  const lines = useMemo(() => {
    let offset = 0;
    return source.split("\n").map((text) => {
      const line = { text, offset };
      offset += text.length + 1;
      return line;
    });
  }, [source]);
  const selectedLine = selected ? lines.findIndex(({ text, offset }) => offset < selected.end && offset + text.length + 1 > selected.start) : -1;
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: "center" }); }, [selectedLine]);

  return <div className="basic-editor" role="region" aria-label="Polyworld BASIC source">
    <div className="basic-lines">{lines.map(({ text, offset }, index) => {
      const highlighted = !!selected && offset < selected.end && offset + text.length + 1 > selected.start;
      return <button type="button" key={index} ref={index === selectedLine ? active : undefined} className={`basic-line${highlighted ? " selected" : ""}`} onClick={() => onSelectOffset(offset)} aria-label={`Line ${index + 1}: ${text.trim() || "blank"}`}>
        <span className="basic-gutter" aria-hidden="true">{index + 1}</span><code>{highlight(text) || " "}</code>
      </button>;
    })}</div>
  </div>;
}
