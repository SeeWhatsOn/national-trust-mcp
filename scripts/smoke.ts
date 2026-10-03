// Live smoke test: 3 real requests (filters page, search API, one place page), 1s apart.
import { handlers } from "../index.ts";
import { ukToday } from "../src/place.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const filters = await handlers.list_filters();
console.log("list_filters:", filters.map((g) => `${g.group}=${g.options.length}`).join(" "));
await sleep(1000);

const search = await handlers.search_places({ lat: 52.2111288, lon: -2.0285452, filters: ["gardens-and-parks"], pageSize: 5 });
console.log(`search_places (gardens within 50mi): total=${search.total}, returned=${search.results.length}`);
for (const r of search.results) console.log(`  ${r.name} — ${r.distanceMiles} mi — ${r.path} — ${r.features.slice(0, 4).join(", ")}`);
await sleep(1000);

const place = await handlers.get_place({ path: "/visit/worcestershire-herefordshire/hanbury-hall" });
const today = place.opening.days[ukToday()];
console.log(`get_place: ${place.name} (${place.address})`);
console.log(`  today ${ukToday()}: ${today?.status}`, JSON.stringify(today?.times));
console.log(`  adult price: ${JSON.stringify(place.prices.categories[0]?.prices[0])}`);
console.log(`  days returned: ${Object.keys(place.opening.days).length}, facilities: ${place.facilities.length}, access: ${place.access.length}, directions: ${Object.keys(place.directions).join(",")}`);
console.log(`  JSON size: ${JSON.stringify(place).length} chars`);

// cached second call must not hit the network
const t = performance.now();
await handlers.get_place({ path: "https://www.nationaltrust.org.uk/visit/worcestershire-herefordshire/hanbury-hall" });
console.log(`  cached call: ${(performance.now() - t).toFixed(1)}ms`);
