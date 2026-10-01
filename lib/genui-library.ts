import { buildPresentParameters, defaultGenerativeUILibrary, type GenerativeUILibrary } from "@assistant-ui/react-generative-ui";

/**
 * The display-only slice of the generative UI vocabulary the agent may compose with `present`.
 * Inputs, buttons and forms are left out: nothing here dispatches an action, so a chart or a table
 * in the transcript is always a record of real tool results, never a control. `Badge` and `Box`
 * are left out because their `variant` and `background` props collide with `Chart` and `Card`.
 */
const names = ["Header", "Text", "Caption", "Divider", "Fact", "Card", "Col", "Row", "Spacer", "ListView", "ListViewItem", "Table", "Markdown", "Chart", "Alert"] as const;

export const presentLibrary: GenerativeUILibrary = Object.fromEntries(names.map((name) => [name, defaultGenerativeUILibrary[name]!]));

// The vocabulary's own keys start with `$`, which Anthropic's tool schemas reject
// (property keys must match ^[a-zA-Z0-9_.-]{1,64}$). The model writes these names instead.
const wireKeys: Record<string, string> = { $type: "component", $key: "key" };
const dropped = new Set(["$action", "asForm", "confirm", "cancel"]);

function toWire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toWire);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && typeof value === "object" && value !== null) {
      out.properties = Object.fromEntries(Object.entries(value).filter(([name]) => !dropped.has(name)).map(([name, schema]) => [wireKeys[name] ?? name, toWire(schema)]));
    } else if (key === "required" && Array.isArray(value)) {
      out.required = value.filter((name) => !dropped.has(name)).map((name) => wireKeys[name] ?? name);
    } else out[key] = toWire(value);
  }
  return out;
}

/** JSON Schema for the agent's `present` tool, with provider-safe property names. */
export function presentToolSchema(): Record<string, unknown> {
  // The vocabulary reuses prop names such as `value` and `size` across components with compatible
  // types; the builder reports each overlap on every cold start, which only adds log noise.
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return toWire(buildPresentParameters(presentLibrary)) as Record<string, unknown>;
  } finally {
    console.warn = warn;
  }
}

/** Turns the agent's `{ component, key, children }` tree back into the vocabulary's `{ $type, $key }` nodes. */
export function fromWire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(fromWire);
  if (typeof node !== "object" || node === null) return node;
  const { component, key, children, ...props } = node as Record<string, unknown>;
  return {
    ...props,
    ...(typeof component === "string" ? { $type: component } : {}),
    ...(typeof key === "string" || typeof key === "number" ? { $key: key } : {}),
    ...(children !== undefined ? { children: fromWire(children) } : {}),
  };
}
