/**
 * Making the diagrams look like the host drew them.
 *
 * The widget runs in a sandboxed iframe, so it inherits nothing: not the host's
 * stylesheet, not its font, not its border colour. Everything native about the
 * result has to be reconstructed from this side. Two mechanisms do it, in order
 * of preference:
 *
 *  1. CSS custom properties, if the host sets any on the iframe document. Hosts
 *     that do this are the only ones that can be matched exactly, so they win.
 *  2. A font stack and a palette that name what the host is likely using.
 *
 * The result is fed into the renderers as a `Theme`, which means the same code
 * that draws a card here draws the card in the server's PNG — only the token
 * values differ.
 */

import { themeFor, type Theme } from "@music-ai/render";

/**
 * ChatGPT's UI faces first, then the platform's own. Naming the families is the
 * only route available: a `default-src 'none'` policy blocks every font file,
 * so a face is either already on the machine or it is not going to be. The
 * generics at the end are what actually render for most people, and on macOS
 * and Windows those are close cousins of the real thing.
 */
export const UI_FONT =
  "'OpenAI Sans', 'Söhne', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Custom-property names worth trying, most specific first. Hosts have shipped
 * several spellings and none of them are contractual, so this is a best-effort
 * probe: a name that resolves to nothing simply falls through to the default.
 */
const TOKENS = {
  border: ["--openai-border-default", "--border-default", "--border-light", "--border-medium"],
  ink: ["--openai-text-primary", "--text-primary", "--text-color"],
  inkMuted: ["--openai-text-secondary", "--text-secondary", "--text-tertiary"],
  accent: ["--openai-accent", "--accent-primary", "--link-color"],
} as const;

function readVar(style: CSSStyleDeclaration, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * The theme to draw with, given the theme name the host reported.
 *
 * Deliberately tolerant: a host that exposes nothing gets the defaults, which
 * are already tuned to ChatGPT's palette, and a host that exposes some of these
 * gets a diagram that matches it exactly on those axes.
 */
export function hostTheme(name: "light" | "dark"): Theme {
  const base: Theme = { ...themeFor(name), font: UI_FONT };
  if (typeof getComputedStyle !== "function") return base;

  const style = getComputedStyle(document.documentElement);
  const border = readVar(style, TOKENS.border);
  const ink = readVar(style, TOKENS.ink);
  const inkMuted = readVar(style, TOKENS.inkMuted);
  const accent = readVar(style, TOKENS.accent);

  return {
    ...base,
    // The host's hairline becomes ours: the rules on a chord sheet and the
    // dividers between white keys are the same kind of line it draws.
    ...(border ? { rule: border, keyOutline: border } : {}),
    ...(ink ? { ink, dot: ink } : {}),
    ...(inkMuted ? { inkMuted } : {}),
    // The accent is the lit key. If the host names its own, use it — a lit key
    // in the host's own blue is the single strongest native cue there is.
    ...(accent ? { accent, keyLit: accent } : {}),
  };
}
