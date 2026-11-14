# Tools reference

The server exposes exactly 41 tools: 34 in active use plus 7 deprecated ones kept
as aliases (see [Deprecated aliases](#deprecated-aliases); `PLANKA_HIDE_DEPRECATED`
takes them out of `tools/list`). Tool results are MCP text content containing
JSON (minified — the indentation was pure token cost). On an expected Planka
error, the result has `isError: true` and a human-readable message instead of a
false success.

## Every write is verified

A `200` from Planka proves the request was accepted, not that the change is in
the database. So every write re-reads the entity and reports what LANDED, never
what was asked for. The response fields:

| Field | Meaning |
|---|---|
| `verified: true` | A re-read confirmed the change. This is the only real success. |
| `verified: false` + `isError` | The re-read contradicted the write, or the write could not be checked. Do not assume the write failed: read before retrying. |
| `verificationError` | The re-read itself failed. The write may or may not have landed. |
| `verificationUnavailable` | Verification was structurally impossible (a task or attachment whose card is unknown). The message names the parameter — usually `cardId` — that would have made the check possible. |

**`success` mirrors `verified`, and nothing else.** "I could not check" is not a
success: a result that carried `success: true` next to `verified: false` and
`"delete not confirmed"` was read by models as done. Every unverified write now
answers `success: false` with `isError`, and says what to pass to get it
verified.
| `partialFailure` | A follow-up step failed (`planka_create_card` only). The card id is always present anyway. |
| `notLanded` | The fields, or the list, that the re-read says did not change. |

Verification costs one extra read per write — a card read for cards, tasks,
comments and attachments, and a board read for labels and lists.

## Before your first call

- All Planka IDs are strings, even when they contain only digits.
- Discover IDs with `planka_board_summary` (columns and labels of one board) or
  `planka_get_structure` (projects and boards).
- Reading a whole board is the expensive call. When you only need one column,
  one label, or the shape of the board, use a [scoped read](#scoped-reads).
- Dates use ISO 8601, for example `2026-09-01T17:00:00.000Z`.
- Omit optional fields you do not want to change. Use `null` only where the schema
  explicitly allows it.
- Destructive tools really delete data. Ask for confirmation in your agent prompt
  when that matters.

## Server instructions and annotations

Two things travel with `tools/list` and the `initialize` handshake, so a client
gets them without installing anything.

**Server instructions.** The `initialize` result carries an `instructions`
string (~1.8 kB). Claude Code injects it into the session system prompt and
Codex CLI reads it alongside the tool list. It holds the guidance that is shared
by many tools and therefore does not belong in any single description: open a
session with `planka_board_summary` and never `planka_get_board`, IDs are
strings of digits taken from `planka_get_structure` or `planka_board_summary`,
read every comment on a card before acting on it, reads return digests with
`total`/`returned`/`hasMore`, writes report `verified` and `finalLabelIds`, and
Planka answers `404` where it means `403`. The MCP spec asks that instructions
not duplicate tool descriptions, which is why the descriptions below are short.
Source: `src/instructions.ts`, budget enforced at 1500-2500 characters by
`tests/unit/instructions.test.ts`.

**Tool annotations.** Every tool publishes a `title` and all four behavioural
hints, spelled out rather than left to the spec defaults — which are pessimistic
(`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`,
`openWorldHint: true`) and would make `planka_get_comments` look as dangerous as
`planka_delete_card`. `openWorldHint` is `false` everywhere: the domain is one
configured Planka instance, not the open web.

| Group | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|---|---|---|---|
| Reads (`get_*`, `list_*`, `find_cards`, `board_summary`) | `true` | `false` | `true` |
| Additive writes (`create_card`, `create_tasks`, `create_comment`, `create_label`, `create_list`, `add_attachment`) | `false` | `false` | `false` |
| Converging writes (`move_card`, `update_task`, `update_label`, `update_list`, `update_comment`) | `false` | `false` | `true` |
| Data-losing writes (`update_card`, `set_card_labels`, `set_card_members`, `archive_card`, `move_list_cards`, every `delete_*`) | `false` | `true` | `true` |
| Deprecated multi-action aliases (`manage_labels`, `manage_lists`, `manage_comment`) | `false` | `true` | `false` |

**Anthropic `_meta`.** Claude Code does not gate permissions on the standard
hints; it reads two `_meta` keys instead, and the server ships both:

- `anthropic/requiresUserInteraction: true` forces the permission prompt even
  under an `allow` rule — set on eleven tools: `planka_delete_card`,
  `planka_delete_task`, `planka_delete_attachment`, `planka_delete_label`,
  `planka_delete_list`, `planka_delete_comment`, `planka_archive_card`,
  `planka_move_list_cards`, and the deprecated `planka_manage_comment`,
  `planka_manage_lists` and `planka_manage_labels`. The three aliases are marked
  whole because one of their actions deletes: a list takes its cards with it, a
  label disappears from every card that carried it. `archive_card` and
  `move_list_cards` are there because both move cards a human will look for
  where they used to be.
- `anthropic/maxResultSizeChars: 4500000` on `planka_view_attachment`, so a
  base64 image up to 3 MB is not clipped by the default per-tool ceiling.

The map lives in `src/tools/annotations.ts`. A tool with no entry there fails
`tests/unit/annotations.test.ts`, and the same file pins the order of
`tools/list` so clients that cache it see a stable payload.

## Navigation

### `planka_get_structure`

Lists the project → board → list hierarchy visible to the agent user. Pass an
empty object to inspect everything:

```json
{}
```

Or restrict it to one project:

```json
{
  "projectId": "1234567890123456789"
}
```

| Field | Default | Notes |
|---|---|---|
| `projectId` | none | An id that is not visible errors and lists the ones that are |
| `withLists` | `true` | Include each board's columns |

Planka has no per-board list endpoint: the columns only exist inside a full
board read, so `withLists: true` costs **one board read per board**.
`withLists: false` answers projects and boards from the single
`GET /api/projects` — 203 chars and 1 request against 696 chars and 4 requests
on the reference instance. Use `planka_board_summary` when you want the columns
of one board: it brings their card counts too.

### `planka_get_board`

> **DEPRECATED — use `planka_board_summary` + `planka_find_cards`.**
> It still works, and it is still the most expensive read of the set.

Reads one board with its labels, lists and cards.

```json
{
  "boardId": "2234567890123456789",
  "includeTaskCounts": true,
  "limit": 50
}
```

| Field | Default | Notes |
|---|---|---|
| `includeTaskCounts` | `true` | Checklist counts per card |
| `limit` | `50` | Cards across the WHOLE board, maximum `200` |

It hands out cards in board order until `limit` runs out and then reports
`totalCards`, `returnedCards` and `truncated: true` — it no longer grows without
a ceiling. Every response carries `excludesArchived: true`: the board read has
no cards from the archive and trash lists (see
[planka-2x-gotchas.md](planka-2x-gotchas.md)).

## Scoped reads

Three tools, one principle: **a small digest by default, the detail through
parameters**.

| Question | Tool |
|---|---|
| What is on this board — columns, counts, labels? | `planka_board_summary` |
| What is in this one column? | `planka_find_cards` with `listId` |
| Which cards carry this label, mention this text, belong to this person? | `planka_find_cards` |
| I need every field of every card, in one object | `planka_get_board` (deprecated) |

`planka_list_lists` and `planka_list_cards` are **deprecated aliases** kept for
existing callers: `planka_list_lists` is `planka_board_summary` with
`cardsFrom: []`, and `planka_list_cards` is `planka_find_cards` with `listId`.
Same implementation, same response — and together they were the two most
expensive schemas in `tools/list`, which is why `PLANKA_HIDE_DEPRECATED` now
drops them too.

### Measured, against the real reference board

185 cards, 10 columns, 23 labels. `chars` is the tool response as serialized;
`reqs` is how many requests to Planka it took.

| Call | before | after | Δ chars |
|---|---|---|---|
| `board_summary` — session opener | 2,045 chars / 1 req | 2,037 / 1 | −0 % |
| `board_summary` columns only (= `list_lists`) | 782 / 1 | 1,947 / 1 | +149 % |
| One column of 15 cards (default `limit` 25) | 2,572 / 2 | 3,366 / 2 | +31 % |
| One column of 159 cards (default `limit` 25) | 4,272 / **5** | 5,834 / **2** | +37 % |
| One column of 159 cards, `limit: 200` | 27,044 / **5** | 36,230 / **2** | +34 % |
| `find_cards` by label (29 hits, `limit` 25) | 6,085 / 1 | 6,758 / 1 | +11 % |
| `find_cards` by text | 1,724 / 1 | 1,986 / 1 | +15 % |
| `get_board` | 56,112 / 1 | **17,215** / 1 | **−69 %** |
| `get_structure` with columns | 696 / 4 | 696 / 4 | = |
| `get_structure` `withLists: false` | — | **203 / 1** | — |

Read it honestly: the card digest got **richer**, not smaller. Each card now
also carries `commentsTotal`, `updatedAt` and its members — around 40 chars each
— which is what stops the follow-up call that used to be needed to find out
whether a card had comments or had moved since the last session. What got
cheaper is everything else: the whole-board dump (−69 %), the structure without
columns (−71 %), and the number of requests behind a column read (5 → 2, and
1 with `withLabels: false`).

`planka_list_lists` grew because it is now `planka_board_summary`'s payload: it
also returns the board's labels **with their IDs**, which is exactly what
`planka_set_card_labels` needs and what used to send callers to the deprecated
`planka_get_board`.

### `planka_board_summary`

One call that describes a board well enough to start working: every column with
its card count, every label with its ID, and — when asked — the cards of the
column(s) named in `cardsFrom`.

```json
{
  "boardId": "2234567890123456789"
}
```

That answers columns and labels and **no cards at all**. Ask for cards by naming
the columns:

```json
{
  "boardId": "2234567890123456789",
  "cardsFrom": [
    "blocked",
    "needs review"
  ],
  "highlightLabel": "approved",
  "limit": 50
}
```

| Field | Default | What it does |
|---|---|---|
| `cardsFrom` | `PLANKA_SUMMARY_DECISION_LISTS`, else none | List IDs, or column-name fragments matched case- and accent-insensitively. `[]` means columns only |
| `highlightLabel` | `PLANKA_SUMMARY_HIGHLIGHT_LABEL`, else none | Cards carrying that label sort first and get `highlighted: true` |
| `limit` | `50` | Caps returned cards; maximum `200` |

**No board vocabulary is hardcoded in the server any more.** The defaults come
from the environment, so a deployment describes its own board:

```bash
PLANKA_SUMMARY_DECISION_LISTS="decision,probalo,miralo"
PLANKA_SUMMARY_HIGHLIGHT_LABEL="decidido"
```

A `cardsFrom` entry that matches no column, or a `highlightLabel` that is not on
the board, comes back in `warnings` **naming the columns or labels that do
exist** — never as a silently empty result. The response also carries
`excludesArchived: true`.

### `planka_find_cards`

The one read over a board's cards. At least one filter is required
(`listId`, `listName`, `query`, `labelName`, `labelIds` or `userIds`); an
unfiltered search would just be a slower `planka_get_board`.

One column, the cheap path:

```json
{
  "listId": "3234567890123456789"
}
```

`GET /api/lists/:id` returns **every card of that column in one response**, with
no cursor to follow: `total` is the real size of the column and the answer
carries `truncated: false`. `boardId` is not needed — the list names its own
board.

Search a board:

```json
{
  "boardId": "2234567890123456789",
  "query": "export timeout",
  "labelName": "ready",
  "descriptionChars": 200
}
```

| Field | Default | Notes |
|---|---|---|
| `boardId` | `PLANKA_DEFAULT_BOARD_ID` | Ignored when `listId` is given |
| `listId` | none | One column, one request, never truncated |
| `listName` | none | Column-name fragment; costs a board read |
| `query` | none | Name **and** description. Several words are ANDed; a leading `/` makes the rest a case-insensitive regular expression |
| `labelName` | none | Exact label name, case- and accent-insensitive. `labelFilter` is still accepted as an alias, but is no longer announced in the schema |
| `labelIds` | none | Label IDs, OR between them |
| `userIds` | none | Members **or** task assignees, OR between them |
| `withLabels` | `true` | `false` skips the extra board read on the `listId` path |
| `detail` | `"digest"` | `"full"` returns every field of the card, description included |
| `descriptionChars` | `0` | Per-match description preview, in characters. `withDescription: true` is still accepted (it means 200 characters) but is no longer announced in the schema |
| `limit` | `25` | Maximum `200` |
| `offset` | `0` | Pass the previous response's `nextOffset` to page |

The digest of a card is `id`, `name`, `labels`, `labelIds`, `members`, `tasks`
(`"2/5"`), `dueDate`, `commentsTotal` and `updatedAt`. Empty values are left out
entirely, and the column is **not repeated on every card**: when the search is
scoped to one column the response carries `list: {id, name}` once, and only a
result spanning several columns puts `listId` and `listName` on each match.

**The two digests share one vocabulary.** `labelIds` is in the digest, not only
in `detail: "full"`, because `planka_set_card_labels` takes label *ids* and only
ids: publishing the names alone sent the caller back to `planka_board_summary`
for a value `find_cards` already had. Where a field exists in both
`planka_find_cards` and `planka_get_card` it means the same thing and carries the
same name:

| Concept | `planka_find_cards` (digest) | `planka_get_card` (digest) |
|---|---|---|
| column | `listId` (multi-column results) + `listName` | `card.listId` + `card.listName` (`null` plus `listNameUnavailable` when the board could not be read) |
| labels | `labels` (names) + `labelIds` | `labels: [{id, name}]` |
| members | `members` (names) | `members: [{id, name}]` |
| tasks | `tasks: "2/5"` | `tasks: {done, total, lists}` |
| description | `description`, only when `descriptionChars > 0` | `descriptionPreview` + `descriptionChars` + `descriptionTruncated` |

The response says where it came from and what it could not see:

| Field | Meaning |
|---|---|
| `source: "list"` | Read through the list show: one request, whole column |
| `truncated: false` | Guaranteed on the list path |
| `source: "board"` | Filtered over one board read |
| `excludesArchived: true` | The board read has no archive/trash cards |
| `labelsResolved: false` | Label names were not fetched, so `labels` is absent |
| `warnings` | A label, column or filter that matched nothing, with what does exist |

Get list IDs from `planka_board_summary` or `planka_get_structure`.

## Cards

### `planka_create_card`

Creates a card. Tasks and labels are optional follow-up writes performed by the
same tool.

```json
{
  "listId": "3234567890123456789",
  "name": "Verify the export flow",
  "description": "Reproduce the timeout and record the expected result.",
  "tasks": [
    "Create a large sample",
    "Run the export",
    "Record the duration"
  ],
  "dueDate": "2026-09-01T17:00:00.000Z",
  "labelIds": [
    "4234567890123456789"
  ]
}
```

Only `listId` and `name` are required.

The result reports `tasksRequested` / `tasksCreated` and `labelsRequested` /
`labelsAttached` **counted from a re-read of the card**, plus `finalLabelIds`.
If a follow-up step fails the card is still created: `card.id` always comes
back, together with `partialFailure` (`tasks`, `tasksMissing`, `labelIds`) and
`isError`. Never retry a `planka_create_card` that errored without reading the
id it returned — that is how boards grow duplicates. Every label failing is an
error, not a `success: true` with zero labels.

### `planka_get_card`

Returns a **digest** by default, and the full record only when asked for. On a
real card of the OmnicoreOS board the digest is **1.3 KB where the old
everything-always answer was 13.2 KB** — a 90 % cut with nothing important lost.

```json
{
  "cardId": "5234567890123456789"
}
```

The digest carries: `id`, `name`, `listId` **and `listName`**, `boardId`,
`labels` (ids **with names**), `members`, `tasks` as `{done, total, lists:[…]}`
— one entry per checklist, never flattened —, `attachmentsCount`,
`commentsTotal` (Planka's own counter), `dueDate`, `isDueCompleted`, `isClosed`,
`updatedAt` and `descriptionPreview` (first 200 chars, with `descriptionChars`
and `descriptionTruncated`).

| Parameter | Default | What it does |
|---|---|---|
| `detail` | `"digest"` | `"full"` adds the whole description, every task item, the attachment list and the custom field values |
| `withComments` | `0`, or `PLANKA_GET_CARD_COMMENTS` | A number returns the N most recent comments; `"all"` pages through every one of them |
| `descriptionChars` | `200` | Size of the description preview (max 2000). Ignored when `detail` is `"full"` |

```json
{
  "cardId": "5234567890123456789",
  "detail": "full",
  "withComments": 10
}
```

A deployment can change that default with `PLANKA_GET_CARD_COMMENTS` (`all` or a
number): a call that does not pass `withComments` then reads that many, the
tool description and the server `instructions` say so, and an explicit
`withComments` — `0` included — still wins.

Comments are **off by default**: they are the biggest and most variable part of
a card, and most reads do not need them. When they are requested they come back
oldest first — reading order — with `commentsReturned`, `commentsHasMore`,
`nextBeforeId` and, for `"all"`, `commentsTruncated` when the card has more than
the page ceiling.

`listName` and the label names come from one board read, cached for a minute.
If that read fails the names are simply absent; the card is never lost with
them. If the comments endpoint fails, the tool ERRORS: it never reports an empty
comment list it could not actually read.

### `planka_update_card`

Updates only the fields present in the request.

```json
{
  "cardId": "5234567890123456789",
  "name": "Verify and document the export flow",
  "description": "Timeout reproduced. Add the accepted duration to the docs.",
  "dueDate": null,
  "isCompleted": false
}
```

Use `null` to clear `description` or `dueDate`.

Passing only `cardId` is rejected (`nothing to do`): an empty PATCH used to
answer `success: true` without changing anything. The result re-reads the card
and lists in `notLanded` any field that did not actually change.

### `planka_move_card`

Moves a card to a list and optionally assigns its numeric position.

```json
{
  "cardId": "5234567890123456789",
  "listId": "6234567890123456789",
  "boardId": "2234567890123456789",
  "position": 65536
}
```

If `position` is omitted, the card goes to the end of the list. `boardId` is
only for moving a card to another board, and the `listId` must belong to it.

The card is re-read: if it did not end up in the requested list the result is
`verified: false` + `isError`, with the list it is actually in.

### `planka_delete_card`

Permanently deletes a card, with its tasks, comments and attachments. The
deletion is confirmed by re-reading the card: a 404 is the proof, and anything
else comes back as `verified: false` + `isError`.

```json
{
  "cardId": "5234567890123456789"
}
```

## Checklist tasks

### `planka_create_tasks`

Adds one or more checklist tasks to a card.

```json
{
  "cardId": "5234567890123456789",
  "tasks": [
    "Add a regression test",
    "Update the operator notes"
  ]
}
```

The result reports `tasksCreated` counted from a re-read of the card, not from
the request.

### `planka_update_task`

Renames a task, changes completion, or does both. Passing only `taskId` is
rejected (`nothing to do`).

```json
{
  "taskId": "7234567890123456789",
  "cardId": "5234567890123456789",
  "name": "Add and run a regression test",
  "isCompleted": true
}
```

`cardId` is optional but strongly recommended: Planka has no GET for a single
task, so the card is the only place the change can be verified. Without it the
result carries `verificationUnavailable` instead of a proven success.

### `planka_delete_task`

Deletes one checklist task. Same rule: pass `cardId` to have the deletion
confirmed against the card.

```json
{
  "taskId": "7234567890123456789",
  "cardId": "5234567890123456789"
}
```

## Labels

### `planka_create_label`

Creates a board label.

```json
{
  "boardId": "2234567890123456789",
  "name": "needs-decision",
  "color": "berry-red",
  "position": 65536
}
```

`position` is optional; Planka appends the label when it is omitted.

`boardId`, `name` and `color` are `required` in the JSON Schema, so a client
rejects an incomplete call before it leaves. With `PLANKA_DEFAULT_BOARD_ID` set,
`boardId` drops out of `required` and is filled in.

`color` is a real JSON Schema `enum` of the 43 Planka 2.x colors **here and only
here** — repeating the enum on `planka_update_label` and `planka_manage_labels`
cost ~650 characters of every session for the same list. Those two take the same
values, validated server-side with a message that spells them out, and the
`planka://labels/colors` resource serves the list on demand.
A bad color is rejected before the call leaves the client. Unknown colors are still accepted
on reads, so one new upstream color cannot break a board response. Run
`planka_board_summary` to see the colors already in use.

The write is verified against a re-read of the board's labels.

### `planka_update_label`

Renames a label or changes its color.

```json
{
  "labelId": "4234567890123456789",
  "name": "decision-needed",
  "color": "pumpkin-orange"
}
```

A call carrying only `labelId` is rejected (`nothing to do`) instead of sending
an empty `PATCH` that Planka would answer `200` to. The response reports the
board's copy of the label, not the `PATCH` echo.

### `planka_delete_label`

Deletes a board label.

```json
{
  "labelId": "4234567890123456789"
}
```

> **DESTRUCTIVE.** The label disappears from every card that carried it.

Confirmed by re-reading the board: a label still there afterwards comes back as
`verified: false` + `isError`.

### `planka_set_card_labels`

Adds and removes labels, then re-reads the card and reports the verified final
state. `labelIds` is a supported alias for `addLabelIds`; if both are provided,
their values are merged.

```json
{
  "cardId": "5234567890123456789",
  "addLabelIds": [
    "4234567890123456789"
  ],
  "labelIds": [
    "8234567890123456789"
  ],
  "removeLabelIds": [
    "9234567890123456789"
  ]
}
```

The response distinguishes requested, added, removed, already present, already
absent, failed, and final label IDs. This makes silent no-op writes visible.

## Comments

### `planka_create_comment`

Adds a Markdown-capable comment through Planka 2.x's dedicated card action
endpoint. (Formerly `planka_add_comment`, which still works — see
[Deprecated aliases](#deprecated-aliases).)

```json
{
  "cardId": "5234567890123456789",
  "text": "Verification complete: unit tests and the manual export both passed."
}
```

The comment is re-read from the card before the tool reports success.

### `planka_get_comments`

Reads the dedicated comment collection for one card, **oldest first**, one page
at a time. Planka serves comments 50 at a time and ignores `?limit`/`?page`; the
only cursor is `beforeId`, and this tool exposes it honestly.

```json
{
  "cardId": "5234567890123456789",
  "limit": 20,
  "order": "asc"
}
```

| Parameter | Default | What it does |
|---|---|---|
| `limit` | `20` | Comments to return, max 50 (Planka's page) |
| `beforeId` | — | Cursor: returns comments **older** than that comment id |
| `all` | `false` | Walks every page, up to 10 of them (500 comments) |
| `order` | `"asc"` | `"asc"` oldest first (reading order), `"desc"` newest first |

The answer carries `commentCount` (**what this response holds — never the card's
total**), `hasMore`, `nextBeforeId` and, with `all`, `truncated` plus the reason.
Continue by passing the `nextBeforeId` you were handed:

```json
{ "cardId": "5234567890123456789", "beforeId": "1034567890123456789" }
```

The card's real total comes from `planka_get_card` (`commentsTotal`), which is
Planka's own counter.

This does not rely on `included.comments`, which is empty in affected Planka 2.x
responses even when the card has comments.

### `planka_update_comment`

Rewrites a comment. Get comment IDs from `planka_get_comments`.

```json
{
  "commentId": "1034567890123456789",
  "text": "Verification complete: unit tests and the manual export both passed."
}
```

`commentId` and `text` are both `required`. Planka only lets the authenticated
user modify comments that user wrote, so an agent can correct its own notes but
not someone else's. The card's comments are re-read before the tool reports: an
edit that did not stick comes back as `verified: false` + `isError`.

### `planka_delete_comment`

Deletes a comment.

```json
{
  "commentId": "1034567890123456789"
}
```

Confirmed by re-reading the card's comments; a comment still present afterwards
comes back as `verified: false` + `isError`.

## Lists

### `planka_create_list`

Creates a board list (column). Creation sends an explicit Planka 2.x list
`type`; it defaults to `active`.

```json
{
  "boardId": "2234567890123456789",
  "name": "Pending",
  "position": 65536,
  "type": "active"
}
```

`boardId` and `name` are `required` (`boardId` drops out with
`PLANKA_DEFAULT_BOARD_ID`). Only `active` and `closed` are accepted for list
writes; internal Planka list types such as archive and trash remain readable.

### `planka_update_list`

Renames, repositions or reclassifies a column.

```json
{
  "listId": "3234567890123456789",
  "name": "Ready",
  "position": 131072,
  "type": "active"
}
```

A call carrying only `listId` is rejected (`nothing to do`). The response reports
the board's copy of the list.

### `planka_delete_list`

Deletes a column.

```json
{
  "listId": "3234567890123456789"
}
```

> **DESTRUCTIVE — it takes the cards with it.** Deleting a list deletes every
> card inside it, and Planka does not ask. Move the cards out first with
> `planka_move_list_cards` or `planka_move_card`, or delete a column you created
> yourself. This cannot be undone.

Confirmed by re-reading the board: a list still there afterwards comes back as
`verified: false` + `isError`.

## Attachments

Attachments carry the evidence a card needs to be understood later: a
screenshot of the bug, a before/after pair, a failing console. Prefer a code
block in a comment for stack traces, diffs, and logs; an image of text is
harder to read and impossible to search.

### `planka_add_attachment`

Uploads a local file to a card, then re-reads the card's attachments to confirm
it landed. The response carries `verified`, and the result is flagged as an
error when the re-read does not find the upload.

```json
{
  "cardId": "5234567890123456789",
  "filePath": "/home/user/screenshots/export-timeout.png",
  "name": "before-export-timeout.png"
}
```

`filePath` must be an absolute path on the machine running the MCP server.
`name` is optional and defaults to the file's basename; descriptive names such
as `before-...`, `after-...`, or `console-error-...` are worth the extra field.
The content type is derived from the extension, with `application/octet-stream`
as the fallback. A missing file returns `File not found: <path>` instead of an
opaque failure.

### `planka_get_attachments`

Lists what a card holds: `id`, `name`, `type`, `mimeType`, `size`, download
`url`, and `createdAt`.

```json
{
  "cardId": "5234567890123456789"
}
```

### `planka_view_attachment`

Returns an attachment's content rather than its metadata.

```json
{
  "cardId": "5234567890123456789",
  "attachmentId": "1134567890123456789"
}
```

`attachmentId` is optional when the card has exactly one attachment. With more
than one and no ID, the tool refuses and lists the available IDs and names
instead of guessing.

What comes back depends on the content type:

| Content type | Result |
|---|---|
| `image/*`, except `image/svg+xml` | MCP image content, so a model with vision actually sees it. Limited to 3 MB; larger images return the download URL instead |
| `text/*`, `application/json`, `image/svg+xml` | Inline text, clipped at 50 KB and marked `[truncated to 50KB]` when clipped |
| Anything else | Metadata and the download URL, with a note that it cannot be rendered inline |

### `planka_delete_attachment`

Permanently deletes one attachment.

```json
{
  "attachmentId": "1134567890123456789",
  "cardId": "5234567890123456789"
}
```

`cardId` is optional: Planka normally echoes the deleted attachment (which
carries its card), and that is what makes the deletion verifiable. Pass it when
you have it; if neither is available the result says
`verificationUnavailable` rather than claiming success.

## Activity

Planka records **six** kinds of event, and only six
(`Action.Types` in `server/api/models/Action.js`):

`createCard` · `moveCard` · `addMemberToCard` · `removeMemberFromCard` ·
`completeTask` · `uncompleteTask`

There is no event for a comment, a rename or a description edit. A card with an
empty history was not necessarily untouched — it was only never moved, assigned
or checked off. Both tools say so in a `note` when they return nothing.

Both endpoints return at most **50 events** (a Planka constant, not a query
parameter) and page backwards with a cursor.

### `planka_card_history`

One card's log, newest first, as one human line per event.

```json
{
  "cardId": "5234567890123456789",
  "limit": 20,
  "beforeId": "7234567890123456789"
}
```

`limit` defaults to 20 and is capped at 50. Response:

```json
{
  "cardId": "5234567890123456789",
  "cardName": "Retire the nginx failover",
  "returned": 2,
  "events": [
    {
      "id": "1855662785539605720",
      "type": "moveCard",
      "at": "2026-09-03T02:50:42.309Z",
      "user": "Claude",
      "summary": "moved the card from \"In progress\" to \"Review\""
    },
    {
      "id": "1855530665752134803",
      "type": "createCard",
      "at": "2026-09-02T22:28:12.404Z",
      "user": "Claude",
      "summary": "created the card in \"Backlog\""
    }
  ],
  "hasMore": false
}
```

`hasMore` with `nextBeforeId` means there is older activity: call again passing
`beforeId: nextBeforeId`. List, user and task names come from the event itself —
no extra read is made to resolve them.

### `planka_board_activity`

What moved on a whole board, grouped by card. The call to make when resuming a
session someone else (or a past you) left behind.

```json
{
  "boardId": "2234567890123456789",
  "since": "2026-09-01T00:00:00.000Z",
  "limit": 50,
  "types": ["moveCard", "createCard"]
}
```

| Field | Meaning |
|---|---|
| `since` | ISO 8601. The sweep walks pages backwards and stops at it. |
| `limit` | Maximum events returned. Default 50, capped at 250. |
| `types` | Keep only these event types. |

The sweep is capped at **5 pages** (250 events). Response:

```json
{
  "boardId": "2234567890123456789",
  "since": "2026-09-01T00:00:00.000Z",
  "pagesFetched": 1,
  "scanned": 50,
  "returned": 5,
  "cardsTouched": 1,
  "truncated": true,
  "nextBeforeId": "1855558191031518415",
  "cards": [
    {
      "cardId": "5234567890123456789",
      "cardName": "Retire the nginx failover",
      "events": [
        {
          "id": "1855662785539605720",
          "type": "moveCard",
          "at": "2026-09-03T02:50:42.309Z",
          "user": "Claude",
          "summary": "moved the card from \"In progress\" to \"Review\""
        }
      ]
    }
  ]
}
```

`truncated: true` means older activity exists that this answer does not carry —
either `limit` or the page cap stopped the sweep. It is `false` only when the
log was exhausted or `since` was reached.

## People

### `planka_list_users`

Who can be assigned, with the IDs `planka_set_card_members` needs.

```json
{
  "boardId": "2234567890123456789",
  "detail": "digest"
}
```

`GET /api/users` is admin-only in Planka. When this account is a plain
`boardUser` the call is refused and the tool falls back to the **board's own
members**, which is the assignable set anyway. The fallback is never silent:

| Field | Meaning |
|---|---|
| `source: "instance"` | The instance roster. |
| `source: "board"` + `note` | The instance roster was refused; these are the board's members, each with `boardRole` and `canComment`. |

`boardId` is only used by the fallback. `detail: "full"` adds email addresses,
which the digest deliberately omits.

```json
{
  "source": "instance",
  "total": 4,
  "users": [
    { "id": "1830226958957413619", "name": "Fede", "username": "fede", "role": "boardUser" }
  ]
}
```

### `planka_whoami`

The first call to make when something answers `404` that should not: it names
the account, what it may do on the board, and what the local policy switched
off — the three usual causes of a confusing refusal.

```json
{
  "user": { "id": "1829420929365574677", "name": "Claude", "username": "claude", "role": "admin" },
  "plankaVersion": "2.2.1",
  "authMode": "password",
  "boardMembership": { "boardId": "2234567890123456789", "role": "editor", "canComment": null },
  "policy": {
    "defaultBoardId": null,
    "allowedBoardIds": null,
    "allowedProjectIds": null,
    "readOnly": false,
    "disabledTools": [],
    "protectedListIds": []
  }
}
```

`plankaVersion` comes from `/api/bootstrap`, the only endpoint in 2.x that
carries it. A version that does not start with `2.` adds a `versionWarning`:
this server targets 2.x and the paths it uses may not exist elsewhere.
`boardMembership` is read from `/api/projects` (~3 kB), not from the board show
(~900 kB) — both carry the memberships.

### `planka_set_card_members`

Assigns and unassigns people on a card, then re-reads the card and reports the
verified final state. The mirror of `planka_set_card_labels`, argument for
argument.

```json
{
  "cardId": "5234567890123456789",
  "add": ["1830226958957413619"],
  "remove": ["1830228857995658485"],
  "addUserNames": ["fede"],
  "removeUserNames": ["Pat"],
  "boardId": "2234567890123456789"
}
```

Names are matched exactly and case-insensitively, on `username` first and then
on `name`. An ambiguous name is **not** guessed — assigning the wrong person is
worse than failing — and comes back in `failed`. Removals are applied before
additions, so one call can hand a card from one person to another.

The response distinguishes `added`, `removed`, `alreadyPresent`, `notPresent`,
`failed` and `finalMemberIds`. A `404` on an addition almost always means the
user is not a member of that board; the reason says so.

## Card operations

### `planka_duplicate_card`

Copies a card through Planka's own `duplicate` endpoint, which carries over the
card's tasks, labels, members and custom field values. **Attachments are not
copied.**

```json
{
  "cardId": "5234567890123456789",
  "listId": "3234567890123456789",
  "name": "Retire the nginx failover (round 2)",
  "position": 65536
}
```

Without `listId` the copy lands in the original's column; without `name` Planka
appends its own suffix. `boardId` copies across boards and then `listId` is
required — a card cannot land on a board without a column. The counts in
`copied` come from re-reading the new card, not from the write's response.

```json
{
  "success": true,
  "verified": true,
  "card": { "id": "6234567890123456789", "name": "…", "listId": "3234567890123456789" },
  "sourceCardId": "5234567890123456789",
  "copied": { "tasks": 2, "labels": 1, "members": 1, "attachments": 0 }
}
```

### `planka_archive_card`

Planka has no "archive" verb. Every board owns two invisible lists besides its
columns — one of type `archive` and one of type `trash` — with no name, no
position, and no `GET` of their own (`GET /api/lists/:id` answers 404 for
them). Archiving is a move into the first of those, and this tool resolves it
from the board.

```json
{ "cardId": "5234567890123456789" }
```

To bring a card back, name the column it should land in:

```json
{ "cardId": "5234567890123456789", "restoreToListId": "3234567890123456789" }
```

Two behaviours worth knowing, both verified against Planka 2.2.1:

- `isClosed` does **not** change when a card is archived, so it is useless as
  proof. The only honest verification is the card's `listId`.
- An archived card has `position: null`, and Planka rejects a `PATCH` that only
  carries `listId` with *"Position must be present"*. The restore path always
  sends a position (`position` is accepted; it defaults to the end).

The archive response reports `previousListId`, which is the argument to pass to
`restoreToListId` later. Archiving an already-archived card does not move it
again: it answers `alreadyArchived: true` and names the column it came from.

### `planka_move_list_cards`

Moves **every** card of one column into another.

```json
{
  "fromListId": "3234567890123456789",
  "toListId": "4234567890123456789",
  "boardId": "2234567890123456789"
}
```

Planka has a bulk endpoint, `POST /api/lists/:id/move-cards`, and it is far
narrower than its name: `server/api/controllers/lists/move-cards.js` in 2.2.1
refuses everything except archiving a whole closed column.

```js
if (list.type !== List.Types.CLOSED)      throw NOT_ENOUGH_RIGHTS;   // 403
if (nextList.type !== List.Types.ARCHIVE) throw LIST_NOT_FOUND;      // 404
```

So an ordinary column-to-column call comes back **403 "Not enough rights"**,
which reads like a permission problem and is not one. This tool uses the bulk
call for the single case it accepts and moves card by card everywhere else, one
`PATCH` each, keeping each card's position so the relative order survives.
`strategy` says which path ran: `"bulk"` or `"perCard"`.

Both columns are counted before and after, and success is only claimed when the
numbers add up:

```json
{
  "success": true,
  "verified": true,
  "fromListId": "3234567890123456789",
  "toListId": "4234567890123456789",
  "strategy": "perCard",
  "moved": 3,
  "fromRemaining": 0,
  "toTotal": 8,
  "expectedTotal": 8
}
```

| Field | Meaning |
|---|---|
| `strategy` | `bulk` (closed → archive, one call) or `perCard` (one PATCH per card) |
| `moved` | Cards that actually left the source column |
| `failed` | Cards whose PATCH was rejected, with the reason. Present only on a partial move |
| `toCountUnavailable` | The destination is the archive, which Planka will not show; only the source could be counted |

`verified: false` with `isError` means the counts disagree — read both columns
before retrying. An already empty source is not an error (`moved: 0`). A source
column Planka refuses to show (`archive`, `trash`, or an id that does not exist)
is rejected with a message that says so. `PLANKA_PROTECTED_LIST_IDS` guards both
ends, so a protected column can be neither filled nor drained.

## Deprecated aliases

Seven names are kept alive only so callers written against them keep working.
They add no behaviour: each routes its arguments to the tool that replaced it.

| Deprecated | Use instead |
|---|---|
| `planka_list_cards` | `planka_find_cards` with `listId` |
| `planka_list_lists` | `planka_board_summary` with `cardsFrom: []` |
| `planka_manage_labels` | `planka_create_label` · `planka_update_label` · `planka_delete_label` |
| `planka_manage_lists` | `planka_create_list` · `planka_update_list` · `planka_delete_list` |
| `planka_manage_comment` | `planka_update_comment` · `planka_delete_comment` (and `planka_create_comment`) |
| `planka_add_comment` | `planka_create_comment` |
| `planka_get_board` | `planka_board_summary` + `planka_find_cards` |

**Why they were split.** A single tool with an `action` enum cannot express
"`boardId` is required when `action` is `create`" in JSON Schema. So each
`manage_*` tool carried 20-40 lines of hand-written "which field does this
action need?" checks — and a forgotten branch is exactly how `update` with only
an id shipped an empty `PATCH` that Planka answered `200` to. One tool per
action puts the answer back in `required`, where the client enforces it before
the call is made and the server's generic presence check covers the rest.

The aliases borrow their target's `required` at dispatch time, so
`planka_manage_labels` with `action: "update"` and no `labelId` is refused with a
message naming `planka_update_label` rather than sending an empty write.

They also borrow their target's **access policy**: `planka_manage_lists` with
`action: "delete"` is refused when `planka_delete_list` is in
`PLANKA_DISABLED_TOOLS`, and `planka_add_comment` is refused when
`planka_create_comment` is. An alias is a second name for a tool, never a way
around the configuration that switched it off.

**Hiding them.** `PLANKA_HIDE_DEPRECATED=true` drops all seven from `tools/list`,
which is worth ~6.8 kB (32,840 → 26,034 characters, measured on 0.3.0).
They stay callable: a model working from a cached tool list, or from a skill that
names one, gets the real behaviour instead of "unknown tool".

## When arguments are wrong

Invalid input is reported as an error result naming the tool, the field, what
the schema expected, and what actually arrived. Three cases are distinguished
on purpose, because the right correction differs.

A required field that never arrived is caught before the handler runs:

```text
Invalid arguments for planka_create_tasks: missing required field(s): tasks.
  - tasks (array) — Task names to create
Required fields for planka_create_tasks: cardId, tasks
Arguments received: {"cardId":"5234567890123456789"}
```

A field that arrived with the wrong shape or value reports the received value
alongside the field's declared type and description:

```text
Invalid arguments for planka_find_cards:
  - (whole arguments object): give at least one filter: labelName, query or listId (an unfiltered search would return the whole board) (received: {"boardId":"2234567890123456789"})
Required fields for planka_find_cards: boardId
Arguments received: {"boardId":"2234567890123456789"}
```

A response from Planka that does not match the expected shape is labelled as
such, so it is not mistaken for a bad argument:

```text
PLANKA returned an unexpected response shape while running planka_get_board.
This is an API/server mismatch, not a problem with the arguments:
  - item.name: Expected string, received null
```

Long values are clipped in these messages. An unknown tool name is answered with
the list of tools the server actually exposes.

## Raw verification

Unit tests validate schemas, request construction, and error formatting without a
network: run them with `npm test`.

The opt-in smoke test is the other half. It starts the built MCP server over stdio,
drives all 41 tools through real MCP calls, and independently queries the raw
Planka HTTP API after every mutation, so a tool that reports success on something
that never landed is caught here. It runs over 90 named checks.

```bash
export PLANKA_BASE_URL="https://planka.example.com"
export PLANKA_AGENT_EMAIL="agent@example.com"
export PLANKA_AGENT_PASSWORD="<YOUR_PASSWORD>"
export PLANKA_SMOKE_BOARD_ID="2234567890123456789"
npm run test:smoke
```

`npm run test:smoke` builds first, so it cannot silently test a stale `dist/`.

| Variable | Required | What it does |
|---|---|---|
| `PLANKA_BASE_URL` | yes | Planka origin, the same one the MCP client uses |
| `PLANKA_AGENT_EMAIL` | yes | Agent account email or username |
| `PLANKA_AGENT_PASSWORD` | yes | Agent account password |
| `PLANKA_SMOKE_BOARD_ID` | yes | Board to run against. Use a writable, non-critical board |
| `PLANKA_SMOKE_LIST_ID` | no | Column where the scratch card is created. Without it, the test picks a scratch-looking column, falling back to the first one |
| `PLANKA_SMOKE_FAIL_AFTER` | no | Injects a failure after check `<n>`, to prove that cleanup still runs. Use it to verify the safety net, not the tools |
| `PLANKA_MCP_ENTRY` | no | Server entry point. Defaults to `dist/index.js` |
| `VERBOSE` | no | Set to `1` to print each check's payload |

Everything the test creates is prefixed and deleted in a `finally`, and on
`SIGINT`/`SIGTERM` too. Cleanup goes over raw HTTP on purpose: when a signal kills
the test process, the MCP server child dies with it, so the safety net cannot
depend on the thing under test.

Exit codes: `0` all checks passed, `1` a check failed, `2` a configuration
problem.
