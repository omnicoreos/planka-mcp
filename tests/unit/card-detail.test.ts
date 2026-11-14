/**
 * get_card as a digest, and comments only when asked for.
 *
 * Everything runs through the tool handler against a mocked client: what is
 * asserted is exactly the JSON an agent would read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../src/client.js", () => ({
  plankaClient: { get: mocks.get },
}));

import { getCardTool } from "../../src/tools/cards.js";
import { getCommentsTool } from "../../src/tools/comments.js";
import {
  getComments,
  COMMENTS_PAGE_SIZE,
} from "../../src/operations/comments.js";
import { clearBoardNamesCache } from "../../src/operations/cards.js";
import { parsePolicy, resetPolicyCache } from "../../src/config/policy.js";
import { getToolDefinitions } from "../../src/tools/index.js";
import {
  SERVER_INSTRUCTIONS,
  buildServerInstructions,
} from "../../src/instructions.js";

const ts = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null };
const LONG_DESCRIPTION = "x".repeat(900);

const card = {
  id: "card-1",
  boardId: "board-1",
  listId: "list-1",
  name: "Card",
  description: LONG_DESCRIPTION,
  type: "project",
  position: 65536,
  dueDate: "2026-03-01T12:00:00.000Z",
  isDueCompleted: false,
  isClosed: false,
  commentsTotal: 3,
  stopwatch: { startedAt: null, total: 0 },
  ...ts,
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const included = {
  taskLists: [
    { id: "tl-1", cardId: "card-1", name: "Backend", position: 1, ...ts },
    { id: "tl-2", cardId: "card-1", name: "QA", position: 2, ...ts },
  ],
  tasks: [
    { id: "t-1", taskListId: "tl-1", name: "endpoint", position: 1, isCompleted: true, ...ts },
    { id: "t-2", taskListId: "tl-1", name: "tests", position: 2, isCompleted: true, ...ts },
    { id: "t-3", taskListId: "tl-2", name: "smoke", position: 1, isCompleted: false, ...ts },
  ],
  cardLabels: [
    { id: "cl-1", cardId: "card-1", labelId: "label-1", ...ts },
    { id: "cl-2", cardId: "card-1", labelId: "label-2", ...ts },
  ],
  cardMemberships: [{ id: "cm-1", cardId: "card-1", userId: "user-1" }],
  users: [{ id: "user-1", name: "Agent User", ...ts }],
  attachments: [
    { id: "att-1", cardId: "card-1", name: "shot.png", type: "file", data: { size: 1024, mimeType: "image/png" }, ...ts },
  ],
  customFields: [{ id: "cf-1", name: "Environment" }],
  customFieldValues: [
    { id: "cfv-1", cardId: "card-1", customFieldId: "cf-1", content: "prod" },
  ],
};

const boardBody = {
  item: { id: "board-1", projectId: "p-1", name: "Web", position: 1, ...ts },
  included: {
    lists: [{ id: "list-1", boardId: "board-1", name: "🔨 En worktree", position: 300, type: "active", ...ts }],
    labels: [
      { id: "label-1", boardId: "board-1", name: "decidido", color: "berry-red", position: 1, ...ts },
      { id: "label-2", boardId: "board-1", name: "zona:i18n", color: "navy-blue", position: 2, ...ts },
    ],
  },
};

const comment = (n: number) => ({
  id: `comment-${String(n).padStart(3, "0")}`,
  cardId: "card-1",
  userId: "user-1",
  text: `comment ${n}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  updatedAt: null,
});

/** Comments newest-first, the way Planka serves them (id DESC). */
function commentsBody(from: number, count: number) {
  const items = Array.from({ length: count }, (_, i) => comment(from - i));
  return { items, included: { users: included.users } };
}

function routeGet(comments: (path: string) => unknown = () => commentsBody(3, 3)) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/cards/card-1/comments")) return comments(path);
    if (path === "/api/cards/card-1") return { item: card, included };
    if (path === "/api/boards/board-1") return boardBody;
    throw new Error(`unexpected GET ${path}`);
  });
}

function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  mocks.get.mockReset();
  clearBoardNamesCache();
});

describe("get_card digest", () => {
  it("returns counts, names and a description preview — and no comments", async () => {
    routeGet();
    const body = payload(await getCardTool.handler({ cardId: "card-1" }));

    expect(body.detail).toBe("digest");
    expect(body.card.listName).toBe("🔨 En worktree");
    expect(body.card.descriptionPreview).toHaveLength(200);
    expect(body.card.descriptionChars).toBe(LONG_DESCRIPTION.length);
    expect(body.card.descriptionTruncated).toBe(true);
    expect(body.card.description).toBeUndefined();
    expect(body.card.isDueCompleted).toBe(false);
    expect(body.card.isClosed).toBe(false);
    expect(body.card.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(body.labels).toEqual([
      { id: "label-1", name: "decidido" },
      { id: "label-2", name: "zona:i18n" },
    ]);
    expect(body.members).toEqual([{ id: "user-1", name: "Agent User" }]);
    expect(body.attachmentsCount).toBe(1);
    expect(body.attachments).toBeUndefined();
    expect(body.commentsTotal).toBe(3);
    expect(Array.isArray(body.comments)).toBe(false);
    expect(String(body.comments)).toMatch(/withComments/);

    // The point of the default: not one byte of comment traffic.
    const paths = mocks.get.mock.calls.map((c) => c[0]);
    expect(paths.some((p: string) => p.includes("/comments"))).toBe(false);
  });

  it("keeps checklists apart instead of flattening them", async () => {
    routeGet();
    const body = payload(await getCardTool.handler({ cardId: "card-1" }));

    expect(body.tasks).toMatchObject({ done: 2, total: 3 });
    expect(body.tasks.lists).toEqual([
      { id: "tl-1", name: "Backend", done: 2, total: 2 },
      { id: "tl-2", name: "QA", done: 0, total: 1 },
    ]);
    // No item-by-item detail in the digest.
    expect(body.tasks.lists[0].items).toBeUndefined();
  });

  it("honours descriptionChars", async () => {
    routeGet();
    const body = payload(
      await getCardTool.handler({ cardId: "card-1", descriptionChars: 10 })
    );
    expect(body.card.descriptionPreview).toHaveLength(10);
  });

  it("survives a board it cannot read, minus the names", async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/cards/card-1") return { item: card, included };
      throw new Error("board unreadable");
    });

    const body = payload(await getCardTool.handler({ cardId: "card-1" }));
    // null, not absent: "the board could not be read" and "the card has no
    // column" must not look the same.
    expect(body.card.listName).toBeNull();
    expect(body.card.listNameUnavailable).toMatch(/board could not be read/);
    expect(body.labels).toEqual([
      { id: "label-1", name: null },
      { id: "label-2", name: null },
    ]);
  });
});

describe("get_card full detail", () => {
  it("adds the whole description, task items, attachments and custom fields", async () => {
    routeGet();
    const body = payload(
      await getCardTool.handler({ cardId: "card-1", detail: "full" })
    );

    expect(body.detail).toBe("full");
    expect(body.card.description).toBe(LONG_DESCRIPTION);
    expect(body.card.descriptionPreview).toBeUndefined();
    expect(body.tasks.lists[0].items).toEqual([
      { id: "t-1", name: "endpoint", isCompleted: true },
      { id: "t-2", name: "tests", isCompleted: true },
    ]);
    expect(body.attachments).toEqual([
      {
        id: "att-1",
        name: "shot.png",
        type: "file",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    ]);
    expect(body.customFields).toEqual([
      { name: "Environment", content: "prod" },
    ]);
    expect(body.more).toBeUndefined();
  });
});

describe("get_card withComments", () => {
  it("returns the N most recent, oldest first", async () => {
    routeGet(() => commentsBody(3, 3));
    const body = payload(
      await getCardTool.handler({ cardId: "card-1", withComments: 2 })
    );

    expect(body.commentsReturned).toBe(2);
    expect(body.commentsOrder).toBe("oldest-first");
    // Newest two (2 and 3), handed back in reading order.
    expect(body.comments.map((c: { text: string }) => c.text)).toEqual([
      "comment 2",
      "comment 3",
    ]);
    expect(body.comments[0].author).toBe("Agent User");
    expect(body.commentsHasMore).toBe(true);
  });

  it('pages every comment with beforeId when withComments is "all"', async () => {
    const seen: string[] = [];
    routeGet((path) => {
      seen.push(path);
      // Page 1: a full page (ids 52..3). Page 2: the last two.
      return path.includes("beforeId")
        ? commentsBody(2, 2)
        : commentsBody(COMMENTS_PAGE_SIZE + 2, COMMENTS_PAGE_SIZE);
    });

    const body = payload(
      await getCardTool.handler({ cardId: "card-1", withComments: "all" })
    );

    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("beforeId=comment-003");
    expect(body.commentsReturned).toBe(COMMENTS_PAGE_SIZE + 2);
    expect(body.comments[0].text).toBe("comment 1");
    expect(body.commentsTruncated).toBeUndefined();
  });
});

describe("comment paging", () => {
  it("stops at the page ceiling and says so", async () => {
    routeGet(() => commentsBody(COMMENTS_PAGE_SIZE, COMMENTS_PAGE_SIZE));

    const result = await getComments({
      cardId: "card-1",
      all: true,
      maxPages: 2,
    });

    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextBeforeId).toBeDefined();
  });

  it("slices a page to the limit and hands back a usable cursor", async () => {
    routeGet(() => commentsBody(10, 10));

    const result = await getComments({ cardId: "card-1", limit: 4 });
    expect(result.comments).toHaveLength(4);
    expect(result.hasMore).toBe(true);
    // Oldest of the four returned: the next page continues from there.
    expect(result.nextBeforeId).toBe("comment-007");
    expect(result.comments[0].text).toBe("comment 7");
  });

  it("does not claim more when the page came back short", async () => {
    routeGet(() => commentsBody(3, 3));
    const result = await getComments({ cardId: "card-1", limit: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.nextBeforeId).toBeUndefined();
  });
});

describe("get_comments tool", () => {
  it("defaults to 20, oldest first, and exposes the cursor", async () => {
    routeGet((path) => {
      expect(path).toBe("/api/cards/card-1/comments");
      return commentsBody(30, 30);
    });

    const body = payload(await getCommentsTool.handler({ cardId: "card-1" }));
    expect(body.commentCount).toBe(20);
    expect(body.order).toBe("asc");
    expect(body.hasMore).toBe(true);
    expect(body.nextBeforeId).toBe("comment-011");
    expect(body.comments[0].text).toBe("comment 11");
  });

  it("forwards beforeId to Planka", async () => {
    routeGet((path) => {
      expect(path).toContain("beforeId=comment-011");
      return commentsBody(10, 10);
    });

    const body = payload(
      await getCommentsTool.handler({
        cardId: "card-1",
        beforeId: "comment-011",
        limit: 5,
        order: "desc",
      })
    );
    expect(body.commentCount).toBe(5);
    expect(body.order).toBe("desc");
    expect(body.comments[0].text).toBe("comment 10");
  });

  it("reports truncation instead of pretending it read everything", async () => {
    routeGet(() => commentsBody(COMMENTS_PAGE_SIZE, COMMENTS_PAGE_SIZE));

    const body = payload(
      await getCommentsTool.handler({ cardId: "card-1", all: true })
    );
    expect(body.truncated).toBe(true);
    expect(body.truncatedReason).toMatch(/beforeId/);
    expect(body.hasMore).toBe(true);
  });
});

describe("PLANKA_GET_CARD_COMMENTS", () => {
  const withEnv = async (value: string, run: () => Promise<void>) => {
    process.env.PLANKA_GET_CARD_COMMENTS = value;
    resetPolicyCache();
    try {
      await run();
    } finally {
      delete process.env.PLANKA_GET_CARD_COMMENTS;
      resetPolicyCache();
    }
  };
  const commentPaths = () =>
    mocks.get.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => p.includes("/comments"));

  it("returns every comment when the call does not pass withComments", async () => {
    routeGet();
    await withEnv("all", async () => {
      const body = payload(await getCardTool.handler({ cardId: "card-1" }));
      expect(body.detail).toBe("digest");
      expect(body.comments.map((c: { text: string }) => c.text)).toEqual([
        "comment 1",
        "comment 2",
        "comment 3",
      ]);
      expect(body.commentsReturned).toBe(3);
    });
  });

  it("returns the N most recent comments when set to a number", async () => {
    routeGet();
    await withEnv("2", async () => {
      const body = payload(await getCardTool.handler({ cardId: "card-1" }));
      expect(body.commentsReturned).toBe(2);
      expect(body.comments.map((c: { text: string }) => c.text)).toEqual([
        "comment 2",
        "comment 3",
      ]);
    });
  });

  it("lets an explicit withComments win, 0 included", async () => {
    routeGet();
    await withEnv("all", async () => {
      const none = payload(
        await getCardTool.handler({ cardId: "card-1", withComments: 0 })
      );
      expect(Array.isArray(none.comments)).toBe(false);
      expect(commentPaths()).toHaveLength(0);

      routeGet(() => commentsBody(3, 1));
      const one = payload(
        await getCardTool.handler({ cardId: "card-1", withComments: 1 })
      );
      expect(one.commentsReturned).toBe(1);
    });
  });

  it("changes nothing when unset", async () => {
    routeGet();
    resetPolicyCache();
    const body = payload(await getCardTool.handler({ cardId: "card-1" }));
    expect(Array.isArray(body.comments)).toBe(false);
    expect(commentPaths()).toHaveLength(0);
  });

  it("advertises the configured default instead of 'NOT included'", () => {
    const describe_ = (env: NodeJS.ProcessEnv) => {
      const tool = getToolDefinitions(parsePolicy(env)).find(
        (t) => t.name === "planka_get_card"
      )!;
      const props = tool.inputSchema.properties as Record<
        string,
        { description?: string; anyOf?: unknown }
      >;
      return { description: tool.description, withComments: props.withComments };
    };

    const unset = describe_({});
    expect(unset.description).toBe(getCardTool.description);
    expect(unset.description).toMatch(/NOT included by default/);

    const all = describe_({ PLANKA_GET_CARD_COMMENTS: "all" });
    expect(all.description).not.toMatch(/NOT included/);
    expect(all.description).toMatch(/ALL comments are included by default/);
    expect(all.withComments.description).toMatch(/Default on this server: "all"/);
    // Only the text changes: the accepted values are the same.
    expect(all.withComments.anyOf).toEqual(unset.withComments.anyOf);

    const five = describe_({ PLANKA_GET_CARD_COMMENTS: "5" });
    expect(five.description).toMatch(/the 5 most recent comments are included/);
  });

  it("rewrites the instructions only when set", () => {
    expect(buildServerInstructions(null)).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(/NO comments unless asked/);

    const all = buildServerInstructions("all");
    expect(all).not.toMatch(/NO comments unless asked/);
    expect(all).toMatch(/already returns ALL comments by default/);
    expect(all.length).toBeLessThanOrEqual(2500);

    const five = buildServerInstructions(5);
    expect(five).not.toMatch(/NO comments unless asked/);
    expect(five).toMatch(/only the 5 most recent comments by default/);
    expect(five.length).toBeLessThanOrEqual(2500);
  });
});
