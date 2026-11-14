/**
 * Tool registry for PLANKA MCP server.
 */
import { navigationTools } from "./navigation.js";
import { cardTools, getCardCommentsPresentation } from "./cards.js";
import { taskTools } from "./tasks.js";
import { labelTools } from "./labels.js";
import { commentTools } from "./comments.js";
import { listTools } from "./lists.js";
import { attachmentTools } from "./attachments.js";
import { queryTools } from "./queries.js";
import { activityTools } from "./activity.js";
import { memberTools } from "./members.js";
import { userTools } from "./users.js";
import { cardOpsTools } from "./card-ops.js";
import { toolPresentation } from "./annotations.js";
import { missingRequiredArgs } from "./dispatch.js";
import {
  AccessPolicy,
  getPolicy,
  isToolVisible,
  toolBlockedReason,
} from "../config/policy.js";

/**
 * All registered tools.
 */
export const allTools = [
  ...navigationTools,
  ...queryTools,
  ...cardTools,
  ...taskTools,
  ...labelTools,
  ...commentTools,
  ...listTools,
  ...attachmentTools,
  ...activityTools,
  ...memberTools,
  ...userTools,
  ...cardOpsTools,
];

/**
 * Content blocks a tool may return.
 * "image" lets the model actually SEE an attached screenshot (base64).
 */
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Tool type definition.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (params: unknown) => Promise<{
    content: ToolContent[];
    isError?: boolean;
  }>;
}

/**
 * A tool the policy switched off, kept callable so the refusal can explain
 * itself. Hiding it from tools/list is not enough: a model working from a
 * cached list, or from a skill that names the tool, would otherwise get a
 * generic "unknown tool" and keep trying.
 */
function blockedTool(name: string, reason: string): Tool {
  return {
    name,
    description: reason,
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({
      content: [{ type: "text" as const, text: reason }],
      isError: true,
    }),
  };
}

/**
 * Get a tool by name.
 *
 * Returns a refusing stub for tools disabled by PLANKA_READ_ONLY or
 * PLANKA_DISABLED_TOOLS, and undefined only for names that do not exist.
 */
export function getTool(
  name: string,
  policy: AccessPolicy = getPolicy()
): Tool | undefined {
  const tool = allTools.find((t) => t.name === name) as Tool | undefined;
  if (!tool) return undefined;

  const reason = toolBlockedReason(tool.name, policy);
  return reason ? blockedTool(tool.name, reason) : tool;
}

/**
 * Required inputSchema fields that never arrived.
 *
 * With one tool per action (create/update/delete instead of a `manage_*` enum)
 * `required` is finally expressive enough for this generic check to carry the
 * weight the hand-written guards used to.
 *
 * Checked against `effectiveInputSchema`, never the raw registry schema: what
 * the deployment ANNOUNCED is what the call is judged by. Doing it the other
 * way is how `PLANKA_DEFAULT_BOARD_ID` used to reject `planka_board_summary {}`
 * while its own tools/list entry said `boardId` was optional.
 */
export function findMissingRequiredArgs(
  tool: Tool,
  args: unknown,
  policy: AccessPolicy = getPolicy()
): string[] {
  return missingRequiredArgs(effectiveInputSchema(tool, policy), args);
}

/**
 * Tools kept only so callers written against the old names keep working.
 *
 * Each one routes to the create_/update_/delete_ tool that replaced it and adds
 * nothing else. They are still callable when hidden — a model working from a
 * cached tools/list must get the real behaviour, not "unknown tool".
 *
 * `PLANKA_HIDE_DEPRECATED=true` drops them from tools/list, which is worth a
 * few hundred characters of context per session on a deployment that has
 * already migrated.
 */
export const DEPRECATED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "planka_manage_labels",
  "planka_manage_lists",
  "planka_manage_comment",
  "planka_add_comment",
  // Not an alias, but its own description opens with DEPRECATED: the summary
  // plus find_cards replaced it, and it is the most expensive read here.
  "planka_get_board",
  // Literal aliases: same handler, same properties, and their own descriptions
  // already said "prefer planka_find_cards" / "prefer planka_board_summary".
  // Together they are the two most expensive schemas in tools/list.
  "planka_list_cards",
  "planka_list_lists",
]);

/**
 * With a default board configured, `boardId` stops being mandatory.
 *
 * Done here rather than in each tool file so the individual schemas stay
 * declarative: the tools describe Planka, this describes the deployment.
 * Never mutates the registry — the returned schema is a copy.
 */
function applyDefaultBoard(
  inputSchema: Tool["inputSchema"],
  defaultBoardId: string
): Tool["inputSchema"] {
  const property = inputSchema.properties.boardId as
    | Record<string, unknown>
    | undefined;
  if (!property) return inputSchema;

  const description =
    typeof property.description === "string" ? property.description : "";
  const note = `boardId defaults to PLANKA_DEFAULT_BOARD_ID (${defaultBoardId}) when omitted.`;

  return {
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      boardId: {
        ...property,
        description: description ? `${description} ${note}` : note,
      },
    },
    ...(inputSchema.required
      ? { required: inputSchema.required.filter((field) => field !== "boardId") }
      : {}),
  };
}

/**
 * The schema a tool is actually published — and judged — with.
 *
 * The single source of truth for both sides of the contract: `tools/list`
 * advertises this, and the runtime presence check validates against this.
 */
export function effectiveInputSchema(
  tool: { inputSchema: Tool["inputSchema"] },
  policy: AccessPolicy = getPolicy()
): Tool["inputSchema"] {
  return policy.defaultBoardId
    ? applyDefaultBoard(tool.inputSchema, policy.defaultBoardId)
    : tool.inputSchema;
}

/** A copy of the schema with one property's description replaced. */
function withPropertyDescription(
  schema: Tool["inputSchema"],
  property: string,
  description: string
): Tool["inputSchema"] {
  const properties = (schema.properties ?? {}) as Record<string, object>;
  return {
    ...schema,
    properties: {
      ...properties,
      [property]: { ...properties[property], description },
    },
  };
}

/**
 * Get all tool definitions (for MCP listTools), after the access policy:
 * read-only and disabled tools are not advertised at all.
 */
export function getToolDefinitions(policy: AccessPolicy = getPolicy()) {
  return allTools
    .filter((tool) => isToolVisible(tool.name, policy))
    .filter(
      (tool) =>
        !(policy.hideDeprecated && DEPRECATED_TOOL_NAMES.has(tool.name))
    )
    .map((tool) => {
      // Annotations live in their own map; forgetting to spread them here is how
      // they get silently dropped from tools/list.
      const presentation = toolPresentation[tool.name];
      const inputSchema = effectiveInputSchema(tool, policy);
      // PLANKA_GET_CARD_COMMENTS changes what get_card does when the call does
      // not say; the advertised text has to change with it.
      const getCardComments =
        tool.name === "planka_get_card"
          ? getCardCommentsPresentation(policy)
          : null;
      return {
        name: tool.name,
        ...(presentation ? { title: presentation.title } : {}),
        description: getCardComments?.description ?? tool.description,
        inputSchema: getCardComments
          ? withPropertyDescription(
              inputSchema,
              "withComments",
              getCardComments.withComments
            )
          : inputSchema,
        ...(presentation ? { annotations: presentation.annotations } : {}),
        ...(presentation?._meta ? { _meta: presentation._meta } : {}),
      };
    });
}

// Re-export individual tool groups
export { navigationTools } from "./navigation.js";
export { cardTools } from "./cards.js";
export { taskTools } from "./tasks.js";
export { labelTools } from "./labels.js";
export { commentTools } from "./comments.js";
export { listTools } from "./lists.js";
export { attachmentTools } from "./attachments.js";
export { queryTools } from "./queries.js";
export { activityTools } from "./activity.js";
export { memberTools } from "./members.js";
export { userTools } from "./users.js";
export { cardOpsTools } from "./card-ops.js";
export { missingRequiredArgs } from "./dispatch.js";
export {
  toolPresentation,
  TOOLS_REQUIRING_USER_INTERACTION,
} from "./annotations.js";
export type { ToolBehaviourHints, ToolPresentation } from "./annotations.js";
