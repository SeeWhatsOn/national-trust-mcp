// Starts the server over stdio and lists its tools (no network calls to the site).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "bun", args: ["run", `${import.meta.dir}/../index.ts`] });
const client = new Client({ name: "stdio-check", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
for (const t of tools) console.log(`${t.name}: inputs=${Object.keys((t.inputSchema as any).properties ?? {}).join(",")}`);
const bad = await client.callTool({ name: "get_place", arguments: { path: "https://evil.com/x" } });
console.log("SSRF guard:", bad.isError, JSON.stringify(bad.content));
await client.close();
