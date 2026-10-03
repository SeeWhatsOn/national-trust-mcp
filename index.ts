import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFilters, listFilters } from "./src/filters.ts";
import { searchPlaces, type SearchInput } from "./src/search.ts";
import { getPlace } from "./src/place.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const handlers = {
  search_places: (input: SearchInput) => searchPlaces(input),
  get_place: (input: { path: string; fromDate?: string; toDate?: string }) => getPlace(input),
  list_filters: async () => listFilters(await getFilters()),
};

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return asText(await fn());
  } catch (err) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

export function createServer() {
  const server = new McpServer({ name: "national-trust", version: "0.1.0" });

  server.registerTool(
    "search_places",
    {
      title: "Search National Trust places",
      description:
        "Search National Trust places (houses, gardens, castles, coast, countryside) in the UK. " +
        "Search by free text (`query`, e.g. 'castle'), by location (`lat`+`lon`, sorted nearest first, with distanceMiles), or both. " +
        "To filter by place type, accessibility, facilities, dogs or cost, FIRST call list_filters and pass its `reference` slugs in `filters`. " +
        "Use `openOn` (or `openFrom`/`openTo`) to only return places open on those dates; results then include per-day openingStatus. " +
        "Each result has a `path`; pass it to get_place for opening times, prices, facilities and directions.",
      inputSchema: {
        query: z.string().optional().describe("Free text, e.g. 'castle' or a place name. Optional."),
        lat: z.number().min(-90).max(90).optional().describe("Latitude of the search centre. Give with lon."),
        lon: z.number().min(-180).max(180).optional().describe("Longitude of the search centre. Give with lat."),
        milesRadius: z.number().positive().max(500).optional().describe("Search radius in miles when lat/lon given. Default 50."),
        filters: z
          .array(z.string())
          .optional()
          .describe("Filter `reference` slugs from list_filters, e.g. ['gardens', 'accessible-toilet']."),
        openOn: date.optional().describe("Only places open on this date (YYYY-MM-DD)."),
        openFrom: date.optional().describe("Start of an open-date range (YYYY-MM-DD). Use with openTo."),
        openTo: date.optional().describe("End of an open-date range (YYYY-MM-DD)."),
        page: z.number().int().min(1).optional().describe("1-based page number. Default 1."),
        pageSize: z.number().int().min(1).max(100).optional().describe("Results per page. Default 20, max 100."),
      },
    },
    (input) => run(() => handlers.search_places(input)),
  );

  server.registerTool(
    "get_place",
    {
      title: "Get National Trust place details",
      description:
        "Get full details for one National Trust place: description, address, contact, opening times per day " +
        "(per area, e.g. House/Garden/Café), admission prices in £ (standard and with Gift Aid), available facilities with notes " +
        "(e.g. where dogs are allowed), feature flags (familyFriendly, dogWalking…), accessibility notes, directions, " +
        "plus highlights (e.g. playground), things to do and visitor info articles. The facility yes/no flags can be wrong: " +
        "check highlights and notes too before saying a place lacks something. Pass the `path` from a search_places result (e.g. '/visit/worcestershire-herefordshire/hanbury-hall') " +
        "or a full https://www.nationaltrust.org.uk URL. Opening times default to today plus the next 6 days (UK time).",
      inputSchema: {
        path: z.string().min(1).describe("The `path` from search_places, or a full nationaltrust.org.uk place URL."),
        fromDate: date.optional().describe("First date of opening times to return (YYYY-MM-DD). Default today."),
        toDate: date.optional().describe("Last date of opening times to return (YYYY-MM-DD). Default fromDate + 6 days."),
      },
    },
    (input) => run(() => handlers.get_place(input)),
  );

  server.registerTool(
    "list_filters",
    {
      title: "List National Trust search filters",
      description:
        "List the filters search_places accepts: place types (e.g. gardens, castles), accessibility, facilities, dog-friendliness and cost. " +
        "Call this before using the `filters` input of search_places, and pass the `reference` values.",
      inputSchema: {},
    },
    () => run(() => handlers.list_filters()),
  );

  return server;
}

if (import.meta.main) {
  await createServer().connect(new StdioServerTransport());
}
