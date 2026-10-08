"use client";

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

const defaultWidth = 360;
const minWidth = 280;
const maxWidth = 640;
const storageKey = "preston-panel-width";

export function usePanelWidth() {
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(defaultWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.max(minWidth, Math.min(maxWidth, window.innerWidth * .48, value)));
  useEffect(() => {
    try { const saved = Number(localStorage.getItem(storageKey)); if (saved >= minWidth) setWidth(clamp(saved)); } catch {}
  }, []);
  useEffect(() => {
    const shell = panel.current?.closest<HTMLElement>(".partner-shell");
    shell?.style.setProperty("--preston-width", `${width}px`);
    return () => { shell?.style.removeProperty("--preston-width"); };
  }, [width]);
  const save = (value: number) => {
    const next = clamp(value); setWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch {}
  };
  return { panel, separator: {
    role: "separator" as const, tabIndex: 0,
    "aria-label": "Resize Preston column", "aria-orientation": "vertical" as const,
    "aria-valuemin": minWidth, "aria-valuemax": maxWidth, "aria-valuenow": width,
    "aria-controls": "present-panel",
    title: "Drag to resize · Arrow keys to adjust · Double-click to reset",
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? width };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current) setWidth(clamp(drag.current.width + drag.current.x - event.clientX));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      save(drag.current.width + drag.current.x - event.clientX); drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onDoubleClick: () => save(defaultWidth),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const next = event.key === "ArrowLeft" ? width + 20 : event.key === "ArrowRight" ? width - 20 : event.key === "Home" ? minWidth : event.key === "End" ? maxWidth : null;
      if (next !== null) { event.preventDefault(); save(next); }
    },
  } };
}
