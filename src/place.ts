import { BASE_URL, fetchHtml, fetchJson } from "./http.ts";
import { extractNextData, stripHtml } from "./nextData.ts";

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: any }>();

/** Accept a websiteUrlPath or a full nationaltrust.org.uk URL; return a safe absolute URL. Blocks other hosts (SSRF). */
export function resolvePlaceUrl(pathOrUrl: string): string {
  const input = pathOrUrl.trim();
  let url: URL;
  try {
    url = input.startsWith("/") && !input.startsWith("//") ? new URL(input, BASE_URL) : new URL(input);
  } catch {
    throw new Error(`Not a valid path or URL: ${pathOrUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed.");
  if (url.hostname !== "www.nationaltrust.org.uk" && url.hostname !== "nationaltrust.org.uk") {
    throw new Error("Only www.nationaltrust.org.uk place pages are allowed.");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) throw new Error("Invalid URL.");
  return `${BASE_URL}${url.pathname}`;
}

/** Today's date in the UK as YYYY-MM-DD. */
export function ukToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pence -> "£18.00". */
export function formatPence(amount: { amount?: number } | null | undefined): string | undefined {
  if (amount?.amount === undefined || amount.amount === null) return undefined;
  return `£${(amount.amount / 100).toFixed(2)}`;
}

/** Keep only opening days within [from, to], compacted to { date: { status, times: { asset: "hh:mm-hh:mm" | "Closed" } } }. */
export function sliceOpening(days: Record<string, any> = {}, from: string, to: string) {
  const out: Record<string, { status: string; times: Record<string, string> }> = {};
  for (const date of Object.keys(days).sort()) {
    if (date < from || date > to) continue;
    const d = days[date];
    const times: Record<string, string> = {};
    for (const a of d.assets ?? []) {
      times[a.name] = a.opensAt && a.closesAt && a.opensAt !== "Closed" ? `${a.opensAt}-${a.closesAt}` : a.description || "Closed";
    }
    out[date] = { status: d.status, times };
  }
  return out;
}

export function shapePlace(data: any, from: string, to: string) {
  const e = data._embedded ?? {};
  const loc = data.location ?? {};
  const addr = loc.postalAddress ?? {};
  const desc = data.description;
  const facilities = shapeFacilities(e.placeFacilities?.facilities);
  const features = Object.assign({}, ...(data.featureCategories ?? []).map((c: any) => c.features ?? {}));
  const directions = Object.fromEntries(
    Object.entries<any>(e.directions?.directions ?? {}).map(([mode, d]) => {
      const text = stripHtml(d?.htmlDescription);
      const link = d?.moreInfoUrl ?? d?.cycleRouteUrl;
      return [mode, link ? `${text} (${link})` : text];
    }),
  );
  return {
    id: data.placeId,
    name: data.name,
    url: data.websiteUrl,
    path: data.websiteUrlPath,
    summary: typeof desc === "string" ? desc : desc?.strapline,
    description: typeof desc === "string" ? undefined : stripHtml(desc?.htmlDescription),
    address: [...(addr.lines ?? []), addr.town, addr.county, addr.postcode].filter(Boolean).join(", "),
    lat: loc.latitudeLongitude?.latitude,
    lon: loc.latitudeLongitude?.longitude,
    region: loc.region ?? data.cmsRegion,
    contact: {
      telephone: data.contact?.telephone,
      email: data.contact?.email,
      social: (data.contact?.socialMediaLinks ?? []).map((s: any) => s.url),
    },
    opening: {
      note: stripHtml(e.opening?.openingTimesNote),
      from,
      to,
      days: sliceOpening(e.opening?.days, from, to),
    },
    prices: {
      note: stripHtml(e.admissionPrices?.htmlNote),
      categories: (e.admissionPrices?.categories ?? []).map((c: any) => ({
        name: c.name,
        prices: [...(c.admissionPrices ?? []), ...(c.groupAdmissionPrices ?? [])].map((p: any) => ({
          name: p.name,
          standard: formatPence(p.standardAmount),
          ...(p.giftAidAmount ? { withGiftAid: formatPence(p.giftAidAmount) } : {}),
        })),
      })),
    },
    features,
    facilities,
    access: (e.accessTags?.tags ?? []).map((t: any) => ({ name: t.name, detail: stripHtml(t.description) })),
    directions,
  };
}

/** Available facilities, one per name, keeping the site's notes (e.g. where dogs may go). */
export function shapeFacilities(list: any[] = []) {
  const byName = new Map<string, string[]>();
  for (const f of list) {
    if (!f.available) continue;
    const notes = byName.get(f.name) ?? [];
    const note = stripHtml(f.description);
    if (note && !notes.includes(note)) notes.push(note);
    byName.set(f.name, notes);
  }
  return [...byName].map(([name, notes]) => (notes.length ? { name, note: notes.join(" ") } : { name }));
}

type Card = { title: string; description?: string; url?: string };
export type CmsInfo = {
  highlights: { title: string; description?: string }[];
  thingsToDo: { section: string; items: Card[] }[];
  visitorInfo: { accessSummary?: string; articles: Card[] };
};

/** Pull highlights, things to do and visitor info from the CMS JSON (/api/resourceapi/...). */
export function shapeCms(cms: any): CmsInfo | undefined {
  const pages = Object.values<any>(cms?.page ?? {});
  const d = pages.find((p) => p?.data?.contentType === "ntcmsplatform:Place")?.data;
  if (!d) return undefined;
  const card = (c: any): Card => ({
    title: c.title,
    ...(c.description ? { description: stripHtml(c.description) } : {}),
    ...(c.url ? { url: c.url.startsWith("/") ? `${BASE_URL}${c.url}` : c.url } : {}),
  });
  const cards = (list: any[] = []): Card[] => list.filter((c) => c?.title).map(card);
  return {
    highlights: (d.highlights?.feature ?? [])
      .filter((f: any) => f?.title)
      .map((f: any): { title: string; description?: string } => ({ title: f.title, description: stripHtml(f.description) })),
    thingsToDo: (d.thingsToSeeAndDo ?? [])
      .map((s: any): { section: string; items: Card[] } => ({ section: String(s.title ?? "").split(".").pop()!, items: cards(s.cards) }))
      .filter((s: { items: Card[] }) => s.items.length),
    visitorInfo: {
      accessSummary: stripHtml(d.visitorInfo?.accessDescription),
      articles: (d.visitorInfo?.cardGrids ?? []).flatMap((g: any) => cards(g.cards)),
    },
  };
}

export function parsePlaceHtml(html: string): any {
  const data = extractNextData(html)?.props?.pageProps?.appContext?.place?.data;
  if (!data) throw new Error("This page is not a National Trust place page (no place data found).");
  return data;
}

export async function getPlace(input: { path: string; fromDate?: string; toDate?: string }) {
  const url = resolvePlaceUrl(input.path);
  let hit = cache.get(url);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const data = parsePlaceHtml(await fetchHtml(url));
    // CMS content is extra detail; the place is still useful without it.
    const cms = await fetchJson(`${BASE_URL}/api/resourceapi${new URL(url).pathname}`)
      .then(shapeCms)
      .catch(() => undefined);
    hit = { at: Date.now(), data: { data, cms } };
    cache.set(url, hit);
  }
  const from = input.fromDate ?? ukToday();
  const to = input.toDate ?? addDays(from, 6);
  return { ...shapePlace(hit.data.data, from, to), ...hit.data.cms };
}
