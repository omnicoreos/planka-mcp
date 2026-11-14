#!/usr/bin/env node
/**
 * PLANKA MCP Server
 *
 * A Model Context Protocol server for PLANKA kanban boards.
 * Provides tools for managing projects, boards, cards, tasks, labels, and comments.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getToolDefinitions,
  getTool,
  allTools,
  effectiveInputSchema,
  findMissingRequiredArgs,
} from "./tools/index.js";
import {
  PlankaError,
  PlankaConfigError,
  PlankaInputError,
  formatInputError,
  formatMissingArgsError,
  formatResponseShapeError,
  isZodError,
} from "./errors.js";
import { SERVER_NAME, SERVER_VERSION } from "./identity.generated.js";
import { buildServerInstructions } from "./instructions.js";
import { listResources, readResource } from "./resources.js";
import { getPrompt, listPrompts } from "./prompts.js";
import { getPolicy } from "./config/policy.js";

/**
 * PLANKA_GET_CARD_COMMENTS for the handshake. A broken policy must not stop
 * the server from starting: the tool call that hits it reports the error.
 */
function getCardCommentsDefault(): number | "all" | null {
  try {
    return getPolicy().getCardComments;
  } catch {
    return null;
  }
}

/** Standard error response back to the model. */
function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

/**
 * Main entry point.
 */
async function main() {
  // Create the MCP server
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        // Both are read-only catalogues that never change while the process
        // lives, so neither declares listChanged.
        resources: {},
        prompts: {},
      },
      // Sent back in the initialize handshake. Claude Code puts it in the system
      // prompt, Codex reads it alongside the tool list.
      instructions: buildServerInstructions(getCardCommentsDefault()),
    }
  );

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getToolDefinitions(),
    };
  });

  // The guides that ship in the tarball, served on demand. Cost is zero until
  // a client actually reads one, which is why they hold what does not fit in
  // `instructions`.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    readResource(request.params.uri)
  );

  // Slash-command shaped entry points (Claude Code: /mcp__planka__…).
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) =>
    getPrompt(request.params.name, request.params.arguments ?? {})
  );

  // Handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = getTool(name);
    if (!tool) {
      return errorResult(
        `Unknown tool: ${name}. Available tools: ${allTools
          .map((t) => t.name)
          .join(", ")}`
      );
    }

    // Presence check before entering the handler: a missing required field has
    // to name the tool and the field, not die somewhere inside.
    const schema = effectiveInputSchema(tool);
    const missing = findMissingRequiredArgs(tool, args);
    if (missing.length > 0) {
      return errorResult(formatMissingArgsError(name, missing, args, schema));
    }

    try {
      const result = await tool.handler(args || {});
      return result;
    } catch (error) {
      // INPUT validation: name the tool, the field and what arrived.
      if (error instanceof PlankaInputError) {
        return errorResult(formatInputError(name, error, schema));
      }

      // A loose ZodError means Planka's RESPONSE did not match the schema.
      // Name it separately so the model does not assume it got the args wrong.
      if (isZodError(error)) {
        return errorResult(formatResponseShapeError(name, error));
      }

      // Handle configuration errors specifically
      if (error instanceof PlankaConfigError) {
        return errorResult(
          `Configuration error: ${error.message}\n\nRequired: PLANKA_BASE_URL, plus EITHER PLANKA_API_KEY (recommended) OR PLANKA_AGENT_EMAIL + PLANKA_AGENT_PASSWORD.`
        );
      }

      // Handle other PLANKA errors
      if (error instanceof PlankaError) {
        return errorResult(`PLANKA error: ${error.message}`);
      }

      // Log unexpected errors and return generic message
      console.error(`Error in tool ${name}:`, error);
      return errorResult(
        `Unexpected error while running ${name}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup (to stderr so it doesn't interfere with MCP protocol)
  console.error("PLANKA MCP server started");
}

/**
 * The binary has two jobs. Started by an MCP client it speaks stdio and must
 * never print to stdout; run by a human as `planka-mcp init` it configures that
 * client instead. The subcommand is dispatched before anything MCP is loaded so
 * a missing PLANKA_BASE_URL cannot break the setup command that exists to fix it.
 */
const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./cli/init.js");
  const { createInterface } = await import("node:readline/promises");
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  try {
    const code = await runInit(process.argv.slice(3), {
      // Secrets must not echo: readline has no password mode, so its output
      // writer is muted for the duration of the answer (the same trick the
      // shell installer got from `read -s`).
      ask: rl
        ? async (question: string, secret = false) => {
            if (!secret) return (await rl.question(`${question}: `)).trim();
            const iface = rl as unknown as {
              _writeToOutput: (text: string) => void;
            };
            const previous = iface._writeToOutput;
            iface._writeToOutput = (text: string) => {
              if (text.includes(question)) previous.call(iface, text);
            };
            try {
              const answer = await rl.question(`${question}: `);
              process.stdout.write("\n");
              return answer.trim();
            } finally {
              iface._writeToOutput = previous;
            }
          }
        : undefined,
    });
    process.exitCode = code;
  } catch (error) {
    console.error(`init failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    rl?.close();
  }
} else {
  // Run the server
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
