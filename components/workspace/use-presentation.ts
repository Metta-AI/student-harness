"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { backPresentation, initialPresentation, presentationInputSchema, viewSchema, showPresentation, type WorkspaceView } from "../../lib/workspace/presentation";
export function usePresentation() {
  const [state, setState] = useState(initialPresentation);
  const stateRef = useRef(state); stateRef.current = state;
  const token = useRef("");
  const account = useRef("");
  const human = useRef<Record<string, string | number | null>>({});
  const setHuman = useCallback((value: Record<string, string | number | null>) => { human.current = value; }, []);
  const restoreFor = useCallback((id: string) => {
    account.current = id;
    try { const raw = localStorage.getItem(`preston-pinned-view:${id}`); if (raw) { const view = viewSchema.parse(JSON.parse(raw)); setState({ ...initialPresentation, current: view, pinned: false, open: true }); } }
    catch { /* Invalid or unavailable local preferences do not block the workspace. */ }
  }, []);
  useEffect(() => {
    if (!account.current) return;
    try { const key = `preston-pinned-view:${account.current}`; if (state.pinned && state.current) localStorage.setItem(key, JSON.stringify(state.current)); else localStorage.removeItem(key); }
    catch { /* Storage can be disabled. Pin still works for the current visit. */ }
  }, [state.current, state.pinned]);
  const receipt = useRef<{ status: string; view?: string }>({ status: "none" });
  const [follow, setFollow] = useState(false);
  const followRef = useRef(false); followRef.current = follow;
  const openHandler = useRef<((view: WorkspaceView) => void) | null>(null);
  const begin = useCallback(() => { token.current = crypto.randomUUID(); return token.current; }, []);
  const context = useCallback(() => ({ requestToken: token.current || (token.current = crypto.randomUUID()), human: human.current, receipt: receipt.current, pinned: stateRef.current.pinned, view: stateRef.current.current?.view ?? null }), []);
  const present = useCallback((input: unknown) => {
    const parsed = presentationInputSchema.safeParse(input);
    if (!parsed.success) return { status: "rejected", detail: "Invalid view" };
    if (parsed.data.requestToken !== token.current) return { status: "rejected", detail: "A newer conversation turn owns the presentation" };
    const { requestToken: _, ...view } = parsed.data;
    const status = stateRef.current.pinned && stateRef.current.current ? "queued" : "available";
    setState(previous => showPresentation(previous, view)); receipt.current = { status, view: view.view };
    if (status === "available" && followRef.current) openHandler.current?.(view);
    return receipt.current;
  }, []);
  const bind = useCallback((handler: (view: WorkspaceView) => void) => { openHandler.current = handler; return () => { if (openHandler.current === handler) openHandler.current = null; }; }, []);
  const manual = useCallback(() => setFollow(false), []);
  return { state, restoreFor, setHuman, follow, setFollow, context, begin, present, bind, manual,
    openInWorkspace: () => { if (state.current) openHandler.current?.(state.current); },
    toggleOpen: () => setState(s => ({ ...s, open: !s.open })),
    togglePin: () => setState(s => ({ ...s, pinned: !s.pinned })),
    back: () => setState(backPresentation),
    acceptPending: () => setState(s => s.pending ? showPresentation({ ...s, pinned: false }, s.pending) : s),
    reset: () => { account.current = ""; token.current = ""; receipt.current = { status: "none" }; setState(initialPresentation); setFollow(false); },
  };
}
