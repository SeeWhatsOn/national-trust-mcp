# national-trust-mcp

MCP server (stdio) for searching National Trust places and reading their opening times, prices and facilities.

## Tools

| Tool | What it does |
|---|---|
| `list_filters` | Filter slugs for place type, accessibility, facilities, dogs, cost |
| `search_places` | Search by text and/or `lat`+`lon`, with filters and open-date checks |
| `get_place` | Full detail for one place, using `path` from `search_places` |

## Use with Claude Code

```bash
bun install
claude mcp add national-trust -- bun run /home/cwatson/Dev/Watson/national-trust-mcp/index.ts
```

## Scripts

```bash
bun run start         # run the server on stdio
bun test              # unit tests against saved fixtures (no network)
bun run smoke         # live smoke test (3 requests to nationaltrust.org.uk)
bun run check:stdio   # start the server and list tools over MCP stdio
```

Data comes from the public website (search API plus place pages), so it can break if the site changes.
The site is behind Radware bot protection; if it blocks a request, tools return a clear error.
