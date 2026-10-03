import { BASE_URL, fetchJson } from "./http.ts";
import { buildTagGroups, getFilters, translateTags, type FilterDictionary } from "./filters.ts";

export type SearchInput = {
  query?: string;
  lat?: number;
  lon?: number;
  milesRadius?: number;
  filters?: string[];
  openOn?: string;
  openFrom?: string;
  openTo?: string;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function buildSearchParams(input: SearchInput, tagGroups: string[]): URLSearchParams {
  const p = new URLSearchParams();
  p.append("query", input.query ?? "");
  const hasLoc = input.lat !== undefined && input.lon !== undefined;
  if ((input.lat === undefined) !== (input.lon === undefined)) throw new Error("Give both lat and lon, or neither.");
  if (hasLoc) {
    p.append("lat", String(input.lat));
    p.append("lon", String(input.lon));
    p.append("milesRadius", String(input.milesRadius ?? 50));
  }
  p.append("placeSort", hasLoc ? "distance" : "alphabetical");
  const pageSize = Math.min(Math.max(input.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(input.page ?? 1, 1);
  p.append("pageStartIndex", String((page - 1) * pageSize));
  p.append("pageSize", String(pageSize));
  for (const g of tagGroups) p.append("tagGroup", g);
  const from = input.openOn ?? input.openFrom;
  const to = input.openOn ?? input.openTo ?? input.openFrom;
  if (from && to) {
    p.append("openFromDate", from);
    p.append("openToDate", to);
  }
  p.append("lang", "en");
  p.append("publicationChannel", "NATIONAL_TRUST_ORG_UK");
  p.append("maxPlaceResults", "1000");
  p.append("maxLocationPageResults", "0");
  return p;
}

/** Great-circle distance in miles. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function shapeSearchResponse(raw: any, input: SearchInput, dict: FilterDictionary) {
  const m = raw?.pagedMultiMatch;
  if (!m || !Array.isArray(m.results)) throw new Error("Unexpected search response shape from National Trust API.");
  const hasLoc = input.lat !== undefined && input.lon !== undefined;
  const pageSize = m.pageSize || 1;
  return {
    total: m.totalNumberOfMatches,
    page: Math.floor((m.pageStartIndex ?? 0) / pageSize) + 1,
    pageSize: m.pageSize,
    lastPage: m.lastPage,
    results: m.results.map((r: any) => {
      const lat = r.location?.lat;
      const lon = r.location?.lon;
      return {
        id: r.id?.value,
        name: r.title,
        description: r.description,
        town: r.town,
        county: r.county,
        ...(hasLoc && lat !== undefined
          ? { distanceMiles: Math.round(haversineMiles(input.lat!, input.lon!, lat, lon) * 10) / 10 }
          : {}),
        lat,
        lon,
        path: r.websiteUrlPath,
        url: r.websiteUrl ?? (r.websiteUrlPath ? BASE_URL + r.websiteUrlPath : undefined),
        ...(r.dayOpeningStatus?.length
          ? { openingStatus: Object.fromEntries(r.dayOpeningStatus.map((d: any) => [d.date, d.openingTimeStatus])) }
          : {}),
        features: translateTags(dict, r.tagRefs),
      };
    }),
  };
}

export async function searchPlaces(input: SearchInput) {
  const dict = await getFilters();
  const params = buildSearchParams(input, buildTagGroups(dict, input.filters ?? []));
  const raw = await fetchJson<any>(`${BASE_URL}/api/search/places?${params}`);
  return shapeSearchResponse(raw, input, dict);
}
