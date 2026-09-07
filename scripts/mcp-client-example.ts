/**
 * The smallest MCP client for mh: starts the server over stdio, lists its tools,
 * reads a film's layers and changes one value. Run from the harness repo:
 *   bun run scripts/mcp-client-example.ts /path/to/project
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const project = resolve(process.argv[2] ?? ".");
const client = new Client({ name: "example", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "bun", args: ["run", resolve(import.meta.dir, "../src/mcp/server.ts")] }));
const tools = await client.listTools();
console.log(tools.tools.map((t) => t.name).join(", "));
const layers = await client.callTool({ name: "mh_layers", arguments: { project } });
console.log((layers.content as { text: string }[])[0].text.split("\n").slice(0, 8).join("\n"));
const set = await client.callTool({ name: "mh_set", arguments: { project, address: process.argv[3] ?? "hook.line.size", value: process.argv[4] ?? "104" } });
console.log((set.content as { text: string }[])[0].text);
await client.close();
