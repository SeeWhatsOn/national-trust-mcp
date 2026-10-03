export const BASE_URL = "https://www.nationaltrust.org.uk";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const common = {
  "User-Agent": UA,
  "Accept-Language": "en-GB,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="141", "Not?A_Brand";v="8"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
};
export const apiHeaders = {
  ...common,
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE_URL}/search?type=place`,
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};
export const docHeaders = {
  ...common,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export class BlockedError extends Error {
  constructor(url: string) {
    super(
      `The National Trust website's bot protection (Radware) blocked the request to ${url}. Try again later.`,
    );
    this.name = "BlockedError";
  }
}

/** True when a response body is the Radware bot-challenge page instead of real content. */
export function isBlocked(body: string): boolean {
  return /radware/i.test(body.slice(0, 5000));
}

async function get(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers, redirect: "follow" });
  const body = await res.text();
  if (isBlocked(body)) throw new BlockedError(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return body;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const body = await get(url, apiHeaders);
  try {
    return JSON.parse(body) as T;
  } catch {
    // Non-JSON from a JSON endpoint is almost always a challenge/interstitial page.
    throw new BlockedError(url);
  }
}

export function fetchHtml(url: string): Promise<string> {
  return get(url, docHeaders);
}
