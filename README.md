# planka-mcp

Control a Planka 2.x board from Claude Code through 41 MCP tools.
Writes are re-read and verified, so a reported success matches the board.
An optional workflow turns that board into durable memory for agent work.

[Leer en español](README.es.md)

```text
You talk to Claude Code
          │
          ▼
  planka-mcp (stdio) ─── HTTPS + JSON ───▶ Planka 2.x
          │                                  │
          └──── reads the result back ◀──────┘
```

> [!WARNING]
> The old `@gogogadgetbytes/planka-mcp` package can report success while doing
> nothing on Planka 2.x. Read [the five silent-failure gotchas](docs/planka-2x-gotchas.md)
> before replacing an existing installation.

## New to MCP? Read this first

MCP is a standard that lets Claude Code call tools provided by another program.
This repository runs a small local program that translates those tool calls into Planka API requests.
It needs Planka credentials because it acts as a dedicated Planka user, not as Claude itself.
The credentials stay on your machine and are never written into the project-level `.mcp.json` file.
Claude Code loads MCP servers when a session starts, so restart it after setup or configuration changes.

## Requirements

- Node.js 18 or newer and `npx`
- A reachable Planka 2.x instance
- A dedicated Planka user that can see the target project and board
- One MCP client: Claude Code, Codex CLI, Cursor or VS Code
- A project-manager role only if setup must create a board

Linux and macOS are supported. No Bun runtime is required.

## Install

One command per client. All of them run the published package with `npx`, so
there is nothing to clone and nothing to build.

| Client | One-liner |
|---|---|
| **Claude Code** (plugin: MCP + skills + preflight) | `/plugin marketplace add omnicoreos/planka-mcp` then `/plugin install planka@planka-mcp` |
| **Claude Code** (server only) | `claude mcp add --scope user --transport stdio planka --env PLANKA_BASE_URL=https://planka.example.com --env PLANKA_API_KEY=<key> -- npx -y @omnicoreos/planka-mcp` |
| **Codex CLI** | `codex mcp add planka -- npx -y @omnicoreos/planka-mcp` (then add the `env` block, below) |
| **Cursor** | [![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=planka&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvbW5pY29yZW9zL3BsYW5rYS1tY3AiXSwiZW52Ijp7IlBMQU5LQV9CQVNFX1VSTCI6Imh0dHBzOi8vcGxhbmthLmV4YW1wbGUuY29tIiwiUExBTktBX0FQSV9LRVkiOiI8eW91ci1wbGFua2EtYXBpLWtleT4ifX0=) |
| **VS Code** | [![Add to VS Code](https://img.shields.io/badge/VS_Code-Add_planka-0098FF)](https://insiders.vscode.dev/redirect/mcp/install?name=planka&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40omnicoreos%2Fplanka-mcp%22%5D%2C%22env%22%3A%7B%22PLANKA_BASE_URL%22%3A%22https%3A%2F%2Fplanka.example.com%22%2C%22PLANKA_API_KEY%22%3A%22%3Cyour-planka-api-key%3E%22%7D%2C%22type%22%3A%22stdio%22%7D) |
| **Any of them, guided** | `npx @omnicoreos/planka-mcp init --client claude\|codex\|cursor\|vscode\|print` |

The Cursor and VS Code links carry a placeholder key, never a real one: a
deeplink ends up in browser history. Both clients ask for the credential
themselves — VS Code through a `promptString` input, so the committed
`.vscode/mcp.json` holds no secret.

### `planka-mcp init`

```bash
npx @omnicoreos/planka-mcp init --client claude     # claude mcp add, user scope
npx @omnicoreos/planka-mcp init --client codex      # appends to ~/.codex/config.toml
npx @omnicoreos/planka-mcp init --client cursor     # merges ~/.cursor/mcp.json (0600) + prints the deeplink
npx @omnicoreos/planka-mcp init --client vscode     # writes .vscode/mcp.json with a secret prompt
npx @omnicoreos/planka-mcp init --client print      # prints every snippet, writes nothing
```

With a terminal attached it asks for what it needs; `--base-url`, `--api-key`,
`--board`, `--email` and `--password` make it non-interactive. Before writing
anything it runs one authenticated `GET /api/users/me`, which is what catches a
base URL pointing at the SPA instead of the API, or a credential that never
worked. `--dry-run` prints the exact change and touches nothing.

Every emitter merges: an existing `planka` entry is reported and left alone,
and the other servers in the same file are preserved. Files written into your
home directory get mode `0600`.

`./scripts/setup.sh` is an alias for `init --client claude`. The older guided
installer — the one that also picks or creates a board and runs the full
create/label/comment/delete smoke test — is still `node scripts/setup.mjs`.

### The Claude Code plugin

The plugin installs the MCP server, the two workflow skills, and a `SessionStart`
preflight that catches a missing credential or an `http://` base URL before the
first tool call:

```text
/plugin marketplace add omnicoreos/planka-mcp
/plugin install planka@planka-mcp
```

Claude Code asks for the base URL and the API key when the plugin is enabled and
stores the key in the OS keychain, not in `settings.json`. Codex reads the same
repository through `.codex-plugin/plugin.json` and
`.agents/plugins/marketplace.json`.

Plugins cannot ship permission rules, which is the one thing that does not
travel: use `PLANKA_READ_ONLY` and `PLANKA_DISABLED_TOOLS` (below) instead of a
client-side deny list — they work in every runtime and cost no context.

### Codex `env` block

`codex mcp add` does not take credentials, so add them to
`~/.codex/config.toml` (or let `init --client codex` do it):

```toml
[mcp_servers.planka]
command = "npx"
args = ["-y", "@omnicoreos/planka-mcp"]
env = { PLANKA_BASE_URL = "https://planka.example.com", PLANKA_API_KEY = "<key>" }
```

## Verify it works

First, inspect Claude Code's configuration:

```bash
claude mcp list
claude mcp get planka
```

Then fully restart Claude Code — MCP servers are loaded when a session starts. If
you configured the server in a project's `.mcp.json`, open Claude Code in that
project and approve the project-scoped server when prompted. If you installed the
plugin, `/plugin` shows it, and its **Errors** tab shows a server that failed to
start.

Ask Claude Code:

```text
Show me my Planka projects and boards. In the Pending list, create a card named
"MCP is working" with the description "Created from Claude Code", then read it back.
```

If Claude cannot see the tools, restart first and then follow
[Troubleshooting](docs/troubleshooting.md).

## Authentication

Two ways to authenticate, and they are mutually exclusive: setting both is a
configuration error, because Planka reads `Authorization` first and silently
ignores `x-api-key` when both arrive.

| | `PLANKA_API_KEY` (recommended) | `PLANKA_AGENT_EMAIL` + `PLANKA_AGENT_PASSWORD` |
|---|---|---|
| Sent as | `X-Api-Key: <prefix>_<secret>` on every request | `POST /api/access-tokens`, then `Authorization: Bearer` |
| Login round-trip | none | one per session, refreshed every 25 minutes |
| Sign-in rate limit | not subject to it | 10 logins per identity per 60 s — reached fast when several agents start at once |
| Password on disk | none | yes, in the client's configuration file |
| Attachment downloads | works | works |

### Recipe: a scoped agent user with an API key

Four steps, run by a Planka **admin**. The result is a user that can only ever
see the boards you name — enforced by Planka itself, not by this server.

1. **Create the user with the lowest global role.** In the Planka UI:
   *Administration → Users → Add user*, role **`boardUser`**. A `boardUser`
   cannot create projects and cannot grant itself memberships.

2. **Give it membership on the boards it should work on**, and only those:

   ```bash
   curl -X POST "$PLANKA_URL/api/boards/<BOARD_ID>/board-memberships" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"userId":"<USER_ID>","role":"editor"}'
   ```

   Use `"role":"viewer"` for an agent that should read and comment but never
   create or move cards. `GET /api/projects` then returns only the projects
   derived from these memberships; every other board answers 404.

3. **Issue the API key** (admin-only endpoint). The key is shown **once**, in
   `included.apiKey`; Planka stores only its hash and prefix:

   ```bash
   curl -X POST "$PLANKA_URL/api/users/<USER_ID>/api-key" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

4. **Configure the server with the key and nothing else.** Remove
   `PLANKA_AGENT_EMAIL` and `PLANKA_AGENT_PASSWORD`:

   ```json
   {
     "mcpServers": {
       "planka": {
         "command": "npx",
         "args": ["-y", "@omnicoreos/planka-mcp"],
         "env": {
           "PLANKA_BASE_URL": "https://planka.example.com",
           "PLANKA_API_KEY": "abcd1234_0123456789abcdef0123456789abcdef"
         }
       }
     }
   }
   ```

Rotating a key is step 3 again: issuing a new one invalidates the old.

## Scoping the server

An API key inherits its user's permissions — it carries no scopes of its own.
Scoping therefore happens in three layers, and each covers something the others
cannot.

```
Layer 1 · PLANKA          the only layer an agent cannot talk its way around
  boardUser + board memberships + the API key above
  ⇒ everything outside the allowed boards is 404/403 at the API

Layer 2 · THIS SERVER     ergonomics, and defence against the agent itself
  the environment variables below; they travel with the package,
  so Claude Code, Codex and Cursor all get the same rules

Layer 3 · THE CLIENT      survives a downgrade of this package
  .claude/settings.json deny/ask rules, Codex enabled_tools/disabled_tools
```

Layer 1 has real enforcement but cannot express "do not call `planka_get_board`,
it costs forty times more context". Layer 2 can, and reaches every runtime.
Layer 3 stays true even if this package is pinned back to an older version.

### Layer 2: the environment variables

| Variable | Value | What it does |
|---|---|---|
| `PLANKA_DEFAULT_BOARD_ID` | one board id | `boardId` becomes optional on every tool that takes one, and defaults to this board. Saves the `planka_get_structure` call an agent makes only to recover an id that never changes |
| `PLANKA_ALLOWED_BOARD_IDS` | comma-separated board ids | Boards outside the list are filtered out of `planka_get_structure`, and any call naming one is refused before the request leaves the process |
| `PLANKA_ALLOWED_PROJECT_IDS` | comma-separated project ids | Same, one level up |
| `PLANKA_READ_ONLY` | `true` or `1` | The twenty-seven write tools disappear from `tools/list` and are refused if called anyway |
| `PLANKA_HIDE_DEPRECATED` | `true` or `1` | Drops the seven deprecated tools (`manage_labels`, `manage_lists`, `manage_comment`, `add_comment`, `get_board`, `list_cards`, `list_lists`) from `tools/list`, saving ~6.8 kB of context. They stay callable, so a cached tool list still works |
| `PLANKA_DISABLED_TOOLS` | comma-separated tool names | Switches individual tools off. The `planka_` prefix is optional: `get_board` and `planka_get_board` mean the same thing |
| `PLANKA_PROTECTED_LIST_IDS` | comma-separated list ids | Refuses creating or moving cards **into** those lists, editing or deleting the lists themselves, and moving, archiving or deleting the cards **out of** them |
| `PLANKA_SUMMARY_DECISION_LISTS` | comma-separated column names or ids | Which columns `planka_board_summary` returns cards from when the call does not say. Unset: it returns no cards, only the shape of the board |
| `PLANKA_SUMMARY_HIGHLIGHT_LABEL` | one label name | The label that marks a card as unblocked in `planka_board_summary`. Unset: nothing is highlighted |
| `PLANKA_GET_CARD_COMMENTS` | `all` or a number | What `planka_get_card` reads when the call does not pass `withComments`: every comment, or the N most recent. An explicit `withComments` (`0` included) still wins. Unset: no comments unless asked. Set it when your agents must read a card's comments before acting on it — it turns a rule they can forget into the default |
| `PLANKA_MCP_PREFLIGHT` | `full` | Read by the plugin's SessionStart hook only: also spawn the server binary and wait for its stdio banner. Off by default, because on a cold cache it costs an `npx` download |
| `PLANKA_MCP_COMMAND` | a command | Read by the same hook: the command to spawn instead of `npx -y @omnicoreos/planka-mcp` (a local checkout, a pinned binary) |

**The server ships with no board vocabulary of its own.** Column names and
"ready" labels are yours, in your language: the last two variables are how a
deployment tells the summary what its board looks like. A hint that matches
nothing comes back in `warnings`, never as an empty answer.

```json
"PLANKA_SUMMARY_DECISION_LISTS": "decision,probalo,miralo",
"PLANKA_SUMMARY_HIGHLIGHT_LABEL": "decidido"
```

**Allowlists are by id, never by name.** Any board editor can rename a board, so
a name-based allowlist is bypassed with one edit. Planka ids are stable.

Two notes on what these are and are not:

- `PLANKA_READ_ONLY` hides tools; it does not make the account read-only. Pair it
  with `"role":"viewer"` in step 2 above if that is what you actually need.
- `PLANKA_PROTECTED_LIST_IDS` is a guard-rail, not a permission: Planka has no
  per-list rights. It is the right tool for "do not move cards to *Merged* on
  your own", and the wrong one for anything security-critical.

Example — an agent that reads one board and comments, and nothing else:

```json
"env": {
  "PLANKA_BASE_URL": "https://planka.example.com",
  "PLANKA_API_KEY": "abcd1234_0123456789abcdef0123456789abcdef",
  "PLANKA_DEFAULT_BOARD_ID": "1234567890123456789",
  "PLANKA_ALLOWED_BOARD_IDS": "1234567890123456789",
  "PLANKA_DISABLED_TOOLS": "get_board",
  "PLANKA_PROTECTED_LIST_IDS": "9876543210987654321"
}
```

## The 41 tools

IDs are strings. Start with `planka_get_structure`, then use IDs returned by
Planka; do not guess them.

| Tool | What it does |
|---|---|
| `planka_get_structure` | Lists visible projects, boards, and lists |
| `planka_get_board` | **Deprecated.** Reads one board whole, up to `limit` cards |
| `planka_board_summary` | One-call briefing: columns with counts, labels with ids, and optionally the cards of named columns |
| `planka_find_cards` | The one read over cards: one column (`listId`), or a board searched by text, label or member |
| `planka_list_lists` | **Deprecated.** Alias of `planka_board_summary` with `cardsFrom: []` |
| `planka_list_cards` | **Deprecated.** Alias of `planka_find_cards` with `listId` |
| `planka_create_card` | Creates a card and can attach tasks and labels |
| `planka_get_card` | Card digest; `detail: "full"` and `withComments` on demand |
| `planka_update_card` | Updates title, description, due date, or completion |
| `planka_move_card` | Moves a card to another list or position |
| `planka_delete_card` | Permanently deletes a card |
| `planka_create_tasks` | Adds checklist tasks to a card |
| `planka_update_task` | Renames or completes a task |
| `planka_delete_task` | Deletes a task |
| `planka_create_label` | Creates a board label |
| `planka_update_label` | Renames a label or changes its color |
| `planka_delete_label` | Deletes a label from the board and from every card |
| `planka_manage_labels` | **Deprecated.** Alias routing `action` to the three above |
| `planka_set_card_labels` | Adds or removes labels and verifies the final state |
| `planka_create_comment` | Adds a comment through Planka 2.x's dedicated endpoint |
| `planka_get_comments` | Paginated comments (`limit`, `beforeId`, `all`) |
| `planka_update_comment` | Rewrites an existing comment |
| `planka_delete_comment` | Deletes a comment |
| `planka_add_comment` | **Deprecated.** Alias of `planka_create_comment` |
| `planka_manage_comment` | **Deprecated.** Alias routing `action` to update/delete |
| `planka_create_list` | Creates a list (column) on a board |
| `planka_update_list` | Renames, repositions or reclassifies a column |
| `planka_delete_list` | Deletes a column **and every card in it** |
| `planka_manage_lists` | **Deprecated.** Alias routing `action` to the three above |
| `planka_add_attachment` | Uploads a local file to a card and verifies it landed |
| `planka_get_attachments` | Lists a card's attachments with type, size, and download URL |
| `planka_view_attachment` | Returns an attachment's content; images come back viewable |
| `planka_delete_attachment` | Deletes an attachment |
| `planka_card_history` | One card's activity log as human lines: created, moved, assigned, tasks completed |
| `planka_board_activity` | What moved on a board since a date, grouped by card |
| `planka_set_card_members` | Assigns or unassigns people and verifies the final membership |
| `planka_list_users` | The people who can be assigned, with a board-scoped fallback |
| `planka_whoami` | This server's account, board role, Planka version and access policy |
| `planka_duplicate_card` | Copies a card with its tasks, labels and members |
| `planka_archive_card` | Archives a card into the board's hidden archive, or restores it |
| `planka_move_list_cards` | Moves every card of one column into another, with counts |

The reads follow one principle: **a small digest by default, the detail through
parameters**. `planka_board_summary` opens a session in one call;
`planka_find_cards` with a `listId` reads a whole column in ONE request through
`GET /api/lists/:id`, so `total` is the real size of the column and the answer
carries `truncated: false`; the same tool without a `listId` searches the board.
Measured on the reference board of 185 cards, the deprecated `planka_get_board`
went from 56,112 to 17,215 characters and `planka_get_structure`
(`withLists: false`) from 696 to 203, while a 159-card column went from five
requests to two. Every read reports `total`, `returned` and `hasMore`, so a
clipped answer never looks complete, and every board-derived read carries
`excludesArchived: true` because Planka keeps archive and trash out of the board
read.

Every input field and a complete payload for every tool are in
[Tools reference](docs/tools.md).

## What the client learns on connect

The `initialize` handshake returns a short set of server instructions — how to
open a session, where IDs come from, why every comment on a card matters, and
that Planka answers `404` where it means `403`. Claude Code puts them in the
session system prompt and Codex CLI reads them alongside the tool list, so the
shared guidance is stated once instead of repeated in 41 tool descriptions.
Every tool also publishes a display title and all four MCP behavioural hints
explicitly, rather than inheriting the spec's pessimistic defaults, plus the two
`_meta` keys Claude Code acts on: a forced confirmation prompt on the tools that
delete data, and a raised output ceiling on `planka_view_attachment`. Details in
[Server instructions and annotations](docs/tools.md#server-instructions-and-annotations).

## Resources and prompts

Two more surfaces, and both cost nothing until something asks for them, which is
why the long-form guidance lives here instead of in the instructions everyone
pays for on every session. Claude Code reads both; Cursor reads both; Codex
supports neither, so nothing here is load-bearing.

**Resources** serve the guides that ship inside the package. In Claude Code they
are `@`-mentioned, in Cursor they come from the resource picker:

| URI | What it is |
|---|---|
| `planka://workflow/readme` | The optional board workflow: columns, labels, who moves what |
| `planka://workflow/board-template` | The columns and labels to create on a fresh board |
| `planka://workflow/skills/orchestrator` | The director skill, verbatim |
| `planka://workflow/skills/close-card` | The closing skill, verbatim |
| `planka://gotchas/planka-2x` | How Planka 2.x actually behaves when a call answers nonsense |
| `planka://labels/colors` | Every color `planka_create_label` and `planka_update_label` accept, generated from the schema |

**Prompts** are three ways to start, surfaced by Claude Code as
`/mcp__planka__<name>`:

| Prompt | Arguments | What it does |
|---|---|---|
| `planka-open-session` | `boardId?`, `since?` | Summary, then recent movement, then the columns that matter — in that order |
| `planka-close-card` | `cardId`, `listId?` | Read the whole thread, write an honest closing comment, move it, check `verified` |
| `planka-board-triage` | `boardId?`, `lists?` | Walk the columns waiting on a person and turn each card into one question |

## Optional agent workflow

The MCP server works on its own. The optional method solves a different problem:
preserving why work exists, what changed, and what remains true between agent
sessions.

Adopt it in layers:

1. Use only the MCP tools.
2. Add the board states, card template, and human handshakes.
3. Add one worktree per card with a director coordinating workers.

Start with [A board that survives the session](workflow/README.md). The
[board template](workflow/board-template.md), copyable
[Claude Code skills](workflow/skills/), and optional
[worktree helper](workflow/worktrees/README.md) are independent pieces.

## Troubleshooting

- [Symptoms, causes, and exact fixes](docs/troubleshooting.md)
- [Why Planka 2.x breaks older MCP servers silently](docs/planka-2x-gotchas.md)
- [Complete tool payloads](docs/tools.md)

When reporting a bug, include the Planka version, Node version, the tool name,
and the error text. Never paste credentials or access tokens.

## Credits and license

This is an MIT-licensed fork of
[`gogogadgetbytes/planka-mcp`](https://github.com/gogogadgetbytes/planka-mcp),
not an original-from-scratch implementation. See [CREDITS.md](CREDITS.md) for
the upstream attribution, maintained fixes, and unanswered pull requests.

See [LICENSE](LICENSE) for the original and current contributor notices.

## Development

```bash
npm ci
npm run build
npm test
```

The real smoke test is opt-in because it mutates a writable board and then cleans
up after itself. It drives all 41 tools over stdio and cross-checks every write
against the raw Planka API — over 90 named checks:

```bash
export PLANKA_BASE_URL="https://planka.example.com"
export PLANKA_AGENT_EMAIL="agent@example.com"
export PLANKA_AGENT_PASSWORD="<YOUR_PASSWORD>"
export PLANKA_SMOKE_BOARD_ID="1234567890123456789"
npm run test:smoke
```

`npm run test:smoke` builds first, so it cannot test a stale `dist/`. Four
optional variables tune it:

| Variable | What it does |
|---|---|
| `PLANKA_SMOKE_LIST_ID` | Column where the scratch card is created. Without it, a scratch-looking column is picked, falling back to the first one |
| `PLANKA_SMOKE_FAIL_AFTER` | Injects a failure after check `<n>`, to prove that cleanup still runs |
| `PLANKA_MCP_ENTRY` | Server entry point. Defaults to `dist/index.js` |
| `VERBOSE` | Set to `1` to print each check's payload |

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Release identity
is centralized in [project.identity.json](project.identity.json); update it and
run `npm run sync:identity` before publishing under your own namespace.
