"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SelectFieldOption = { value: string; label: string; disabled?: boolean };

type Props = {
  options: SelectFieldOption[];
  /** Controlled value. Leave undefined for an uncontrolled field that submits through `name`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Shown while no option is chosen. A disabled option with an empty value is used as the placeholder too. */
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-present-action"?: string;
};

// Radix rejects an empty item value, so a choosable "none" option travels under this key.
const EMPTY = "__none__";
const toItem = (value: string) => (value === "" ? EMPTY : value);
const fromItem = (value: string) => (value === EMPTY ? "" : value);

/**
 * The one select control for the app: a shadcn Select that behaves like the native element it
 * replaces. It takes a flat option list, carries `name` into FormData through a hidden input,
 * resets with its form, and accepts Preston's present-action `select` through a `present-select`
 * DOM event on the trigger.
 */
export function SelectField({ options, value, defaultValue, onValueChange, placeholder, name, required, disabled, id, className, size = "sm", ...rest }: Props) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const trigger = useRef<HTMLButtonElement>(null);
  const placeholderOption = options.find((option) => option.value === "" && option.disabled);
  const items = options.filter((option) => option !== placeholderOption);
  const chosen = items.some((option) => option.value === current);
  const change = (next: string) => { if (value === undefined) setInner(next); onValueChange?.(next); };
  const latest = useRef({ items, change });
  latest.current = { items, change };

  useEffect(() => {
    const form = trigger.current?.form;
    if (!form) return;
    const reset = () => setInner(defaultValue ?? "");
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  useEffect(() => {
    const element = trigger.current;
    if (!element) return;
    const select = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (latest.current.items.some((option) => option.value === next && !option.disabled)) latest.current.change(next);
    };
    element.addEventListener("present-select", select);
    return () => element.removeEventListener("present-select", select);
  }, []);

  return (
    <Select value={chosen ? toItem(current) : ""} onValueChange={(next) => change(fromItem(next))} disabled={disabled} required={required}>
      <SelectTrigger
        ref={trigger}
        id={id}
        size={size}
        className={cn("min-w-0 text-xs", className)}
        data-options={rest["data-present-action"] ? JSON.stringify(items.map(({ value, label }) => ({ value, label }))) : undefined}
        {...rest}
      >
        <SelectValue placeholder={placeholder ?? placeholderOption?.label} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {items.map((option) => <SelectItem key={option.value} value={toItem(option.value)} disabled={option.disabled} className="text-xs">{option.label}</SelectItem>)}
      </SelectContent>
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </Select>
  );
}
