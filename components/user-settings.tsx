"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, AudioLines, SlidersHorizontal, UserRound } from "lucide-react";
import { defaultPreferences, preferencesSchema, voices, type UserPreferences } from "../lib/preferences";
import {chatModels,modelLabels} from "../lib/model-selection";
import { reasoningEfforts, reasoningLabels } from "../lib/reasoning";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";

export function UserSettings() {
  const [saved, setSaved] = useState<UserPreferences | null>(null);
  const [draft, setDraft] = useState<UserPreferences>(defaultPreferences);
  const [account, setAccount] = useState<{ email: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [identity, response] = await Promise.all([fetch("/api/session", { cache: "no-store" }), fetch("/api/preferences", { cache: "no-store" })]);
      if (response.status === 401) { setSignedOut(true); return; }
      if (!identity.ok || !response.ok) throw new Error("load");
      const preferences = preferencesSchema.parse(await response.json());
      setAccount(await identity.json()); setSaved(preferences); setDraft(preferences);
    } catch { setError("Couldn’t load your settings. Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setDraft(previous => ({ ...previous, [key]: value })); setMessage(""); setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!saved || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const parsed = preferencesSchema.safeParse(draft);
      if (!parsed.success) { setError("Use a single-line name of up to 80 characters and choose the listed options."); return; }
      // Send only edited fields so a reasoning change in another tab is preserved.
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => value !== saved[key as keyof UserPreferences]));
      if (Object.keys(patch).length === 0) { setDraft(saved); return; }
      const response = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error("save");
      const preferences = preferencesSchema.parse(await response.json());
      setSaved(preferences); setDraft(preferences); setMessage("Settings saved.");
    } catch { setError("Couldn’t save your settings. Your changes are still here to retry."); }
    finally { setSaving(false); }
  }

  return <main className="settings-page">
    <header className="settings-header"><a href="/" className="settings-brand">Softmax</a><a href="/" className="settings-back"><ArrowLeft size={16} />Back to workspace</a></header>
    <div className="settings-content">
      <h1>Settings</h1><p className="settings-intro">How you and Preston work together.</p>
      {loading ? <p role="status">Loading settings…</p> : signedOut ? <p><a href="/">Sign in</a> to manage your settings.</p> : !saved ? <div><p role="alert">{error}</p><button type="button" onClick={() => void load()}>Try again</button></div> : <form onSubmit={save}>
        <fieldset disabled={saving}>
          <section className="settings-section" aria-labelledby="account-settings-heading">
            <h2 id="account-settings-heading"><UserRound size={19} />Account</h2>
            <div className="settings-row"><div><strong>Email</strong><p>Connected through your Softmax account.</p></div><span className="settings-email">{account?.email}</span></div>
            <div className="settings-row"><div><label htmlFor="preferred-name">Preferred name</label><p id="name-help">What Preston calls you. Leave blank to use your account name.</p></div><Input className="w-full md:w-[290px]" id="preferred-name" aria-describedby="name-help" autoComplete="nickname" maxLength={80} placeholder={account?.name || "Your name"} value={draft.preferredName} onChange={e => change("preferredName", e.target.value)} /></div>
          </section>
          <section className="settings-section" aria-labelledby="voice-settings-heading">
            <h2 id="voice-settings-heading"><AudioLines size={19} />Preston’s voice</h2>
            <div className="settings-row"><div><label htmlFor="preston-voice">Voice</label><p id="voice-help">Applies to your next voice conversation.</p></div><SelectField id="preston-voice" aria-describedby="voice-help" size="default" className="w-full text-sm md:w-[290px]" value={draft.voice} onValueChange={v => change("voice", v as UserPreferences["voice"])} options={voices.map(voice => ({ value: voice.value, label: `${voice.label} — ${voice.detail}` }))} /></div>
            <div className="settings-row"><div><label htmlFor="live-captions">Live captions</label><p id="captions-help">Show the transcript while talking. Conversation history is always saved.</p></div><Switch id="live-captions" aria-describedby="captions-help" checked={draft.liveCaptions} onCheckedChange={checked => change("liveCaptions", checked)} /></div>
          </section>
          <section className="settings-section" aria-labelledby="conversation-settings-heading">
            <h2 id="conversation-settings-heading"><SlidersHorizontal size={19} />Conversation</h2>
            <div className="settings-row"><div><label htmlFor="response-length">Response length</label><p id="length-help">For chat replies and new voice conversations.</p></div><SelectField id="response-length" aria-describedby="length-help" size="default" className="w-full text-sm md:w-[290px]" value={draft.responseLength} onValueChange={v => change("responseLength", v as UserPreferences["responseLength"])} options={[{ value: "concise", label: "Concise" }, { value: "balanced", label: "Balanced" }, { value: "detailed", label: "Detailed" }]} /></div>
            <div className="settings-row"><div><label htmlFor="chat-model">Model</label><p>Used by chat and new campaigns and sessions.</p></div><SelectField id="chat-model" value={draft.chatModel} onValueChange={v=>change("chatModel",v as UserPreferences["chatModel"])} options={chatModels.map(model=>({value:model,label:modelLabels[model]}))}/></div>
            <div className="settings-row"><div><label htmlFor="chat-reasoning">Chat reasoning</label><p id="reasoning-help">{reasoningLabels[draft.reasoningEffort].detail}</p></div><SelectField id="chat-reasoning" aria-describedby="reasoning-help" size="default" className="w-full text-sm md:w-[290px]" value={draft.reasoningEffort} onValueChange={v => change("reasoningEffort", v as UserPreferences["reasoningEffort"])} options={reasoningEfforts.map(effort => ({ value: effort, label: reasoningLabels[effort].label }))} /></div>
          </section>
          <section className="settings-section" aria-labelledby="research-settings-heading">
            <h2 id="research-settings-heading">Research</h2>
            <div className="settings-row"><div><label htmlFor="enforce-research-budget">Enforce spending limits</label><p id="enforce-budget-help">{draft.researchBudgetEnforced ? "Research pauses at the configured spending limits." : "Tracking only. Research continues without monetary limits."}</p></div><Switch id="enforce-research-budget" aria-describedby="enforce-budget-help" checked={draft.researchBudgetEnforced} onCheckedChange={checked => change("researchBudgetEnforced", checked)} /></div>
            {draft.researchBudgetEnforced ? <div className="settings-row"><div><label htmlFor="daily-research-budget">Daily budget ($)</label><p id="daily-budget-help">Shared across background sessions and research. Resets at midnight Pacific. Set to 0 to stop new paid research.</p></div><Input id="daily-research-budget" type="number" min="0" max="1000" step="1" required value={draft.dailyResearchBudgetUsd} onChange={e => change("dailyResearchBudgetUsd", e.target.valueAsNumber)} aria-describedby="daily-budget-help" /></div> : null}
            <p className="settings-intro">Model calls, hosted games, reported costs, and unreported-cost reservations remain recorded in either mode. Reservations are accounting placeholders, not actual charges.</p>
          </section>
          <footer className="settings-actions"><button type="button" className="settings-reset" onClick={() => { setDraft({ ...defaultPreferences }); setMessage(""); setError(""); }}>Restore defaults</button><span role="status">{message || (dirty ? "Unsaved changes" : "")}</span><button type="submit" className="settings-save" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button></footer>
        </fieldset>
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
      </form>}
    </div>
  </main>;
}
