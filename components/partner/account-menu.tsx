"use client";

import { useState } from "react";
import { DropdownMenu } from "radix-ui";
import { ArrowUpRight, ChevronsUpDown, LogOut, Settings } from "lucide-react";

export function AccountMenu({ name, email, disabled, onSignOut }: {
  name: string; email: string; disabled: boolean; onSignOut: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0]).join("").toUpperCase();

  async function signOut() {
    setSigningOut(true);
    setFailed(false);
    try { await onSignOut(); }
    catch { setFailed(true); }
    finally { setSigningOut(false); }
  }

  return <div className="account-bar">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="account-trigger" aria-label={`Account menu for ${name}`}>
          <span className="account-avatar" aria-hidden="true">{initials}</span>
          <span className="account-identity"><strong>{name}</strong><small>Account</small></span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="account-menu" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Account actions">
          <DropdownMenu.Label className="account-menu-identity"><strong>{name}</strong><span>{email}</span></DropdownMenu.Label>
          <DropdownMenu.Separator className="account-menu-separator" />
          <DropdownMenu.Item asChild className="account-menu-item" disabled={disabled}>
            <a href="/settings" onClick={event => { if (disabled) event.preventDefault(); }}><Settings size={16} aria-hidden="true" />Settings</a>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className="account-menu-item">
            <a href="https://softmax.com/observatory/v2" target="_blank" rel="noreferrer"><ArrowUpRight size={16} aria-hidden="true" />Open Softmax</a>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="account-menu-item" disabled={disabled || signingOut} onSelect={event => { event.preventDefault(); void signOut(); }}>
            <LogOut size={16} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
          {disabled ? <p className="account-menu-note">Finish recording to sign out.</p> : null}
          {failed ? <p className="account-menu-note" role="alert">Couldn’t sign out. Please try again.</p> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>;
}
