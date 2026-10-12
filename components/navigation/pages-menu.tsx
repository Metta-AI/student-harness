"use client";

import { DropdownMenu } from "radix-ui";
import { Brain, ChevronDown } from "lucide-react";
import { destinations } from "./destinations";
import styles from "./pages-menu.module.css";

/** The workspace shell's way into everything that is not the workspace itself:
 * Preston's brain first, then the computers and the account pages. Built from
 * the same destination list as the site navigation so both agree. */
export function PagesMenu({ leagueId, disabled }: { leagueId: string; disabled?: boolean }) {
  const groups = destinations(leagueId).filter(group => group.id !== "work");
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className={styles.trigger} disabled={disabled} aria-label="Open Preston’s brain and other pages">
        <Brain size={15} aria-hidden="true" /><span>Preston’s brain</span><ChevronDown size={13} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={`account-menu ${styles.content}`} side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Pages">
        {groups.map((group, index) => <DropdownMenu.Group key={group.id}>
          {index ? <DropdownMenu.Separator className="account-menu-separator" /> : null}
          <DropdownMenu.Label className={styles.label}>{group.label}</DropdownMenu.Label>
          {group.items.map(item => <DropdownMenu.Item key={item.id} asChild className={`account-menu-item ${styles.item}`}>
            <a href={item.href}><span>{item.label}</span><small>{item.description}</small></a>
          </DropdownMenu.Item>)}
        </DropdownMenu.Group>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
