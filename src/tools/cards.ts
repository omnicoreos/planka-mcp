/**
 * Card tools for PLANKA MCP server.
 *
 * Every write here re-reads the card and reports what LANDED — never what was
 * asked for. See src/operations/verify.ts.
 */
import {
  createCard,
  getCardLight,
  getBoardNames,
  updateCard,
  moveCard,
  deleteCard,
} from "../operations/cards.js";
import { getComments, COMMENTS_PAGE_SIZE } from "../operations/comments.js";
import { CardLightDetails } from "../operations/cards.js";
import { UpdateCardParamsInput } from "../schemas/requests.js";
import { createTasks } from "../operations/tasks.js";
import { addLabelToCard } from "../operations/labels.js";
import {
  goneOn404,
  nothingToDo,
  verifiedDelete,
  verifiedWrite,
  writeResult,
} from "../operations/verify.js";
import { PlankaError } from "../errors.js";
import {
  AccessPolicy,
  assertListWritable,
  getPolicy,
} from "../config/policy.js";

/**
 * PLANKA_PROTECTED_LIST_IDS has to protect a column's CONTENT, not just the
 * column: emptying it card by card (move, archive, delete) was the way around
 * it. Costs one extra read, and only on deployments that configured the
 * variable — with no protected list there is nothing to check.
 */
async function assertCardsListWritable(cardId: string, action: string) {
  if (getPolicy().protectedListIds.length === 0) return;
  const before = await getCardLight({ cardId });
  assertListWritable(before.card.listId, undefined, action);
}

/** Two date values are the same instant (or both empty). */
function sameDate(a: string | null | undefined, b: string | null | undefined) {
  const na = a ?? null;
  const nb = b ?? null;
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  const ta = Date.parse(na);
  const tb = Date.parse(nb);
  return Number.isNaN(ta) || Number.isNaN(tb) ? na === nb : ta === tb;
}

/**
 * Tool: planka_create_card
 * Create a new card on a board.
 */
export const createCardTool = {
  name: "planka_create_card",
  description:
    "Create a card in a list, optionally with a checklist of tasks.",
  inputSchema: {
    type: "object" as const,
    properties: {
      listId: {
        type: "string",
        description: "The list to create the card in",
      },
      name: {
        type: "string",
        description: "Card title",
      },
      description: {
        type: "string",
        description: "Card description (markdown supported)",
      },
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Optional: Task names to add as a checklist",
      },
      dueDate: {
        type: "string",
        description: "Due date in ISO format",
      },
      labelIds: {
        type: "array",
        items: { type: "string" },
        description: "Optional: Label IDs to attach",
      },
    },
    required: ["listId", "name"],
  },
  handler: async (params: {
    listId: string;
    name: string;
    description?: string;
    tasks?: string[];
    dueDate?: string;
    labelIds?: string[];
  }) => {
    try {
      const requestedTasks = params.tasks ?? [];
      const requestedLabels = params.labelIds ?? [];

      // 1. Create the card and prove it exists.
      const created = await verifiedWrite({
        write: () =>
          createCard({
            listId: params.listId,
            name: params.name,
            description: params.description,
            dueDate: params.dueDate,
          }),
        reread: (card) => getCardLight({ cardId: card.id }),
        // The re-read is by id, so comparing ids alone is true by construction.
        // What has to hold is what the CALL asked for: name and column.
        landed: (after, card) =>
          after.card.id === card.id &&
          after.card.name === params.name &&
          after.card.listId === params.listId,
      });
      const card = created.result;

      const partialFailure: Record<string, unknown> = {};

      // 2. Tasks. A failure here must never cost the caller the card id.
      if (requestedTasks.length > 0) {
        try {
          await createTasks({
            cardId: card.id,
            tasks: requestedTasks.map((name) => ({ name })),
          });
        } catch (error) {
          partialFailure.tasks =
            error instanceof Error ? error.message : String(error);
        }
      }

      // 3. Labels, one by one: a bad labelId is a 404 that must not sink the rest.
      const labelErrors: Array<{ labelId: string; reason: string }> = [];
      for (const labelId of requestedLabels) {
        try {
          await addLabelToCard({ cardId: card.id, labelId });
        } catch (error) {
          // A bad labelId and a 403 on the board are indistinguishable without
          // the reason — and they need opposite reactions from the caller.
          labelErrors.push({
            labelId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 4. Read the card once more and report REALITY.
      let after = created.after;
      let readError = created.verificationError;
      if (requestedTasks.length > 0 || requestedLabels.length > 0) {
        try {
          after = await getCardLight({ cardId: card.id });
          readError = undefined;
        } catch (error) {
          readError = `the card was created but could not be re-read: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }

      const tasksOnCard = after
        ? requestedTasks.filter((name) =>
            after!.tasks.some((t) => t.name === name)
          ).length
        : 0;
      const finalLabelIds = after
        ? after.cardLabels.map((cl) => cl.labelId)
        : [];
      const labelsAttached = after
        ? requestedLabels.filter((id) => finalLabelIds.includes(id)).length
        : 0;

      if (labelErrors.length > 0) partialFailure.labelIds = labelErrors;
      if (after && tasksOnCard < requestedTasks.length) {
        partialFailure.tasksMissing = requestedTasks.filter(
          (name) => !after!.tasks.some((t) => t.name === name)
        );
      }

      const allLabelsFailed =
        requestedLabels.length > 0 && labelsAttached === 0;
      const ok =
        created.verified &&
        !readError &&
        Object.keys(partialFailure).length === 0 &&
        !allLabelsFailed;

      const body = {
        success: ok,
        verified: created.verified && !readError,
        ...(readError ? { verificationError: readError } : {}),
        card: {
          id: card.id,
          name: after?.card.name ?? card.name,
          listId: after?.card.listId ?? card.listId,
        },
        tasksRequested: requestedTasks.length,
        tasksCreated: tasksOnCard,
        labelsRequested: requestedLabels.length,
        labelsAttached,
        ...(after ? { finalLabelIds } : {}),
        ...(Object.keys(partialFailure).length > 0 ? { partialFailure } : {}),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(body) }],
        ...(ok ? {} : { isError: true as const }),
      };
    } catch (error) {
      if (error instanceof PlankaError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  },
};

/** Default size of the description preview in the digest. */
const DEFAULT_DESCRIPTION_CHARS = 200;

/** Ceiling for `descriptionChars`: past this, ask for detail: "full". */
const MAX_DESCRIPTION_CHARS = 2000;

/**
 * Card labels resolved to names, keeping the ids the write tools need.
 *
 * The card response carries only the cardId<->labelId pairs; the names come
 * from the board (see getBoardNames), so `names` may legitimately be missing.
 */
function labelsOf(
  details: CardLightDetails,
  names: Map<string, string | null> | undefined
) {
  return details.cardLabels.map((cl) => ({
    id: cl.labelId,
    name:
      names?.get(cl.labelId) ??
      details.labels.find((l) => l.id === cl.labelId)?.name ??
      null,
  }));
}

/** Assignees, from cardMemberships joined with the included users. */
function membersOf(details: CardLightDetails) {
  return details.cardMemberships.map((m) => ({
    id: m.userId,
    name: details.users.find((u) => u.id === m.userId)?.name ?? null,
  }));
}

/**
 * Tasks grouped by their checklist — never flattened.
 *
 * A card with "Backend 3/3" and "QA 0/4" says something a flat 3/7 does not,
 * and Planka 2.x models exactly that (taskLists -> tasks by taskListId).
 */
function tasksOf(details: CardLightDetails, withItems: boolean) {
  const lists = details.taskLists.map((tl) => {
    const items = details.tasks.filter((t) => t.taskListId === tl.id);
    return {
      id: tl.id,
      name: tl.name,
      done: items.filter((t) => t.isCompleted).length,
      total: items.length,
      ...(withItems
        ? {
            items: items.map((t) => ({
              id: t.id,
              name: t.name,
              isCompleted: t.isCompleted,
              ...(t.assigneeUserId
                ? {
                    assignee:
                      details.users.find((u) => u.id === t.assigneeUserId)
                        ?.name ?? t.assigneeUserId,
                  }
                : {}),
            })),
          }
        : {}),
    };
  });

  // Tasks whose checklist did not come back must not vanish from the count.
  const known = new Set(details.taskLists.map((tl) => tl.id));
  const orphans = details.tasks.filter((t) => !known.has(t.taskListId));
  if (orphans.length > 0) {
    lists.push({
      id: null as unknown as string,
      name: "(ungrouped)",
      done: orphans.filter((t) => t.isCompleted).length,
      total: orphans.length,
      ...(withItems
        ? {
            items: orphans.map((t) => ({
              id: t.id,
              name: t.name,
              isCompleted: t.isCompleted,
            })),
          }
        : {}),
    });
  }

  return {
    done: details.tasks.filter((t) => t.isCompleted).length,
    total: details.tasks.length,
    lists,
  };
}

/** Custom field values resolved to their field name (full detail only). */
function customFieldsOf(details: CardLightDetails) {
  return details.customFieldValues.map((v) => ({
    name:
      details.customFields.find((f) => f.id === v.customFieldId)?.name ?? null,
    content: v.content ?? null,
  }));
}

/**
 * How planka_get_card is advertised when PLANKA_GET_CARD_COMMENTS changes its
 * default. `null` = the variable is unset and the static text below is true.
 */
export function getCardCommentsPresentation(
  policy: AccessPolicy = getPolicy()
): { description: string; withComments: string } | null {
  const configured = policy.getCardComments;
  if (configured === null) return null;
  const what =
    configured === "all"
      ? "ALL comments"
      : `the ${configured} most recent comments`;
  return {
    description:
      "One card as a digest: name, column, labels, members, checklist counts, attachment and comment counts, and the first 200 chars of the description. " +
      `On this server ${what} are included by default (PLANKA_GET_CARD_COMMENTS) — pass withComments (0 for none, a number, or "all") to override. ` +
      'detail:"full" adds the whole description, every task item, the attachment list and the custom fields.',
    withComments: `Comments to include: 0 for none, a number for the N most recent, or "all" to page through every comment. Default on this server: ${
      configured === "all" ? '"all"' : configured
    }.`,
  };
}

/**
 * Tool: planka_get_card
 * A digest by default; the full record only when asked for.
 */
export const getCardTool = {
  name: "planka_get_card",
  description:
    "One card as a digest: name, column, labels, members, checklist counts, attachment and comment counts, and the first 200 chars of the description. " +
    'Comments are NOT included by default — pass withComments (a number, or "all") to read them. ' +
    'detail:"full" adds the whole description, every task item, the attachment list and the custom fields.',
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: {
        type: "string",
        description: "The card ID",
      },
      detail: {
        type: "string",
        enum: ["digest", "full"],
        description:
          'How much of the card to return. "digest" (default) is counts plus a description preview; "full" is the whole description, task items, attachments and custom fields.',
      },
      withComments: {
        description:
          'Comments to include: 0 (default, none), a number for the N most recent, or "all" to page through every comment.',
        anyOf: [{ type: "number" }, { type: "string", enum: ["all"] }],
      },
      descriptionChars: {
        type: "number",
        description:
          'Length of the description preview in the digest (default 200, max 2000). Ignored when detail is "full".',
      },
    },
    required: ["cardId"],
  },
  handler: async (params: {
    cardId: string;
    detail?: "digest" | "full";
    withComments?: number | "all";
    descriptionChars?: number;
  }) => {
    try {
      const full = params.detail === "full";
      // An explicit withComments — 0 included — always wins. Only a call that
      // does not say falls back to PLANKA_GET_CARD_COMMENTS.
      const requested =
        params.withComments === undefined || params.withComments === null
          ? getPolicy().getCardComments
          : params.withComments;
      const wantAll = requested === "all";
      const wantN =
        typeof requested === "number"
          ? Math.max(0, Math.floor(requested))
          : 0;
      const wantComments = wantAll || wantN > 0;

      const [details, comments] = await Promise.all([
        getCardLight({ cardId: params.cardId }),
        wantComments
          ? getComments({
              cardId: params.cardId,
              ...(wantAll
                ? { all: true }
                : { limit: Math.min(wantN, COMMENTS_PAGE_SIZE) }),
              order: "asc",
            })
          : Promise.resolve(null),
      ]);

      // Names for the ids the card carries. Best effort: a board that cannot
      // be read costs the names, never the card.
      const names = await getBoardNames(details.card.boardId);
      const listName = names?.lists.get(details.card.listId) ?? null;

      const description = details.card.description ?? "";
      const previewChars = Math.max(
        0,
        Math.min(
          params.descriptionChars ?? DEFAULT_DESCRIPTION_CHARS,
          MAX_DESCRIPTION_CHARS
        )
      );
      const preview = description.slice(0, previewChars);

      const card: Record<string, unknown> = {
        id: details.card.id,
        name: details.card.name,
        listId: details.card.listId,
        // Always present, even as null: an omitted field cannot be told apart
        // from "the board could not be read", and the model would assume the
        // card has no column.
        listName,
        ...(listName === null
          ? {
              listNameUnavailable: names
                ? "the board does not list this column — it may be the hidden archive or trash"
                : "the board could not be read, so column and label names were not resolved",
            }
          : {}),
        boardId: details.card.boardId,
        dueDate: details.card.dueDate ?? null,
        isDueCompleted:
          details.card.isDueCompleted ??
          details.card.isDueDateCompleted ??
          null,
        isClosed: details.card.isClosed ?? null,
        createdAt: details.card.createdAt,
        updatedAt: details.card.updatedAt ?? null,
      };

      if (full) {
        card.description = details.card.description ?? null;
      } else {
        card.descriptionPreview = preview;
        card.descriptionChars = description.length;
        if (description.length > preview.length) {
          card.descriptionTruncated = true;
        }
      }

      // Planka's own counter, not something this server derived.
      const commentsTotal = details.card.commentsTotal ?? null;

      const body: Record<string, unknown> = {
        detail: full ? "full" : "digest",
        card,
        labels: labelsOf(details, names?.labels),
        members: membersOf(details),
        tasks: tasksOf(details, full),
        attachmentsCount: details.attachments.length,
        commentsTotal,
      };

      if (full) {
        body.attachments = details.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type ?? null,
          mimeType: a.data?.mimeType ?? null,
          sizeBytes: a.data?.size ?? null,
        }));
        body.customFields = customFieldsOf(details);
      }

      if (comments) {
        body.comments = comments.comments.map((c) => ({
          id: c.id,
          text: c.text,
          author: c.authorName,
          createdAt: c.createdAt,
        }));
        body.commentsReturned = comments.comments.length;
        body.commentsOrder = "oldest-first";
        if (comments.hasMore) body.commentsHasMore = true;
        if (comments.nextBeforeId) body.nextBeforeId = comments.nextBeforeId;
        if (comments.truncated) body.commentsTruncated = true;
      } else if (commentsTotal !== 0) {
        body.comments =
          'not read — pass withComments (a number, or "all"), or call planka_get_comments';
      }

      if (!full) {
        body.more =
          'detail:"full" for the whole description, task items, attachments and custom fields';
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(body),
          },
        ],
      };
    } catch (error) {
      if (error instanceof PlankaError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  },
};

/**
 * Tool: planka_update_card
 * Update a card's properties.
 */
export const updateCardTool = {
  name: "planka_update_card",
  description:
    "Update a card's name, description, due date or completion. Null clears a field.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: {
        type: "string",
        description: "The card ID",
      },
      name: {
        type: "string",
        description: "New card title",
      },
      description: {
        type: ["string", "null"],
        description: "New description (null to clear)",
      },
      dueDate: {
        type: ["string", "null"],
        description: "New due date (null to clear)",
      },
      isCompleted: {
        type: "boolean",
        description: "Mark card as complete/incomplete",
      },
    },
    required: ["cardId"],
  },
  handler: async (params: {
    cardId: string;
    name?: string;
    description?: string | null;
    dueDate?: string | null;
    isCompleted?: boolean;
  }) => {
    try {
      const { cardId, ...updates } = params;

      // Only include defined fields
      const patch: UpdateCardParamsInput = { cardId };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.description !== undefined)
        patch.description = updates.description;
      if (updates.dueDate !== undefined) patch.dueDate = updates.dueDate;
      if (updates.isCompleted !== undefined)
        patch.isCompleted = updates.isCompleted;

      if (Object.keys(patch).length === 1) {
        return nothingToDo("name, description, dueDate, isCompleted");
      }

      const mismatches = (after: { card: Record<string, unknown> }) => {
        const bad: string[] = [];
        const c = after.card as {
          name?: string;
          description?: string | null;
          dueDate?: string | null;
          isCompleted?: boolean;
        };
        if (patch.name !== undefined && c.name !== patch.name) bad.push("name");
        if (
          patch.description !== undefined &&
          (c.description ?? null) !== (patch.description ?? null)
        )
          bad.push("description");
        if (patch.dueDate !== undefined && !sameDate(c.dueDate, patch.dueDate))
          bad.push("dueDate");
        if (
          patch.isCompleted !== undefined &&
          c.isCompleted !== patch.isCompleted
        )
          bad.push("isCompleted");
        return bad;
      };

      const written = await verifiedWrite({
        write: () => updateCard(patch),
        reread: () => getCardLight({ cardId }),
        landed: (after) => mismatches(after).length === 0,
      });

      const after = written.after;
      const notLanded = after ? mismatches(after) : [];

      return writeResult(
        {
          card: {
            id: written.result.id,
            name: after?.card.name ?? written.result.name,
            description: after?.card.description ?? written.result.description,
            dueDate: after?.card.dueDate ?? written.result.dueDate,
            isCompleted: after?.card.isCompleted ?? written.result.isCompleted,
          },
          ...(notLanded.length > 0 ? { notLanded } : {}),
        },
        written
      );
    } catch (error) {
      if (error instanceof PlankaError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  },
};

/**
 * Tool: planka_move_card
 * Move a card to a different list or position.
 */
export const moveCardTool = {
  name: "planka_move_card",
  description:
    "Move a card to another list, board or position — the workflow transition.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: {
        type: "string",
        description: "The card ID",
      },
      listId: {
        type: "string",
        description: "Target list ID",
      },
      boardId: {
        type: "string",
        description:
          "Target board ID — only when moving across boards (listId must belong to it)",
      },
      position: {
        type: "number",
        description:
          "Position in the list (lower = higher). Default: end of list",
      },
    },
    required: ["cardId", "listId"],
  },
  handler: async (params: {
    cardId: string;
    listId: string;
    boardId?: string;
    position?: number;
  }) => {
    try {
      await assertCardsListWritable(params.cardId, "move cards out of");

      const written = await verifiedWrite({
        write: () =>
          moveCard({
            cardId: params.cardId,
            listId: params.listId,
            boardId: params.boardId,
            position: params.position ?? 65536,
          }),
        reread: () => getCardLight({ cardId: params.cardId }),
        landed: (after) =>
          after.card.listId === params.listId &&
          (params.boardId ? after.card.boardId === params.boardId : true),
      });

      const after = written.after;

      return writeResult(
        {
          card: {
            id: written.result.id,
            name: after?.card.name ?? written.result.name,
            listId: after?.card.listId ?? written.result.listId,
            boardId: after?.card.boardId ?? written.result.boardId,
          },
          requestedListId: params.listId,
          ...(params.boardId ? { requestedBoardId: params.boardId } : {}),
          ...(after && after.card.listId !== params.listId
            ? {
                notLanded:
                  "the card is still in list " +
                  after.card.listId +
                  " — check that the listId belongs to the card's board",
              }
            : {}),
        },
        written
      );
    } catch (error) {
      if (error instanceof PlankaError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  },
};

/**
 * Tool: planka_delete_card
 * Permanently delete a card.
 */
export const deleteCardTool = {
  name: "planka_delete_card",
  description:
    "Permanently delete a card with its tasks, comments and attachments. Cannot be undone; confirmed by re-reading.",
  inputSchema: {
    type: "object" as const,
    properties: {
      cardId: {
        type: "string",
        description: "The card ID to delete",
      },
    },
    required: ["cardId"],
  },
  handler: async (params: { cardId: string }) => {
    try {
      await assertCardsListWritable(params.cardId, "delete cards from");

      const deleted = await verifiedDelete({
        del: () => deleteCard({ cardId: params.cardId }),
        confirmGone: () =>
          goneOn404(() => getCardLight({ cardId: params.cardId })),
      });

      return writeResult(
        {
          cardId: params.cardId,
          message: deleted.verified
            ? `Card ${params.cardId} deleted`
            : `Card ${params.cardId} still answers a read after the delete`,
        },
        deleted
      );
    } catch (error) {
      if (error instanceof PlankaError) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  },
};

export const cardTools = [
  createCardTool,
  getCardTool,
  updateCardTool,
  moveCardTool,
  deleteCardTool,
];
