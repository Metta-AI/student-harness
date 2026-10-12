"use client";

import { DropdownMenu } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { DestinationGroup } from "./destinations";
import styles from "./site-nav.module.css";

/** One navigation group as a dropdown: the trigger carries the group name and
 * the active underline when the current page belongs to it; the menu lists
 * the group's pages with a one-line description each. */
export function GroupMenu({ group, current }: { group: DestinationGroup; current: string | null }) {
  const active = group.items.some(item => item.id === current);
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className={styles.link} aria-current={active ? "page" : undefined} aria-label={`${group.label} pages`}>
        {group.label}<ChevronDown size={13} aria-hidden="true" className={styles.chevron} />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={`account-menu ${styles.dropdown}`} side="bottom" align="start" sideOffset={6} collisionPadding={12} aria-label={group.label}>
        {group.items.map(item => <DropdownMenu.Item key={item.id} asChild className={`account-menu-item ${styles.dropdownItem}`}>
          <a href={item.href} aria-current={item.id === current ? "page" : undefined}><span>{item.label}</span><small>{item.description}</small></a>
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
