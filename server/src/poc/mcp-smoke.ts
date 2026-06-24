/**
 * MCP smoke test — spawns the built server over stdio, lists tools, and calls
 * one read-only tool. Verifies the MCP protocol layer + tool registration work
 * (not just that the code compiles).
 *
 *   npm run build -w server && npm run smoke -w server
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath, // the node binary — avoids Windows .cmd shim issues
    args: ["dist/index.js"],
    stderr: "inherit",
  });

  const client = new Client({ name: "imagetool-smoke", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("Registered tools:", tools.map((t) => t.name).join(", "));

  const res = await client.callTool({ name: "list_monitors", arguments: {} });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  const monitors = JSON.parse(text) as Array<{ name: string; width: number; height: number }>;
  console.log(`list_monitors -> ${monitors.length} monitor(s): ` +
    monitors.map((m) => `${m.name} ${m.width}x${m.height}`).join(", "));

  await client.close();
  console.log("\n✓ MCP smoke test passed.");
}

main().catch((err) => {
  console.error("smoke test failed:", err);
  process.exit(1);
});
