import { BASE_URL, fetchHtml } from "./http.ts";
import { extractNextData } from "./nextData.ts";

export type FilterItem = { reference: string; name: string; tagRefs: string[] };
export type FilterGroup = "placeTypes" | "placeAccessibility" | "placeFacilities" | "placeDogs" | "placeCost";
export type FilterDictionary = Record<FilterGroup, FilterItem[]>;

export const GROUPS: FilterGroup[] = ["placeTypes", "placeAccessibility", "placeFacilities", "placeDogs", "placeCost"];

const TTL_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; dict: FilterDictionary } | undefined;

export function parseFilters(html: string): FilterDictionary {
  const pf = extractNextData(html)?.props?.pageProps?.filters?.placeFilters;
  if (!pf) throw new Error("Could not find placeFilters on the search page.");
  const dict = {} as FilterDictionary;
  for (const g of GROUPS) {
    dict[g] = (pf[g] ?? []).map((i: any) => ({ reference: i.reference, name: i.name, tagRefs: i.tagRefs ?? [] }));
  }
  return dict;
}

export async function getFilters(): Promise<FilterDictionary> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.dict;
  const dict = parseFilters(await fetchHtml(`${BASE_URL}/search?query=&type=place`));
  cache = { at: Date.now(), dict };
  return dict;
}

/**
 * Turn selected filter slugs into tagGroup params, mirroring the site:
 * - placeTypes: all selected types' tagRefs in ONE OR-group
 * - placeDogs: all selected dog items in ONE OR-group
 * - placeAccessibility / placeFacilities / placeCost: each item is its own group (AND)
 * Separate tagGroups are ANDed; codes joined by ":" within a group are ORed.
 */
export function buildTagGroups(dict: FilterDictionary, refs: string[]): string[] {
  const wanted = new Set(refs);
  const found = new Set<string>();
  const groups: string[] = [];
  for (const g of GROUPS) {
    const picked = dict[g].filter((i) => wanted.has(i.reference));
    picked.forEach((i) => found.add(i.reference));
    if (!picked.length) continue;
    if (g === "placeTypes" || g === "placeDogs") groups.push(picked.flatMap((i) => i.tagRefs).join(":"));
    else for (const i of picked) groups.push(i.tagRefs.join(":"));
  }
  const unknown = refs.filter((r) => !found.has(r));
  if (unknown.length) {
    throw new Error(`Unknown filter reference(s): ${unknown.join(", ")}. Call list_filters for valid values.`);
  }
  return groups;
}

/** Names of dictionary items whose tagRefs overlap the place's tag codes. Raw codes are dropped. */
export function translateTags(dict: FilterDictionary, tagRefs: string[] = []): string[] {
  const have = new Set(tagRefs);
  const names: string[] = [];
  for (const g of GROUPS) {
    for (const i of dict[g]) if (i.tagRefs.some((t) => have.has(t)) && !names.includes(i.name)) names.push(i.name);
  }
  return names;
}

export function listFilters(dict: FilterDictionary) {
  const labels: Record<FilterGroup, string> = {
    placeTypes: "Place type (selected types are ORed together)",
    placeAccessibility: "Accessibility (each one selected must match)",
    placeFacilities: "Facilities (each one selected must match)",
    placeDogs: "Dogs (selected ratings are ORed together)",
    placeCost: "Cost (each one selected must match)",
  };
  return GROUPS.map((g) => ({
    group: g,
    description: labels[g],
    options: dict[g].map((i) => ({ reference: i.reference, name: i.name })),
  }));
}
