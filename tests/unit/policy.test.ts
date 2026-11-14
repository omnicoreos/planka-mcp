import { describe, expect, it } from "vitest";
import {
  AccessPolicy,
  WRITE_TOOL_NAMES,
  assertBoardAllowed,
  assertListWritable,
  assertProjectAllowed,
  getPolicy,
  isToolVisible,
  normalizeToolName,
  parsePolicy,
  resetPolicyCache,
  resolveBoardId,
  toolBlockedReason,
} from "../../src/config/policy.js";
import { allTools, toolPresentation } from "../../src/tools/index.js";

const empty = parsePolicy({});

describe("parsePolicy", () => {
  it("defaults to no policy at all when nothing is configured", () => {
    expect(empty).toEqual({
      defaultBoardId: null,
      allowedBoardIds: null,
      allowedProjectIds: null,
      readOnly: false,
      disabledTools: [],
      hideDeprecated: false,
      protectedListIds: [],
      summaryHighlightLabel: null,
      summaryDecisionLists: null,
      getCardComments: null,
    });
  });

  it("reads the get_card comment default, and refuses a value it cannot use", () => {
    const read = (value: string) =>
      parsePolicy({ PLANKA_GET_CARD_COMMENTS: value }).getCardComments;
    expect(read(" ALL ")).toBe("all");
    expect(read("20")).toBe(20);
    // 0 and blank are the package default, said out loud.
    expect(read("0")).toBeNull();
    expect(read("  ")).toBeNull();
    for (const bad of ["yes", "-1", "2.5", "all,10"]) {
      expect(() => read(bad)).toThrow(/Invalid PLANKA_GET_CARD_COMMENTS/);
    }
  });

  it("reads the board summary vocabulary from the environment", () => {
    const policy = parsePolicy({
      PLANKA_SUMMARY_HIGHLIGHT_LABEL: " decidido ",
      PLANKA_SUMMARY_DECISION_LISTS: "decision, probalo ,,",
    });
    expect(policy.summaryHighlightLabel).toBe("decidido");
    expect(policy.summaryDecisionLists).toEqual(["decision", "probalo"]);
  });

  it("refuses a summary list variable that lists nothing", () => {
    expect(() =>
      parsePolicy({ PLANKA_SUMMARY_DECISION_LISTS: " , " })
    ).toThrow(/PLANKA_SUMMARY_DECISION_LISTS is set but lists no value/);
  });

  it("parses ids as CSV, trimming blanks", () => {
    const policy = parsePolicy({
      PLANKA_ALLOWED_BOARD_IDS: " 111 , 222 ,, ",
      PLANKA_ALLOWED_PROJECT_IDS: "900",
      PLANKA_PROTECTED_LIST_IDS: "l1,l2",
      PLANKA_DEFAULT_BOARD_ID: " 111 ",
    });
    expect(policy.allowedBoardIds).toEqual(["111", "222"]);
    expect(policy.allowedProjectIds).toEqual(["900"]);
    expect(policy.protectedListIds).toEqual(["l1", "l2"]);
    expect(policy.defaultBoardId).toBe("111");
  });

  it("accepts true/1 for PLANKA_READ_ONLY and rejects anything ambiguous", () => {
    expect(parsePolicy({ PLANKA_READ_ONLY: "true" }).readOnly).toBe(true);
    expect(parsePolicy({ PLANKA_READ_ONLY: "1" }).readOnly).toBe(true);
    expect(parsePolicy({ PLANKA_READ_ONLY: "TRUE" }).readOnly).toBe(true);
    expect(parsePolicy({ PLANKA_READ_ONLY: "false" }).readOnly).toBe(false);
    expect(parsePolicy({ PLANKA_READ_ONLY: "0" }).readOnly).toBe(false);
    expect(parsePolicy({ PLANKA_READ_ONLY: "" }).readOnly).toBe(false);
    expect(() => parsePolicy({ PLANKA_READ_ONLY: "yes" })).toThrow(
      /Invalid PLANKA_READ_ONLY/
    );
  });

  it("normalizes disabled tool names with or without the prefix", () => {
    expect(
      parsePolicy({ PLANKA_DISABLED_TOOLS: "get_board, planka_delete_card" })
        .disabledTools
    ).toEqual(["planka_get_board", "planka_delete_card"]);
    expect(normalizeToolName("planka_get_card")).toBe("planka_get_card");
    expect(normalizeToolName(" get_card ")).toBe("planka_get_card");
  });

  it("refuses an allowlist that lists nothing — it would hide everything", () => {
    expect(() => parsePolicy({ PLANKA_ALLOWED_BOARD_IDS: " , " })).toThrow(
      /PLANKA_ALLOWED_BOARD_IDS/
    );
    expect(() => parsePolicy({ PLANKA_ALLOWED_PROJECT_IDS: "" })).toThrow(
      /PLANKA_ALLOWED_PROJECT_IDS/
    );
    expect(() => parsePolicy({ PLANKA_DEFAULT_BOARD_ID: "  " })).toThrow(
      /PLANKA_DEFAULT_BOARD_ID is set but empty/
    );
  });

  it("refuses a default board that the allowlist would reject", () => {
    expect(() =>
      parsePolicy({
        PLANKA_DEFAULT_BOARD_ID: "999",
        PLANKA_ALLOWED_BOARD_IDS: "111,222",
      })
    ).toThrow(/is not listed in PLANKA_ALLOWED_BOARD_IDS/);
  });
});

describe("getPolicy", () => {
  it("memoizes per environment object and can be reset", () => {
    const env = { PLANKA_READ_ONLY: "true" } as NodeJS.ProcessEnv;
    resetPolicyCache();
    const first = getPolicy(env);
    expect(getPolicy(env)).toBe(first);
    env.PLANKA_READ_ONLY = "false";
    expect(getPolicy(env).readOnly).toBe(true); // still cached
    resetPolicyCache();
    expect(getPolicy(env).readOnly).toBe(false);
    resetPolicyCache();
  });
});

describe("assertBoardAllowed / assertProjectAllowed", () => {
  const policy = parsePolicy({
    PLANKA_ALLOWED_BOARD_IDS: "111,222",
    PLANKA_ALLOWED_PROJECT_IDS: "900",
  });

  it("lets an allowed id through", () => {
    expect(assertBoardAllowed("222", policy)).toBe("222");
    expect(assertProjectAllowed("900", policy)).toBe("900");
  });

  it("names the variable and the allowed ids when it refuses", () => {
    expect(() => assertBoardAllowed("333", policy)).toThrow(
      "boardId 333 is not in PLANKA_ALLOWED_BOARD_IDS (allowed: 111, 222)"
    );
    expect(() => assertProjectAllowed("901", policy)).toThrow(
      /projectId 901 is not in PLANKA_ALLOWED_PROJECT_IDS \(allowed: 900\)/
    );
  });

  it("allows everything when no allowlist is configured", () => {
    expect(assertBoardAllowed("anything", empty)).toBe("anything");
    expect(assertProjectAllowed("anything", empty)).toBe("anything");
  });
});

describe("resolveBoardId", () => {
  it("falls back to the default board", () => {
    const policy = parsePolicy({ PLANKA_DEFAULT_BOARD_ID: "111" });
    expect(resolveBoardId(undefined, policy)).toBe("111");
    expect(resolveBoardId("", policy)).toBe("111");
    expect(resolveBoardId("222", policy)).toBe("222");
  });

  it("checks the explicit id against the allowlist", () => {
    const policy = parsePolicy({
      PLANKA_DEFAULT_BOARD_ID: "111",
      PLANKA_ALLOWED_BOARD_IDS: "111",
    });
    expect(() => resolveBoardId("222", policy)).toThrow(
      /not in PLANKA_ALLOWED_BOARD_IDS/
    );
  });

  it("asks for a boardId when there is no default", () => {
    expect(() => resolveBoardId(undefined, empty)).toThrow(
      /PLANKA_DEFAULT_BOARD_ID is not set/
    );
  });
});

describe("isToolVisible / toolBlockedReason", () => {
  it("hides write tools in read-only mode and keeps reads", () => {
    const policy = parsePolicy({ PLANKA_READ_ONLY: "true" });
    expect(isToolVisible("planka_get_card", policy)).toBe(true);
    expect(isToolVisible("planka_create_card", policy)).toBe(false);
    expect(toolBlockedReason("planka_create_card", policy)).toMatch(
      /read-only mode \(PLANKA_READ_ONLY=true\)/
    );
    expect(toolBlockedReason("planka_get_card", policy)).toBeNull();
  });

  it("hides explicitly disabled tools whatever they do", () => {
    const policy = parsePolicy({ PLANKA_DISABLED_TOOLS: "get_board" });
    expect(isToolVisible("planka_get_board", policy)).toBe(false);
    expect(toolBlockedReason("planka_get_board", policy)).toMatch(
      /PLANKA_DISABLED_TOOLS/
    );
    expect(isToolVisible("planka_get_card", policy)).toBe(true);
  });

  it("keeps WRITE_TOOL_NAMES exhaustive against the registry", () => {
    const registered = new Set(allTools.map((t) => t.name));
    for (const name of WRITE_TOOL_NAMES) {
      expect(registered.has(name), `${name} is not a registered tool`).toBe(true);
    }
    // The invariant, not a tautology: membership in WRITE_TOOL_NAMES has to
    // agree, tool by tool, with the readOnlyHint the tool advertises. A new
    // write tool that nobody added to the set now fails HERE instead of
    // quietly staying visible under PLANKA_READ_ONLY=true.
    for (const tool of allTools) {
      const presentation = toolPresentation[tool.name];
      expect(presentation, `${tool.name} has no annotations`).toBeDefined();
      expect(WRITE_TOOL_NAMES.has(tool.name), tool.name).toBe(
        !presentation.annotations.readOnlyHint
      );
    }
    expect(WRITE_TOOL_NAMES.size).toBe(27);
  });
});

describe("assertListWritable", () => {
  const policy: AccessPolicy = parsePolicy({
    PLANKA_PROTECTED_LIST_IDS: "l-merged,l-shipped",
  });

  it("passes through unprotected lists and undefined", () => {
    expect(() => assertListWritable("l-other", policy)).not.toThrow();
    expect(() => assertListWritable(undefined, policy)).not.toThrow();
    expect(() => assertListWritable("l-merged", empty)).not.toThrow();
  });

  it("refuses a protected list and says what it refused", () => {
    expect(() => assertListWritable("l-merged", policy, "move cards into")).toThrow(
      /list l-merged is protected by PLANKA_PROTECTED_LIST_IDS: this server may not move cards into it/
    );
  });
});
