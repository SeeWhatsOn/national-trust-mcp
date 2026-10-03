import { test, expect, describe } from "bun:test";
import { isBlocked } from "../src/http.ts";
import { extractNextData, stripHtml } from "../src/nextData.ts";
import { parseFilters, buildTagGroups, translateTags, listFilters } from "../src/filters.ts";
import { buildSearchParams, haversineMiles, shapeSearchResponse } from "../src/search.ts";
import {
  addDays, formatPence, parsePlaceHtml, resolvePlaceUrl, shapeCms, shapePlace, sliceOpening, ukToday,
} from "../src/place.ts";

const fx = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}`);
const searchPage = await fx("search-page.html").text();
const placePage = await fx("place-page.html").text();
const radware = await fx("radware-page.html").text();
const searchJson = await fx("search-response.json").json();
const dict = parseFilters(searchPage);

describe("block detection", () => {
  test("flags the Radware page", () => expect(isBlocked(radware)).toBe(true));
  test("passes real pages and JSON", () => {
    expect(isBlocked(placePage)).toBe(false);
    expect(isBlocked(JSON.stringify(searchJson))).toBe(false);
  });
});

describe("__NEXT_DATA__", () => {
  test("extracts JSON payload", () => {
    expect(extractNextData(placePage).props.pageProps.appContext.place.data.placeId).toBe(160);
  });
  test("throws when missing", () => expect(() => extractNextData("<html></html>")).toThrow(/__NEXT_DATA__/));
  test("stripHtml removes tags and decodes entities", () => {
    expect(stripHtml("<p>Don&#39;t&nbsp;miss</p>\r\n<p>A &amp; B</p>")).toBe("Don't miss\nA & B");
    expect(stripHtml(undefined)).toBe("");
  });
});

describe("filters", () => {
  test("parses all five groups", () => {
    expect(dict.placeTypes).toHaveLength(9);
    expect(dict.placeAccessibility).toHaveLength(8);
    expect(dict.placeFacilities).toHaveLength(8);
    expect(dict.placeDogs).toHaveLength(3);
    expect(dict.placeCost).toHaveLength(7);
  });

  test("place types share ONE OR-group", () => {
    expect(buildTagGroups(dict, ["gardens-and-parks", "houses-and-buildings"])).toEqual(["IA000006:IA000002:IA000012"]);
  });
  test("each accessibility item is its own group, its codes ORed", () => {
    expect(buildTagGroups(dict, ["accessible-toilet", "changing-places-toilet"])).toEqual([
      "TAG000970",
      "TAG002724:TAG002723",
    ]);
  });
  test("dog items share one group; cost items separate; order follows groups", () => {
    expect(
      buildTagGroups(dict, ["free-parking", "two-pawprints", "three-pawprints", "gardens-and-parks", "free-access-to-garden"]),
    ).toEqual(["IA000012", "TAG002707:TAG002706", "TAG002713", "TAG002714"]);
  });
  test("rejects unknown slugs", () => {
    expect(() => buildTagGroups(dict, ["moon-base"])).toThrow(/moon-base.*list_filters/);
  });
  test("translates tag codes into names and drops unknown codes", () => {
    const names = translateTags(dict, ["IA000012", "TAG000970", "TAG999999", "TAG002706"]);
    const twoPaw = dict.placeDogs.find((d) => d.reference === "two-pawprints")!.name;
    expect(names).toEqual(["Gardens & parks", "Accessible toilet", twoPaw]);
    expect(names.some((n) => n.startsWith("TAG"))).toBe(false);
  });
  test("listFilters exposes reference + name only", () => {
    const groups = listFilters(dict);
    expect(groups.map((g) => g.group)).toEqual(["placeTypes", "placeAccessibility", "placeFacilities", "placeDogs", "placeCost"]);
    expect(groups[0]!.options[0]).toEqual({ reference: "houses-and-buildings", name: "Houses" });
  });
});

describe("search params", () => {
  test("location search", () => {
    const p = buildSearchParams({ lat: 52.2, lon: -2.0, openOn: "2026-12-25", page: 2, pageSize: 10 }, ["IA000012", "TAG000970"]);
    expect(p.getAll("query")).toEqual([""]);
    expect(p.get("milesRadius")).toBe("50");
    expect(p.get("placeSort")).toBe("distance");
    expect(p.get("pageStartIndex")).toBe("10");
    expect(p.get("pageSize")).toBe("10");
    expect(p.getAll("tagGroup")).toEqual(["IA000012", "TAG000970"]);
    expect(p.get("openFromDate")).toBe("2026-12-25");
    expect(p.get("openToDate")).toBe("2026-12-25");
    expect(p.get("maxPlaceResults")).toBe("1000");
    expect(p.get("maxLocationPageResults")).toBe("0");
    expect(p.has("placeAgg")).toBe(false);
  });
  test("text search without location", () => {
    const p = buildSearchParams({ query: "castle", pageSize: 500 }, []);
    expect(p.get("placeSort")).toBe("alphabetical");
    expect(p.has("lat")).toBe(false);
    expect(p.has("milesRadius")).toBe(false);
    expect(p.get("pageSize")).toBe("100");
    expect(p.has("tagGroup")).toBe(false);
  });
  test("lat without lon is an error", () => {
    expect(() => buildSearchParams({ lat: 52 }, [])).toThrow(/both lat and lon/);
  });
});

describe("haversine", () => {
  test("zero distance", () => expect(haversineMiles(52, -2, 52, -2)).toBe(0));
  test("London to Edinburgh is ~331 miles", () => {
    expect(haversineMiles(51.5074, -0.1278, 55.9533, -3.1883)).toBeCloseTo(331, -1);
  });
});

describe("shapeSearchResponse", () => {
  const out = shapeSearchResponse(searchJson, { lat: 52.2111288, lon: -2.0285452 }, dict);
  test("compact result", () => {
    expect(out.total).toBe(searchJson.pagedMultiMatch.totalNumberOfMatches);
    expect(out.page).toBe(1);
    const r = out.results[0];
    expect(r.id).toBe("160");
    expect(r.name).toBe("Hanbury Hall");
    expect(r.path).toBe("/visit/worcestershire-herefordshire/hanbury-hall");
    expect(r.distanceMiles).toBeGreaterThan(4);
    expect(r.distanceMiles).toBeLessThan(6);
    expect(r.openingStatus["2026-10-03"]).toBe("FULLY_OPEN");
    expect(r.features).toContain("Gardens & parks");
    expect(r).not.toHaveProperty("tagRefs");
  });
  test("no distance without location", () => {
    expect(shapeSearchResponse(searchJson, {}, dict).results[0]).not.toHaveProperty("distanceMiles");
  });
  test("throws on unexpected shape", () => expect(() => shapeSearchResponse({}, {}, dict)).toThrow());
});

describe("place", () => {
  const data = parsePlaceHtml(placePage);

  test("resolvePlaceUrl accepts paths and NT URLs", () => {
    expect(resolvePlaceUrl("/visit/a/b")).toBe("https://www.nationaltrust.org.uk/visit/a/b");
    expect(resolvePlaceUrl("https://www.nationaltrust.org.uk/visit/a/b?x=1")).toBe("https://www.nationaltrust.org.uk/visit/a/b");
  });
  test("resolvePlaceUrl blocks other hosts (SSRF)", () => {
    for (const bad of [
      "https://evil.com/visit",
      "//evil.com/x",
      "https://www.nationaltrust.org.uk.evil.com/",
      "http://169.254.169.254/",
      "file:///etc/passwd",
      "https://user@www.nationaltrust.org.uk:8080/x",
    ]) expect(() => resolvePlaceUrl(bad)).toThrow();
  });

  test("formatPence", () => {
    expect(formatPence({ amount: 1800 })).toBe("£18.00");
    expect(formatPence({ amount: 945 })).toBe("£9.45");
    expect(formatPence(undefined)).toBeUndefined();
  });

  test("dates", () => {
    expect(addDays("2026-12-29", 6)).toBe("2027-01-04");
    expect(ukToday(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04"); // BST
  });

  test("sliceOpening keeps only the range, inclusive", () => {
    const days = sliceOpening(data._embedded.opening.days, "2026-10-03", "2026-10-05");
    expect(Object.keys(days)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(days["2026-10-03"]!.times.House).toBe("10:00-16:00");
    expect(sliceOpening(data._embedded.opening.days, "2026-12-25", "2026-12-25")["2026-12-25"]!.times.House).toBe("Closed");
  });

  test("shapePlace", () => {
    const p = shapePlace(data, "2026-10-03", "2026-10-09");
    expect(p.name).toBe("Hanbury Hall");
    expect(p.address).toContain("WR9 7EA");
    expect(p.prices.categories[0].prices[0]).toEqual({ name: "Adult (18+)", standard: "£18.00", withGiftAid: "£19.80" });
    expect(p.prices.note).not.toContain("<");
    const names = p.facilities.map((f) => f.name);
    expect(names).toContain("Café");
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Lifeguard");
    expect(p.facilities.find((f) => f.name === "Dogs allowed")?.note).toContain("Stables Café");
    expect(p.features).toMatchObject({ familyFriendly: true, dogWalking: true });
    expect(p.access[0].name).toBe("Accessible route and/or map");
    expect(p.directions.train).toBe("Droitwich Spa 4 miles");
    expect(p.description).not.toContain("<p>");
    expect(Object.keys(p.opening.days)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-09"]);
  });

  test("shapeCms pulls highlights, things to do and visitor info", async () => {
    const c = shapeCms(await fx("place-cms.json").json())!;
    expect(c.highlights.find((h) => h.title === "Playground")?.description).toContain("adventure playground");
    expect(c.thingsToDo.map((s) => s.section)).toContain("eating");
    expect(c.visitorInfo.articles.find((a) => a.title.includes("with your dog"))?.url).toStartWith("https://www.nationaltrust.org.uk/visit/");
    expect(c.visitorInfo.accessSummary).toContain("Blue Badge");
    expect(shapeCms({ page: {} })).toBeUndefined();
  });

  test("parsePlaceHtml rejects non-place pages",() => expect(() => parsePlaceHtml(searchPage)).toThrow(/not a National Trust place/));
});
