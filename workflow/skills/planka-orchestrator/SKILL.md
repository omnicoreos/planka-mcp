---
name: planka-orchestrator
description: This skill should be used when the user asks to "orchestrate the Planka board", "run cards in parallel", "act as the director", "dispatch workers from Planka", or "continue the board workflow". It coordinates cards, comments, worktrees, worker ownership, evidence, and safe merges without editing repository files in the director role.
license: MIT
metadata:
  version: 0.3.1
---

# Planka workflow orchestrator

Use this skill only for the optional workflow documented in `workflow/README.md`.
The Planka MCP server must be connected and the repository must define its own build,
test, review, and merge rules.

## Role boundary

You are the director. Do not edit repository files. Workers are the only writers:
one worker, one card, one branch, one worktree.

The director may:

- read the repository and board;
- create and update cards;
- create worktrees with the repository's supported helper;
- dispatch or continue workers;
- audit diffs, commits, checks, comments, and attachments;
- merge through the repository's supported path;
- clean completed worktrees.

## Preflight

1. Read the repository's agent instructions and workflow documentation.
2. Check the base tree and current worktrees without changing them.
3. Open the board with `planka_board_summary`: one call returns every column with
   its card count and every label with its ID. It is the only opening read.
4. If you are resuming work you did not start, or the session was compacted, call
   `planka_board_activity` before anything else: it says what moved, and who moved
   it, since a given date. Planka logs card creation, moves, member changes and
   task completion only — comments and edits leave no trace there, so activity
   narrows where to look, it does not replace reading the cards.
5. Pull the candidate column with `planka_find_cards` and its `listId`: that reads
   one whole column in a single request, with nothing clipped.
6. For every candidate card, read the description and ALL comments in order:
   `planka_get_card` returns a digest and no comments unless you pass
   `withComments`, and `planka_get_comments` pages 50 at a time. Trust `hasMore`
   and `nextBeforeId`, never the count you see in one answer.
7. Confirm the card has acceptance criteria and one behavior label.
8. Resolve `serial` and `zone:*` exclusions before creating anything.

Never trust a suspicious zero-comment result blindly. If the card's state implies a
decision or prior work, re-read with `planka_get_comments` and report an MCP/API
mismatch.

Reads are digests by design: descriptions are off unless asked, results are capped,
and every scoped read reports `total` / `returned` / `hasMore`. A clipped answer is
never a complete one. `planka_get_board`, `planka_list_lists` and `planka_list_cards`
are deprecated aliases kept for compatibility — `board_summary` and `find_cards`
replace all three, and `get_board` in particular costs orders of magnitude more.

IDs are strings of digits and are never guessed. They come from
`planka_board_summary` or `planka_get_structure`, and they all look alike: passing a
label ID where a list ID belongs answers "Resource not found", not a type error.
Planka also answers 404 where it means 403, so a "not found" on a write with an ID
that read fine a moment ago is almost always a missing permission for the agent user.

## Selection

Choose cards in this order:

1. Cards in `Needs your decision` with a human-applied `decided` label.
2. Eligible `Pending` cards whose zones are free.
3. At most the concurrency limit supported by the repository and machine.

Do not select:

- a card whose required decision is absent or ambiguous;
- two cards with the same `zone:*` label;
- any second card beside a `serial` card;
- work requiring credentials, hardware, external approval, or irreversible changes
  that the worker cannot verify safely.

For a `decided` card, read the newest human decision, treat it as binding, and update
the description so the chosen scope can be understood without reconstructing the
comment thread. Never apply `decided` or `tested-ok` yourself.

## Dispatch

For each selected card:

1. Create the branch and worktree using the repository helper.
2. Update the card's `<!-- agent-work -->` metadata.
3. Move the card to `In worktree` only after the Git state exists.
4. Dispatch one worker from inside that worktree.

The worker brief must contain:

- exact mission and acceptance criteria;
- the complete current card context, including decisions;
- allowed repository scope and explicit exclusions;
- worktree path and branch;
- required checks and manual verification;
- required closing comment and commit evidence.

Workers may use their own bounded subagents, but only one worker session owns writes
to the worktree. If correction is needed, continue the same session when possible.

## Audit

Audit, do not recreate, the worker's evidence:

- inspect the commit and important diff;
- confirm required checks actually ran and passed;
- confirm the acceptance step matches the card;
- inspect visual evidence when the behavior is visual;
- confirm the closing comment states omissions and remaining risk honestly;
- confirm the worker changed only its assigned scope;
- confirm every board write you made reports `verified` (and `finalLabelIds` where
  labels were touched). Writes re-read what they touched and report what actually
  landed: trust that field, not the arguments you sent.

If evidence is incomplete, leave a concrete comment and continue the same worker with
one targeted request. Do not mark a theory as a verified result.

## Destination

- Merge when repository checks and acceptance evidence are complete and no veto
  applies.
- Use `Test it` when a human must judge something before merge. State exactly what
  to inspect and why the worker could not settle it.
- Merge to `Review in main` when all pre-merge evidence exists but the final proof
  only exists in the integrated environment. State the exact post-merge check.
- Use `Needs your decision` for product, access, cost, or irreversible choices. Ask
  one concise question.

Security/access boundaries, destructive data operations, billing, shared
infrastructure, physical hardware, and third-party approvals are human gates unless
the repository explicitly defines a safe automated proof.

## Merge and close

Merge one worktree at a time through the repository's supported helper. Before merge:

- worker tree clean;
- worker commits exist;
- base tree clean;
- required checks and acceptance evidence recorded;
- card metadata matches the actual branch and worktree.

After merge, remove the worktree through the helper and make the board match reality.
Move directly to `Merged` only when all required verification is complete. A card in
`Review in main` moves to `Merged` only after a human applies `tested-ok` or gives an
equivalent explicit confirmation.

End with a compact report: cards selected, cards merged, cards waiting for a human,
checks, worktrees still alive, and any board/repository mismatch.
