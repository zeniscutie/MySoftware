import type { BrandPack, ContentPack } from "./schemas.ts";

/**
 * Deterministic checks on what the Ad Creator and Brand Designer hand back. A failed check never drops the item:
 * it's saved with its problems listed, so the owner sees exactly what to fix.
 */

/** Lower-cased, punctuation folded to spaces, so "Clinically-proven!" matches "clinically proven". */
export function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim()} `;
}

/** Banned phrases found in the text, as whole words. */
export function bannedIn(text: string, banned: string[]): string[] {
  const hay = normalize(text);
  return banned.filter((b) => {
    const needle = normalize(b);
    return needle.trim() !== "" && hay.includes(needle);
  });
}

/** Strips characters that would let stored web text pose as our own prompt sections. */
export function fenceUntrusted(text: string | null | undefined, max = 600): string {
  return (text ?? "").replace(/<\/?\s*untrusted[^>]*>/gi, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export type ItemProblems = { index: number; problems: string[] };

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return "";
}

/** Problems per ad script, ad copy and post: banned claims, and the product's own competitor names in copy. */
export function checkContentPack(pack: ContentPack, opts: { bannedClaims: string[]; hooksPerScript: number }): {
  adScripts: ItemProblems[];
  adCopy: ItemProblems[];
  organicPosts: ItemProblems[];
} {
  const scan = <T>(items: T[], extra?: (item: T) => string[]) =>
    items.map((item, index) => {
      const problems = bannedIn(textOf(item), opts.bannedClaims).map((b) => `Uses a banned claim: "${b}"`);
      return { index, problems: [...problems, ...(extra?.(item) ?? [])] };
    });
  return {
    adScripts: scan(pack.adScripts, (s) => (s.hooks.length < opts.hooksPerScript ? [`Has ${s.hooks.length} hook${s.hooks.length === 1 ? "" : "s"}; you asked for ${opts.hooksPerScript}`] : [])),
    adCopy: scan(pack.adCopy, (c) => (c.headline.length > 40 ? ["Headline is over 40 characters and will be cut off on most placements"] : [])),
    organicPosts: scan(pack.organicPosts),
  };
}

/** Relative luminance (WCAG) of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1! + 0.05) / (l2! + 0.05)) * 100) / 100;
}

/** Brand checks: duplicate names, a palette with no readable text pairing. */
export function checkBrandPack(pack: BrandPack): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const n of pack.storeNames) {
    const key = n.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) problems.push(`Store name "${n.name}" is listed twice`);
    seen.add(key);
  }
  const palette = pack.identity?.palette ?? [];
  if (palette.length >= 2) {
    let best = 0;
    for (const a of palette) for (const b of palette) if (a !== b) best = Math.max(best, contrast(a.hex, b.hex));
    if (best < 4.5) problems.push(`No two palette colours are readable together (best contrast ${best}:1, text needs 4.5:1)`);
  }
  return problems;
}
