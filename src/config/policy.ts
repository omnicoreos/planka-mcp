/**
 * Access policy: what this MCP server is allowed to see and touch.
 *
 * Layer 2 of the three-layer defence documented in the README. Layer 1 is
 * Planka itself (a `boardUser` with board memberships — the only layer an
 * agent cannot talk its way around); layer 3 is the client's own allow/deny
 * list. This module is the middle one: it travels with the package, so it
 * reaches every runtime (Claude Code, Codex, Cursor…) with the same rules.
 *
 * Everything here is driven by environment variables and every helper is
 * pure, so the whole surface is testable without a Planka.
 */
import { PlankaConfigError, PlankaError } from "../errors.js";

export interface AccessPolicy {
  /** Board used when a tool call omits `boardId`. `null` = no default. */
  defaultBoardId: string | null;
  /** Allowlist of board ids. `null` = no allowlist (everything visible). */
  allowedBoardIds: string[] | null;
  /** Allowlist of project ids. `null` = no allowlist. */
  allowedProjectIds: string[] | null;
  /** Hide (and refuse) every write tool. */
  readOnly: boolean;
  /** Tool names switched off by configuration. */
  disabledTools: string[];
  /** Drop deprecated tools (old names kept as aliases) from `tools/list`. */
  hideDeprecated: boolean;
  /**
   * Lists that must not receive cards, be edited or deleted — and whose cards
   * may not be moved, archived or deleted out of them either.
   */
  protectedListIds: string[];
  /**
   * Label that `planka_board_summary` flags as "unblocked". `null` = none: the
   * server ships no board-specific vocabulary of its own.
   */
  summaryHighlightLabel: string | null;
  /**
   * Columns `planka_board_summary` returns cards from when the call does not
   * say. `null` = none: the summary answers columns and labels only.
   */
  summaryDecisionLists: string[] | null;
  /**
   * What `planka_get_card` reads when the call does not pass `withComments`:
   * a number for the N most recent comments, `"all"` for every one. `null` =
   * none, the package default. An explicit `withComments` always wins.
   */
  getCardComments: number | "all" | null;
}

/**
 * The tools that write to Planka, by name and on purpose.
 *
 * A heuristic over the name ("does it start with get_?") would silently
 * misclassify the next tool someone adds. This set is the contract:
 * `tests/unit/policy.test.ts` asserts, tool by tool, that membership here
 * matches the `readOnlyHint` each tool advertises in `toolPresentation` — so a
 * write tool that nobody listed here fails the suite instead of staying
 * visible under `PLANKA_READ_ONLY=true`.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "planka_create_card",
  "planka_update_card",
  "planka_move_card",
  "planka_delete_card",
  "planka_create_tasks",
  "planka_update_task",
  "planka_delete_task",
  "planka_create_label",
  "planka_update_label",
  "planka_delete_label",
  "planka_manage_labels",
  "planka_set_card_labels",
  "planka_create_comment",
  "planka_update_comment",
  "planka_delete_comment",
  "planka_add_comment",
  "planka_manage_comment",
  "planka_create_list",
  "planka_update_list",
  "planka_delete_list",
  "planka_manage_lists",
  "planka_add_attachment",
  "planka_delete_attachment",
  "planka_set_card_members",
  "planka_duplicate_card",
  "planka_archive_card",
  "planka_move_list_cards",
]);

/** Tool names are always prefixed; accept the bare name as a convenience. */
export function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("planka_") ? trimmed : `planka_${trimmed}`;
}

/** Splits a CSV env var into trimmed, non-empty entries. */
function parseCsv(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries;
}

/** A trimmed string env var, or null when unset/blank. */
function parseOptionalString(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/** A CSV env var that, when present, must list at least one entry. */
function parseNonEmptyCsv(
  name: string,
  raw: string | undefined
): string[] | null {
  const entries = parseCsv(raw);
  if (entries === null) return null;
  if (entries.length === 0) {
    throw new PlankaConfigError(
      `${name} is set but lists no value. Remove it, or list the entries (comma-separated).`
    );
  }
  return entries;
}

/**
 * PLANKA_GET_CARD_COMMENTS: "all" or a whole number. Unset, blank and 0 all
 * mean "no comments unless asked", so they collapse to null.
 */
function parseGetCardComments(raw: string | undefined): number | "all" | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value === "all") return "all";
  if (/^\d+$/.test(value)) {
    const count = Number.parseInt(value, 10);
    return count > 0 ? count : null;
  }
  throw new PlankaConfigError(
    `Invalid PLANKA_GET_CARD_COMMENTS: "${raw}". Use "all" or a whole number of comments (0 or unset = none).`
  );
}

const TRUTHY = new Set(["true", "1"]);
const FALSY = new Set(["false", "0", ""]);

function parseBoolean(name: string, raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  throw new PlankaConfigError(
    `Invalid ${name}: "${raw}". Use "true" or "1" to enable it, "false" or "0" to disable it.`
  );
}

/**
 * Builds the policy from an environment. Pure: no caching, no process.env.
 */
export function parsePolicy(env: NodeJS.ProcessEnv): AccessPolicy {
  const defaultBoardIdRaw = env.PLANKA_DEFAULT_BOARD_ID?.trim();
  if (defaultBoardIdRaw !== undefined && defaultBoardIdRaw.length === 0) {
    throw new PlankaConfigError(
      "PLANKA_DEFAULT_BOARD_ID is set but empty. Remove it, or give it a board id."
    );
  }

  const allowedBoardIds = parseCsv(env.PLANKA_ALLOWED_BOARD_IDS);
  const allowedProjectIds = parseCsv(env.PLANKA_ALLOWED_PROJECT_IDS);

  if (allowedBoardIds !== null && allowedBoardIds.length === 0) {
    throw new PlankaConfigError(
      "PLANKA_ALLOWED_BOARD_IDS is set but lists no id. That would hide every board. " +
        "Remove the variable, or list the board ids (comma-separated)."
    );
  }
  if (allowedProjectIds !== null && allowedProjectIds.length === 0) {
    throw new PlankaConfigError(
      "PLANKA_ALLOWED_PROJECT_IDS is set but lists no id. That would hide every project. " +
        "Remove the variable, or list the project ids (comma-separated)."
    );
  }

  const defaultBoardId = defaultBoardIdRaw ?? null;
  if (
    defaultBoardId !== null &&
    allowedBoardIds !== null &&
    !allowedBoardIds.includes(defaultBoardId)
  ) {
    throw new PlankaConfigError(
      `PLANKA_DEFAULT_BOARD_ID (${defaultBoardId}) is not listed in PLANKA_ALLOWED_BOARD_IDS ` +
        `(${allowedBoardIds.join(", ")}). Add it to the allowlist, or point the default at an allowed board.`
    );
  }

  return {
    defaultBoardId,
    allowedBoardIds,
    allowedProjectIds,
    readOnly: parseBoolean("PLANKA_READ_ONLY", env.PLANKA_READ_ONLY),
    disabledTools: (parseCsv(env.PLANKA_DISABLED_TOOLS) ?? []).map(
      normalizeToolName
    ),
    hideDeprecated: parseBoolean(
      "PLANKA_HIDE_DEPRECATED",
      env.PLANKA_HIDE_DEPRECATED
    ),
    protectedListIds: parseCsv(env.PLANKA_PROTECTED_LIST_IDS) ?? [],
    summaryHighlightLabel: parseOptionalString(
      env.PLANKA_SUMMARY_HIGHLIGHT_LABEL
    ),
    summaryDecisionLists: parseNonEmptyCsv(
      "PLANKA_SUMMARY_DECISION_LISTS",
      env.PLANKA_SUMMARY_DECISION_LISTS
    ),
    getCardComments: parseGetCardComments(env.PLANKA_GET_CARD_COMMENTS),
  };
}

let cachedPolicy: AccessPolicy | null = null;
let cachedEnv: NodeJS.ProcessEnv | null = null;

/**
 * The active policy. Memoized per environment object so a tool call does not
 * re-parse on every request, and so tests can hand in their own env.
 */
export function getPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  if (cachedPolicy && cachedEnv === env) return cachedPolicy;
  const policy = parsePolicy(env);
  cachedPolicy = policy;
  cachedEnv = env;
  return policy;
}

/** Drops the memoized policy. For tests, and for anything that mutates env. */
export function resetPolicyCache(): void {
  cachedPolicy = null;
  cachedEnv = null;
}

/**
 * Rejects a board that is outside the allowlist, before any request goes out.
 */
export function assertBoardAllowed(
  boardId: string,
  policy: AccessPolicy = getPolicy()
): string {
  const allowed = policy.allowedBoardIds;
  if (allowed === null || allowed.includes(boardId)) return boardId;
  throw new PlankaError(
    `boardId ${boardId} is not in PLANKA_ALLOWED_BOARD_IDS (allowed: ${allowed.join(", ")})`,
    "BOARD_NOT_ALLOWED",
    403
  );
}

/** Same check for projects. */
export function assertProjectAllowed(
  projectId: string,
  policy: AccessPolicy = getPolicy()
): string {
  const allowed = policy.allowedProjectIds;
  if (allowed === null || allowed.includes(projectId)) return projectId;
  throw new PlankaError(
    `projectId ${projectId} is not in PLANKA_ALLOWED_PROJECT_IDS (allowed: ${allowed.join(", ")})`,
    "PROJECT_NOT_ALLOWED",
    403
  );
}

/** True when the id survives the board allowlist. */
export function isBoardAllowed(
  boardId: string,
  policy: AccessPolicy = getPolicy()
): boolean {
  return policy.allowedBoardIds === null || policy.allowedBoardIds.includes(boardId);
}

/** True when the id survives the project allowlist. */
export function isProjectAllowed(
  projectId: string,
  policy: AccessPolicy = getPolicy()
): boolean {
  return (
    policy.allowedProjectIds === null ||
    policy.allowedProjectIds.includes(projectId)
  );
}

/**
 * Fills in `PLANKA_DEFAULT_BOARD_ID` for a missing `boardId` and checks the
 * result against the allowlist. Throws when there is neither an argument nor
 * a default.
 */
export function resolveBoardId(
  boardId: string | undefined | null,
  policy: AccessPolicy = getPolicy()
): string {
  const explicit = typeof boardId === "string" ? boardId.trim() : "";
  if (explicit.length > 0) return assertBoardAllowed(explicit, policy);

  if (policy.defaultBoardId) {
    return assertBoardAllowed(policy.defaultBoardId, policy);
  }

  throw new PlankaError(
    "boardId is required: no boardId was given and PLANKA_DEFAULT_BOARD_ID is not set. " +
      "Pass boardId explicitly, or call planka_get_structure to find one.",
    "MISSING_BOARD_ID",
    400
  );
}

/** Whether a tool is exposed at all under the current policy. */
export function isToolVisible(
  name: string,
  policy: AccessPolicy = getPolicy()
): boolean {
  if (policy.disabledTools.includes(name)) return false;
  if (policy.readOnly && WRITE_TOOL_NAMES.has(name)) return false;
  return true;
}

/**
 * Why a tool is not available — the text the model gets back when it calls one
 * anyway. Returns null when the tool is available.
 */
export function toolBlockedReason(
  name: string,
  policy: AccessPolicy = getPolicy()
): string | null {
  if (policy.disabledTools.includes(name)) {
    return (
      `Tool ${name} is disabled by this server's configuration (PLANKA_DISABLED_TOOLS). ` +
      `Do not retry it; use another tool or ask the operator to re-enable it.`
    );
  }
  if (policy.readOnly && WRITE_TOOL_NAMES.has(name)) {
    return (
      `Tool ${name} writes to Planka and this server runs in read-only mode (PLANKA_READ_ONLY=true). ` +
      `Do not retry it; report the change you wanted to make instead of attempting it.`
    );
  }
  return null;
}

/**
 * Guard-rail (not security — Planka has no per-list permissions) that keeps
 * cards out of protected columns and protected columns intact.
 */
export function assertListWritable(
  listId: string | undefined | null,
  policy: AccessPolicy = getPolicy(),
  action = "write to"
): void {
  if (!listId) return;
  if (!policy.protectedListIds.includes(listId)) return;
  throw new PlankaError(
    `list ${listId} is protected by PLANKA_PROTECTED_LIST_IDS: this server may not ${action} it ` +
      `(protected: ${policy.protectedListIds.join(", ")}). Ask a human to do it.`,
    "LIST_PROTECTED",
    403
  );
}
