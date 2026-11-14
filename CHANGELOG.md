# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.3.1] - 2026-11-14

### Added

- `PLANKA_GET_CARD_COMMENTS` (`all` or a number): what `planka_get_card` reads
  when the call does not pass `withComments`. Opt-in — unset, nothing changes
  and the digest still carries no comments. An explicit `withComments`, `0`
  included, always wins. When the variable is set, the tool description, the
  `withComments` parameter text and the server `instructions` state the
  configured default instead of "NO comments unless asked". A value that is
  neither `all` nor a whole number is a configuration error. Suite: 296 → 304
  tests.

## [0.3.0] - 2026-09-03

### Highlights

- **Every write is verified.** The server writes, re-reads the entity and
  reports what the re-read says — never what was asked for. `success` mirrors
  `verified` and nothing else: "I could not check" now answers `success: false`
  with `isError` and names the parameter that would make the check possible.
- **API key authentication and a real access policy.** `PLANKA_API_KEY` replaces
  the login (no token refresh, no sign-in rate limit), and seven environment
  variables scope what the server may see and touch: default board, board and
  project allowlists, read-only mode, disabled tools, protected columns, hidden
  deprecated tools.
- **`instructions` and annotations on the handshake.** The shared guidance is
  stated once instead of 41 times, every tool publishes a title and all four MCP
  behaviour hints explicitly, and the eleven tools that lose data carry Claude
  Code's `requiresUserInteraction` prompt.
- **Reads return digests, and say what they clipped.** Descriptions are off
  unless asked for, results are capped, and every scoped read reports
  `total`/`returned`/`hasMore`/`nextOffset`, so a clipped answer is never
  mistaken for a complete one. `planka_get_board` went 56 k → 17 k characters.
- **Eight new tools**: `planka_board_summary`, `planka_find_cards`,
  `planka_get_activity`, `planka_list_users`, `planka_set_card_members`,
  `planka_duplicate_card`, `planka_archive_card`, `planka_move_list_cards`.
- **The three `manage_*` tools are split into one tool per action** (32 → 41
  tools) so `required` finally means something, with the old names kept as
  deprecated aliases that route to the replacement — and that now inherit the
  replacement's access policy.
- **Ships as a Claude Code and Codex plugin**, with MCP resources and prompts,
  a `planka-mcp init --client` installer, and a preflight hook.
- **Breaking changes**: `success` is no longer `true` on an unverified write;
  `planka_list_cards` and `planka_list_lists` are deprecated (still callable);
  `withDescription` and `labelFilter` are still accepted but no longer announced
  in `inputSchema`; `planka_find_cards` digests now carry `labelIds`;
  `planka_get_card` returns `listName: null` plus `listNameUnavailable` instead
  of omitting the field.

### Fixed — adversarial review before release

- **`PLANKA_DEFAULT_BOARD_ID` no longer breaks the tool the instructions tell
  you to call first.** The runtime presence check validated against the raw
  registry schema while `tools/list` advertised the policy-applied one, so
  `planka_board_summary {}` was refused for a missing `boardId` the listing said
  was optional — on the five tools that declare it (`board_summary`,
  `list_lists`, `get_board`, `create_list`, `create_label`). Both sides now go
  through `effectiveInputSchema(tool, policy)`.
- **Deprecated aliases no longer bypass `PLANKA_DISABLED_TOOLS`.**
  `planka_manage_lists {action:"delete"}` reached a disabled
  `planka_delete_list`, and `planka_add_comment` a disabled
  `planka_create_comment`. Both now consult the target's policy before
  dispatching.
- **No more `{"success":true,"verified":false,"message":"… not confirmed"}`.**
  That was the default branch of `update_task` and `delete_task` without
  `cardId`, of `delete_attachment` when Planka did not echo the card, and of the
  deletes whose response body does not parse. Unverified writes answer
  `success: false` + `isError` and say what to pass; `update_task` without
  `cardId` also labels its fields as `taskFromWriteEcho`.
- **The test guarding `WRITE_TOOL_NAMES` could not fail.** It compared a set
  against its own complement. It now asserts, tool by tool, that membership
  matches the `readOnlyHint` the tool advertises — the only net that stops the
  next write tool from staying visible under `PLANKA_READ_ONLY=true`.
- **`PLANKA_PROTECTED_LIST_IDS` protects the cards, not just the column.**
  `move_card`, `archive_card` and `delete_card` refused to write *into* a
  protected column but happily emptied it one card at a time. The origin column
  is now checked too — with no extra read on deployments that set no protected
  list.
- **`planka_add_attachment` goes through `verifiedWrite`.** A failed re-read
  used to return an error without the attachment id, and the natural retry
  uploaded the file twice.
- **Four hand-written `verified: true` are gone.** `set_card_labels` and
  `set_card_members` report through `writeResult` with a flag derived from their
  own re-read; the two "nothing to do" states say which read backs the claim.
- **`planka_create_card` verifies what it wrote** (`name` and `listId`, not just
  the id it re-read by), and a label that failed to attach comes back as
  `{labelId, reason}` instead of a bare id — a 403 on the board and a wrong
  labelId are otherwise indistinguishable.
- **`planka_find_cards` digests carry `labelIds`**, so
  `find_cards → set_card_labels` no longer needs a `planka_board_summary` in
  between, and multi-column results carry `listId` next to `listName`.
- **A 404 on the board keeps its diagnosis** when `/api/projects` is unreadable
  too: the original error, with its hint, is re-thrown instead of replaced by a
  bare "Board not found".
- **`planka_create_list` and `planka_create_label` check the board allowlist
  explicitly**, instead of relying on a lower layer to do it.
- `planka_get_card` returns `listName: null` with `listNameUnavailable` when the
  board could not be read; a 404 on `/api/users/me` no longer claims `me` should
  be a `userId`; the HTML-instead-of-JSON error only blames an HTTP→HTTPS
  redirect when the URL was `http://` or the request was actually redirected;
  `planka_set_card_members` with names and no board says the problem was
  resolving a **name**; the `planka://labels/colors` resource points at
  `planka_create_label` / `planka_update_label` instead of the deprecated
  `planka_manage_labels`.

### Changed — `tools/list` cost

- `planka_list_cards` and `planka_list_lists` joined `DEPRECATED_TOOL_NAMES`,
  the 43-colour enum is announced once (on `planka_create_label`) instead of
  three times, `withDescription` and `labelFilter` are no longer announced, and
  the `boardId` description was cut. Measured over JSON-RPC against the built
  server: `tools/list` **34 477 → 32 840** characters, and **29 821 → 26 034**
  with `PLANKA_HIDE_DEPRECATED=true` (−22 % against the pre-release baseline).
  Nothing lost capability: every trimmed parameter is still accepted.

### Documentation

- `server.json` declares all thirteen environment variables the code reads;
  `PLANKA_MCP_PREFLIGHT` and `PLANKA_MCP_COMMAND` are documented in both READMEs;
  `docs/tools.md` lists the eleven `requiresUserInteraction` tools, the complete
  data-losing set, `position` on `planka_create_label`, and the shared digest
  vocabulary; `scripts/sync-identity.mjs` now also stamps the two `SKILL.md`
  versions, so `check:identity` catches them when they go stale.

### Added

- **The three `manage_*` tools are split, one tool per action: 32 → 41.**
  `planka_create_label` / `planka_update_label` / `planka_delete_label`,
  `planka_create_list` / `planka_update_list` / `planka_delete_list`, and
  `planka_create_comment` / `planka_update_comment` / `planka_delete_comment`.
  Each declares a real `required` in its JSON Schema, so the client refuses an
  incomplete call before it leaves and the server's generic presence check does
  the rest. The `action` enum could not express "boardId is required when
  action=create", which is why every `manage_*` carried 20-40 lines of
  hand-written guards — and a forgotten branch is exactly how an `update`
  carrying only an id shipped an empty `PATCH` that Planka answered `200` to.
  All nine reuse the existing operations and `verifiedWrite`/`verifiedDelete`,
  and answer with the same digest (`{id, name, …, verified}`) as before.
  `planka_delete_list` says in its own description that it deletes every card in
  the column.
- `PLANKA_HIDE_DEPRECATED=true` drops the deprecated tools from `tools/list`:
  `planka_manage_labels`, `planka_manage_lists`, `planka_manage_comment`,
  `planka_add_comment`, `planka_get_board` and — added at the end of this
  release — `planka_list_cards` and `planka_list_lists`. Measured on `tools/list`
  at 0.3.0: **32 840 → 26 034 characters** (−6 806, −20.7 %). They remain
  callable, so a model working from a cached list or from a skill that names one
  still gets the real behaviour instead of "unknown tool". Default `false`.
- 35 unit tests for the split (`tests/unit/split-manage.test.ts`): the happy path
  of each new tool against a mocked re-read, the `nothing to do` guard, a delete
  that did not delete, `required` enforcement per tool, every alias dispatching,
  and the `PLANKA_HIDE_DEPRECATED` filter. Suite: 189 → 224 tests.
- **The repository is now a plugin, for Claude Code and for Codex.**
  `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` install the MCP
  server plus the two `workflow/skills/` in one step, and the repo is its own
  marketplace (`.claude-plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`):
  `/plugin marketplace add omnicoreos/planka-mcp` → `/plugin install planka@planka-mcp`.
  `userConfig` asks for the base URL and the API key when the plugin is enabled
  and stores the key in the OS keychain — the manifest itself holds no secret,
  only `${user_config.*}` substitutions. Claude Code reads `.mcp.json`
  (`mcpServers`), Codex reads `.codex-plugin/mcp.json` (`mcp_servers`); the two
  files exist because the wrapper key differs and one file cannot be both
  without Codex reading a server literally named `mcpServers`. Validated with
  `claude plugin validate --strict`.
- **A `SessionStart` preflight** (`hooks/preflight.mjs`): catches a Node older
  than 18, a missing credential, an API key set together with email+password,
  and an `http://` base URL that a redirect would turn into a dropped POST body.
  Offline, silent when everything is fine, and it never exits non-zero — a
  broken preflight must not block a session. `PLANKA_MCP_PREFLIGHT=full` also
  spawns the server and waits for its banner.
- **MCP resources** (`src/resources.ts`): `planka://workflow/readme`,
  `planka://workflow/board-template`, `planka://workflow/skills/orchestrator`,
  `planka://workflow/skills/close-card`, `planka://gotchas/planka-2x` and
  `planka://labels/colors`. The first five are read from the tarball at runtime
  (resolved from `import.meta.url`, with a note pointing at the repository if an
  install trimmed them); the last is generated from `LabelColorSchema`, so the
  43 colors can never drift from what the tools validate. A resource costs
  nothing until it is read, which is where the 25 000 chars of `workflow/` and
  `docs/` belong — not in `instructions`, which every session pays for.
- **MCP prompts** (`src/prompts.ts`): `planka-open-session`,
  `planka-close-card` and `planka-board-triage`, surfaced by Claude Code as
  `/mcp__planka__…`. Each orders the calls and says what to look at in the
  answers, without restating what tool descriptions already say. Arguments are
  optional except `cardId`, and a missing required argument is refused by name.
- **`planka-mcp init --client claude|codex|cursor|vscode|print`**: one setup
  command for every client. Emits `claude mcp add`, a `[mcp_servers.planka]`
  TOML block, a merged `~/.cursor/mcp.json` plus an "Add to Cursor" deeplink,
  and a `.vscode/mcp.json` whose key is a `promptString` input rather than a
  literal. Every emitter merges non-destructively — an existing `planka` entry
  is reported and left alone — files written into `$HOME` get mode `0600`, and
  no printed snippet or deeplink ever carries a real credential. Before writing
  it runs one authenticated `GET /api/users/me`, which is the check that catches
  a base URL pointing at the SPA instead of the API. `--dry-run` writes nothing;
  `--client print` needs no credentials at all.
- README and README.es: an **Install** table with a one-liner per client
  (Claude Code plugin and server, Codex, Cursor badge, VS Code badge, `init`)
  and a **Resources and prompts** section.

- **`planka_get_card` is a digest with detail on demand.** By default it returns
  counts and names instead of the whole record: `listName` next to `listId`,
  label **names** with their ids, `members`, tasks as `{done, total, lists:[…]}`
  with one entry per checklist, `attachmentsCount`, Planka's own `commentsTotal`,
  `dueDate`/`isDueCompleted`/`isClosed`/`updatedAt`, and a 200-char
  `descriptionPreview` (with `descriptionChars`, `descriptionTruncated`).
  New parameters: `detail: "digest" | "full"`, `withComments` (a number or
  `"all"`), `descriptionChars`. Measured on a real card with 6 comments and 5
  attachments: **1275 chars against 13 187** for the old always-everything
  answer — 90 % less, with the column name and the label names it never had.
- `planka_get_comments` paginates honestly: `limit` (default 20, max 50),
  `beforeId` as an in/out cursor, `hasMore`, `nextBeforeId`, `order`
  (`"asc"` — oldest first — by default) and `all: true` with a 10-page ceiling
  that reports `truncated`. `getComments()` / `getCommentsPage()` in
  `src/operations/comments.ts` are the operations behind it.
- `getBoardNames()`: the one board read that resolves a card's `listId` and
  `labelId`s to names, memoized for 60 s. Best effort by design — a board that
  cannot be read costs the names, never the card.
- 23 unit tests: digest vs full, `withComments` 0/N/`"all"` against a mocked
  two-page endpoint, checklists that stay apart, members, the description
  preview, the comment cursor and its ceiling, and one per error branch.
  Suite: 109 → 132 tests.
- **Eight new tools, 24 → 32.** All of them answer with a digest and every write
  re-reads before reporting:
  - `planka_card_history` and `planka_board_activity` read Planka's activity log
    (`/api/cards/:id/actions`, `/api/boards/:id/actions`) and turn each event
    into one human line — "moved from X to Y", "added member Z", "completed task
    T". `board_activity` walks pages backwards to a `since` date (5-page cap,
    reported as `truncated`) and groups the result by card. Both say, when they
    return nothing, that Planka logs only creation, moves, member changes and
    task completion — never comments, renames or description edits.
  - `planka_set_card_members` assigns and unassigns people, accepting user IDs
    or names, and reports `finalMemberIds` read back from the card. The mirror
    of `planka_set_card_labels`, argument for argument.
  - `planka_list_users` lists who can be assigned, falling back to the board's
    own members when `GET /api/users` is refused (it is admin-only) and saying
    so in `source`. Emails only with `detail: "full"`.
  - `planka_whoami` names the account, its board role, the Planka version and
    the local access policy — the first call to make when a `404` makes no
    sense. Warns when the instance is not a Planka 2.x.
  - `planka_duplicate_card` copies a card with its tasks, labels and members
    (attachments are not copied) and reports the counts from re-reading the copy.
  - `planka_archive_card` archives into the board's hidden `archive` list and
    restores with `restoreToListId`. Verified by the card's column: `isClosed`
    does NOT change on archive, so it proves nothing.
  - `planka_move_list_cards` empties one column into another, counting both
    columns before and after. It uses Planka's bulk endpoint only for the case
    that endpoint accepts (a closed column into the archive) and moves card by
    card otherwise, preserving each card's position; `strategy` reports which.
- `src/operations/card-brief.ts`: a permissive card read used for verification.
  An archived card comes back with `position: null`, which the strict card
  schema rejects — the archive tool could not have verified its own write
  without it. It also exposes `cardMemberships`, which no other read did.
- `countListCards()` and `moveListCards()` in `src/operations/lists.ts`, plus
  `src/operations/{actions,members,users,archive,duplicate}.ts`.
- The four new write tools are in `WRITE_TOOL_NAMES`, so `PLANKA_READ_ONLY`
  hides them, and `planka_archive_card` and `planka_move_list_cards` carry
  `anthropic/requiresUserInteraction`: both change what a whole column looks
  like.
- 32 unit tests for the new surface (fetch mocked): one summary per event type,
  the `since` sweep and its cursor, the 403 fallback of the user roster, the
  archive-list resolution, and the two failures that must not read as success —
  a membership that never landed and a bulk move whose counts do not add up.
  Suite: 109 → 141 tests.
- Smoke: the new tools are exercised end to end and cross-checked against the
  raw API — history after a real move and a real assignment, a duplicate, an
  archive/restore round trip, and a bulk move between the smoke's temporary
  column and its working column. Every card it creates is deleted in the
  `finally`.
- Server instructions gained one line: `planka_board_activity` is the call to
  make when resuming a board someone else left.

- `src/operations/verify.ts`: `verifiedWrite`, `verifiedDelete` and `goneOn404`,
  the single implementation of "write, re-read, report what landed". Until now
  the pattern lived hand-copied in two places and was missing from eleven writes.
- Every write reports `verified: true|false`, and `isError` when the re-read
  contradicts it or could not be made. New response fields: `verificationError`,
  `verificationUnavailable`, `partialFailure`, `notLanded`.
- `planka_move_card` accepts `boardId`, so a card can finally be moved between
  boards (the operation supported it; the tool did not expose it).
- `planka_update_task`, `planka_delete_task` and `planka_delete_attachment`
  accept an optional `cardId`, which is what makes their verification possible
  (Planka 2.x has no GET for a single task).
- `getCardLight()`: a card read without its comments, used for verification and
  by `planka_set_card_labels`, which was pulling every comment of a card twice
  only to compare label ids.
- 19 unit tests for the false greens: comments endpoint failing, partial task
  creation, deletes that do not delete, no-op PATCHes, a move that did not move,
  and labels that never attached. Suite: 45 → 64 tests.
- Smoke: a REAL move between two columns (temporary column created, card moved
  there and back, both directions cross-checked against the raw API) and
  `verified: true` assertions on every write.

- **Board reads redesigned around one principle: a small digest by default, the
  detail through parameters.** `planka_find_cards` is now the single read over
  cards and takes `listId`, `listName`, `query`, `labelName` (alias
  `labelFilter`), `labelIds`, `userIds`, `withLabels`, `detail`
  (`"digest" | "full"`), `withDescription`, `descriptionChars`, `limit` and
  `offset`.
- `planka_find_cards` with a `listId` reads the column through
  `GET /api/lists/:id`: **one request, no cursor**, so `total` is the real size
  of the column and the answer carries `truncated: false`. A 159-card column
  went from five requests to two (one with `withLabels: false`).
- The card digest now carries `members`, `commentsTotal` and `updatedAt`, and
  `detail: "full"` returns every field Planka gave, description included.
- `planka_board_summary` absorbs `planka_list_lists`: `cardsFrom: []` answers
  columns and labels with no cards. It also reports `totalCards`.
- `warnings` on `planka_board_summary` and `planka_find_cards`: a `cardsFrom`
  entry, a `listName` or a `highlightLabel` that matches nothing comes back
  naming what does exist, instead of an empty result that reads like "there is
  nothing there".
- `PLANKA_SUMMARY_DECISION_LISTS` and `PLANKA_SUMMARY_HIGHLIGHT_LABEL`: the
  board vocabulary that used to be hardcoded in Spanish inside the server now
  comes from the environment, and defaults to nothing.
- `planka_get_structure` takes `withLists` (default `true`). With `false` the
  whole structure is ONE request instead of one board read per board — 203
  characters against 696 on the reference instance.
- `planka_get_board` takes `limit` (default 50) and reports `totalCards`,
  `returnedCards` and `truncated`.
- `excludesArchived: true` on every read derived from the board show, and a new
  gotcha documenting why: `GET /api/boards/:id` carries no archive and no trash
  cards, and there is no way to ask for them.
- `query` semantics are now Planka's own: several words are ANDed, and a leading
  `/` makes the rest a case-insensitive regular expression. A broken regex is
  reported instead of matching nothing.
- 18 unit tests for the redesigned reads (list path, digest vs full, aliases,
  warnings, derived page size, `excludesArchived`, `withLists`). Suite: 116 →
  134 tests.

### Deprecated

- **`planka_get_board`.** Its description now starts with
  `DEPRECATED: use planka_board_summary + planka_find_cards`. It stays
  functional, and it is capped: 56,112 → 17,215 characters on the reference
  board.
- `planka_list_lists` and `planka_list_cards` are kept as **aliases** —
  respectively `planka_board_summary` with `cardsFrom: []` and
  `planka_find_cards` with `listId`. Same implementation, same response shape;
  the tool count and every tool name are unchanged.

### Changed

- **The old names survive as deprecated aliases.** `planka_manage_labels`,
  `planka_manage_lists`, `planka_manage_comment` and `planka_add_comment` keep
  working unchanged; each is a ten-line dispatcher that routes `action` to the
  tool that replaced it and borrows that tool's `required` (so
  `manage_labels action:update` with no `labelId` is refused with a message
  naming `planka_update_label`). Their descriptions open with `DEPRECATED:`.
- The nine new tools are in `WRITE_TOOL_NAMES` (18 → 27), so `PLANKA_READ_ONLY`
  hides them, and in `src/tools/annotations.ts`; the three `delete_*` carry
  `anthropic/requiresUserInteraction`.
- The smoke suite drives labels, lists and comments through the new tools and
  keeps one check per alias, plus one that the alias borrows its target's
  `required`.
- `scripts/setup.sh` is now an alias for `init --client claude`. The guided
  installer that also picks or creates a board and runs the full write smoke
  stays available as `node scripts/setup.mjs`.
- `workflow/skills/*/SKILL.md`: frontmatter trimmed to the portable
  agentskills.io subset (`version:` moved under `metadata:`), and the bodies
  updated to the current read surface — `board_summary` as the only opening
  read, `find_cards` with a `listId` for a whole column, `get_card` as a digest
  with `withComments`, `board_activity` when resuming someone else's work,
  `verified` on every write, and `get_board`/`list_lists`/`list_cards` named as
  deprecated aliases.
- `scripts/sync-identity.mjs` also generates the version pin in `.mcp.json`,
  `.codex-plugin/mcp.json` and both plugin manifests, and exports
  `PACKAGE_NAME`. A pin that drifts would install the old server from a new
  plugin, silently; `npm run check:identity` now fails the build instead.
- `package.json` ships `.claude-plugin`, `.codex-plugin`, `.agents`,
  `.mcp.json` and `hooks` in the tarball.
- 36 unit tests for the new surface (resources list/read and mime types,
  prompts, the `init` emitters and merges, and the plugin manifests, which
  nothing else type-checks).

- **`planka_get_card` no longer returns comments by default.** They were the
  biggest and least predictable part of the answer and most reads do not need
  them; `withComments` brings them back, and the digest always says how many
  exist (`commentsTotal`). Comments come back **oldest first**, the order the
  thread was written.
- `commentCount` in `planka_get_comments` is documented and reported as what
  *that response* carries, never as the card's total — Planka serves comments 50
  at a time and ignores `?limit`/`?page`, so the old field was a page size
  wearing a total's name.
- Errors say what to do next: a **403** names the likely cause (the agent user is
  not a board member, or is a viewer where an editor is needed) and warns that
  Planka answers 404 for it too; a **404** keeps Planka's own message and names
  the kind of ID the path expected (`labelId`, `listId`…); a **401** that
  survives the automatic retry points at `PLANKA_API_KEY` /
  `PLANKA_AGENT_PASSWORD` instead of at the session; **HTML instead of JSON**
  names the SPA catch-all and, on a write, warns that it MAY have landed;
  **network failures** carry the base URL.
- `planka_view_attachment` on a card with no attachments says there is nothing
  to view, instead of asking for an `attachmentId` and listing "none".
- `CardIncludedSchema` covers what Planka 2.2 really sends (`cardMemberships`,
  `users`, `customFields`, `customFieldValues`) and the card schema tolerates
  `commentsTotal`, `isDueCompleted`, `isClosed` and `stopwatch`. Enums stay open
  strings on read paths.
- **Read response shapes changed** (the tool names did not): `planka_list_cards`
  answers `matches` where it used to answer `cards`, `warning` (a string) became
  `warnings` (an array) on `planka_find_cards`, the per-card `list` is now
  `listName` and appears only when the result spans several columns, and
  `planka_board_summary` no longer defaults to Spanish column and label names.
- **A `200` is no longer a success.** `planka_create_card`, `planka_update_card`,
  `planka_move_card`, `planka_delete_card`, `planka_create_tasks`,
  `planka_update_task`, `planka_delete_task`, `planka_manage_labels`,
  `planka_add_comment`, `planka_manage_comment`, `planka_manage_lists` and
  `planka_delete_attachment` now re-read before reporting.
- `planka_create_card` counts the tasks and labels **that are on the card**, not
  the ones requested, always returns `card.id` (even when a follow-up step
  fails, so a retry does not duplicate the card), and errors when every
  requested label failed to attach.
- `planka_update_card`, `planka_update_task`, `planka_manage_labels update` and
  `planka_manage_lists update` reject a request carrying only an id
  (`nothing to do`) instead of sending an empty PATCH and reporting success.
- `planka_manage_lists` says in its description and in the docs that deleting a
  list deletes every card in it.
- `PlankaClient.delete()` returns the response body instead of `void`: Planka
  2.x echoes the deleted item, and its parent id is what makes the confirmation
  read possible.
- Label `color` is a real JSON Schema `enum` of the 43 colors instead of a
  sentence in the description, so the client rejects a bad color before the
  call. (Measured: 599 chars against 580 — this is a correctness win, not a
  token saving.)
- Tool payloads are serialized without indentation (`JSON.stringify(x)`),
  27–46 % fewer characters on the read-heavy tools at zero information cost.
- Tool descriptions are shorter. The prose that was repeated across many of them
  — that IDs are strings, that `planka_get_board` is the expensive call, the
  meaning of `total`/`returned`/`hasMore` — now lives in the server
  instructions, as the spec asks. The sum of all descriptions went from 3658 to
  2093 characters; no `inputSchema` changed.
- `getToolDefinitions()` now propagates `title`, `annotations` and `_meta`. It
  previously mapped only name, description and schema, which would have dropped
  them from `tools/list` without any error.

### Fixed

- `planka_move_list_cards` answered 403 "Not enough rights" on any ordinary
  column-to-column move. `POST /api/lists/:id/move-cards` is not the general
  bulk move its name suggests: Planka 2.2.1 refuses anything but a `closed`
  source into an `archive` destination, and the refusal reads like a permission
  problem. The tool now falls back to one PATCH per card, keeps each card's
  position, and reports which path it took plus any card that refused to move.
- Restoring a card out of the archive sent only `listId`, and Planka answered
  *"Position must be present"* — an archived card has `position: null`. The
  restore path now always sends a position. Caught against a real Planka 2.2.1,
  not in a mock.
- `getCardsForList` derives Planka's page size from the first response instead
  of assuming 50. An instance answering 20 per page used to stop on page one and
  report a third of a column as the whole of it, with `truncated: false`.
- The card schema accepts `commentsTotal`, `isClosed` and `isDueCompleted`,
  including the `null` Planka actually sends — reading them as booleans would
  have made every board read fail.
- `planka_find_cards` no longer returns `listId` **and** `list` on every match:
  a search scoped to one column names it once, at the root.
- `planka_get_card` no longer swallows a failing comments endpoint into
  `comments: []`. A 403, a timeout or an HTML answer now surfaces as an error:
  "this card has no comments" and "I could not read them" are different facts,
  and on a board whose memory lives in the comments the difference is expensive.
- Server instructions in the `initialize` handshake
  (`InitializeResult.instructions`, `src/instructions.ts`). Claude Code injects
  them into the session system prompt and Codex CLI reads them alongside the
  tool list, so the guidance shared by many tools is stated once: open with
  `planka_board_summary` and never `planka_get_board`, IDs are strings of digits
  that come from `planka_get_structure` or `planka_board_summary`, read every
  comment on a card before acting, reads return digests with
  `total`/`returned`/`hasMore`, writes report `verified` and `finalLabelIds`,
  and Planka answers `404` where it means `403`. Budgeted at 1500-2500
  characters, with the first 512 self-contained for clients that truncate.
- Tool annotations on all twenty-four tools: a display `title` plus
  `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, every
  field written out rather than inherited. The spec defaults are pessimistic, so
  without them a conformant client had to treat `planka_get_comments` as being
  as destructive as `planka_delete_card`.
- The two Anthropic `_meta` keys Claude Code actually acts on:
  `anthropic/requiresUserInteraction` on `planka_delete_card`,
  `planka_delete_task`, `planka_delete_attachment`, `planka_manage_comment`,
  `planka_manage_lists` and `planka_manage_labels`, which forces the permission
  prompt even under an `allow` rule; and `anthropic/maxResultSizeChars` on
  `planka_view_attachment`, so a 3 MB base64 image is not clipped.
- Tests that keep all of the above honest: every registered tool must have an
  annotations entry (a new tool without one fails the suite), the tools marked
  as needing confirmation must carry the `_meta` flag, the instructions must fit
  their budget, and `tools/list` must return a fixed, snapshotted tool order.
- **API key authentication.** `PLANKA_API_KEY` sends `X-Api-Key` on every
  request — JSON calls, multipart uploads and binary attachment downloads alike
  — with no login round-trip and no token refresh. It also sidesteps Planka's
  sign-in rate limit of ten logins per identity per minute, which several agents
  starting at once will otherwise hit. Configuration is now API key XOR
  email/password: setting both is refused rather than guessed, because Planka
  reads `Authorization` first and silently ignores `x-api-key` when both arrive.
- **Access policy driven by environment variables**, in `src/config/policy.ts`:
  `PLANKA_DEFAULT_BOARD_ID`, `PLANKA_ALLOWED_BOARD_IDS`,
  `PLANKA_ALLOWED_PROJECT_IDS`, `PLANKA_READ_ONLY`, `PLANKA_DISABLED_TOOLS` and
  `PLANKA_PROTECTED_LIST_IDS`. Allowlists are by id, never by name: a name is one
  edit away from being someone else's.
- **`boardId` is now optional** on every tool that takes one, whenever
  `PLANKA_DEFAULT_BOARD_ID` is configured. It is removed from the tool's
  `required` list and the description says where the default comes from, so an
  agent stops calling `planka_get_structure` just to recover an id that never
  changes.
- **`PLANKA_READ_ONLY` and `PLANKA_DISABLED_TOOLS` hide tools and refuse them.**
  Hidden tools disappear from `tools/list`, and calling one anyway returns an
  error that names the variable responsible and says not to retry — hiding alone
  is not enough for a client working from a cached list.
- **Allowlist filtering in `planka_get_structure`**, so an agent never sees the
  boards and projects it may not touch, and a `projectId` that does not exist now
  answers with the visible projects instead of an empty array.
- `server.json`: the new environment variables, plus `title`, `websiteUrl` and
  `icons` for the MCP Registry listing. `PLANKA_AGENT_EMAIL` and
  `PLANKA_AGENT_PASSWORD` are no longer marked required.
- README (English and Spanish): *Authentication* — including the four-step recipe
  for a scoped `boardUser` with an API key — and *Scoping the server*, with the
  three-layer model and the variable matrix. New entries in
  `docs/troubleshooting.md` for every new error message.
- Binary attachment downloads now retry once on a 401 with a fresh token, the way
  every other request already did. Before, an expired token during a download
  surfaced as a bare authentication failure.
- A `200` carrying the SPA's HTML instead of JSON — what Planka answers for any
  path it does not route, and what an `http://` base URL redirected to `https://`
  ends up producing — is now reported as such on every request, not only during
  login.

## [0.2.0] - 2026-08-24

### Added

- Nine tools, bringing the server to twenty-four.
- Attachments: `planka_add_attachment` uploads a local file and re-reads the card
  to confirm it landed, `planka_get_attachments` lists what a card holds,
  `planka_view_attachment` returns content — images as MCP image content up to
  3 MB, text inline up to 50 KB, anything else as metadata and a URL — and
  `planka_delete_attachment` removes one.
- `planka_manage_comment`, to edit or delete an existing comment.
- Scoped reads that answer a narrower question than `planka_get_board` and return
  proportionally less text: `planka_list_lists` (columns and card counts),
  `planka_board_summary` (columns, labels, and the cards awaiting a decision),
  `planka_list_cards` (one column, paginated), and `planka_find_cards` (search by
  label, text, or column). Measured on a board of 100 cards, they return between
  16 and 56 times less than `planka_get_board`.
- Honest clipping on every scoped read: `total`, `returned`, `hasMore`, and
  `nextOffset`, so a partial answer is never mistaken for a complete one.
- Actionable input errors. A rejected call now names the tool, the field, the
  declared type and description, what was expected, and what actually arrived.
  Missing required fields are caught before the handler runs, and a Planka
  response that does not match the expected shape is labelled as an API mismatch
  rather than an argument problem.
- Diagnosis for a project ID passed where a board ID belongs. Both are strings of
  digits, and Planka answers the mistake with a bare 404. The server now resolves
  it automatically when the project has exactly one board, and otherwise explains
  what the ID is and lists the boards it could have meant.
- Documentation for the smoke test's optional environment variables:
  `PLANKA_SMOKE_LIST_ID` and `PLANKA_SMOKE_FAIL_AFTER`, which injects a failure to
  prove the cleanup path still runs.

### Changed

- The smoke test grew from a first-failure abort over seven tools to 64 named
  checks covering all twenty-four end to end, each write cross-checked against the
  raw Planka HTTP API. Cleanup runs in a `finally` and on `SIGINT`/`SIGTERM`, over
  raw HTTP so the safety net does not depend on the component under test.
- `npm run test:smoke` builds first, so it can no longer test a stale `dist/`.
- Internal operation signatures take a single input object everywhere, validated
  through one shared path. No tool payload changed.

### Fixed

- Long columns truncated in silence. `GET /api/lists/:id/cards` pages at 50 and
  ignores `?limit=`; its cursor is composite (`before[id]` plus
  `before[listChangedAt]`). A column of 77 cards returned 50 with no indication
  that 27 were missing. The cursor is now followed, and a read that still could
  not be completed reports `truncated: true` instead of looking complete.

## [0.1.0] - 2026-08-21

### Identity

- Working repository name: `planka-mcp`.
- Working npm identity: `@omnicoreos/planka-mcp`.
- `project.identity.json` is the source of truth for repository, package, binary,
  MCP Registry, and repository URL names. After changing it, run
  `npm run sync:identity`.

### Added

- Fifteen stdio MCP tools for Planka projects, boards, cards, tasks, comments,
  labels, and lists.
- Guided macOS/Linux setup with authentication validation, board selection,
  optional board bootstrap, Claude Code configuration, and real smoke verification.
- Unit tests for schemas, parsing, request construction, the dedicated comments
  endpoint, label criteria deletion, label aliases, list creation, and bootstrap
  idempotency.
- Opt-in smoke test that executes MCP tools and verifies every mutation against the
  raw Planka API before deleting its temporary card.
- Optional board, director/worker, and worktree methodology.
- English and Spanish documentation.

### Fixed from upstream

- Empty comments on Planka 2.x.
- Whole-board failures caused by new label colors.
- Silent no-op `labelIds` requests.
- Incorrect label-removal URL.
- Missing `type` in list creation.
- Internal `archive` and `trash` list types rejected on board reads.
