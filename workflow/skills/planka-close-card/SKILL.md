---
name: planka-close-card
description: This skill should be used when the user asks to "close this Planka card", "ship this card", "finish the card", "record the card handoff", or confirms "tested ok" for a workflow card. It verifies evidence, records a durable closing comment, and performs only the merge or board transition owned by the current role.
license: MIT
metadata:
  version: 0.3.1
---

# Close a Planka workflow card

Closure is evidence plus a truthful state transition. Do not move a card merely
because implementation stopped.

## Read first

1. Read the card description and every comment: `planka_get_card` with
   `withComments`, or `planka_get_comments`. `get_card` is a digest and returns no
   comments unless asked, and comments page 50 at a time — keep paging while
   `hasMore` is true instead of trusting one answer. The description says how the
   card was born; the comments say where it stands today, and the last one wins.
2. If you are picking up a card someone else worked on, run `planka_board_activity`
   or `planka_card_history` first: they say what moved and who moved it.
3. Read the repository's contribution and verification instructions.
4. Resolve the `<!-- agent-work -->` branch and worktree against real Git state.
5. Determine your role:
   - worker: edits, verifies, commits, and writes the handoff;
   - director: audits, merges, cleans, and changes board state;
   - human confirmation handler: records `tested-ok` and completes the final move.

Do not perform another role's transition unless the user explicitly assigned both
roles and the repository allows it.

Every board write you make (`planka_create_comment`, `planka_move_card`,
`planka_set_card_labels`, `planka_update_card`) re-reads what it touched and reports
`verified`. Read that field before claiming the card moved or the comment landed: a
response without it confirmed nothing.

## Worker closure

The worker must:

1. Run the relevant repository checks.
2. Execute the card's observable acceptance step.
3. Capture visual evidence when the change is visual.
4. Record any skipped or impossible proof explicitly.
5. Commit all intended files and confirm the worktree is clean.
6. Leave this comment on the assigned card:

```markdown
✅ Ready for review

**Changed:** <one user-visible sentence>

**Where to check:** <URL, command, or exact path>

**Prove it:** <one concrete acceptance step>

**Risk:** <real nearby behavior that could regress>

**Verified:** <checks and manual evidence, with honest omissions>

**Commit:** <commit SHA>
```

The worker does not merge, delete the worktree, or move unrelated cards.

## Director closure

The director verifies:

- commit and important diff match the card;
- required checks are green;
- acceptance evidence is first-hand and specific;
- risk and omissions are explicit;
- worker and base trees are clean;
- no veto requires human judgment.

Then choose exactly one destination:

- merge and `Merged` when verification is complete;
- `Test it` when human judgment is needed before merge;
- merge and `Review in main` when only integrated proof remains;
- stay `In worktree` with a concrete red result when implementation is incomplete.

Use the supported merge helper. Never bypass its clean-tree, conflict, or verification
guards. After merge, confirm the branch/worktree cleanup and board state agree.

## Human confirmation

For a card in `Review in main`, an explicit human confirmation or human-applied
`tested-ok` is authorization to move it to `Merged`. If the human reports a failure,
comment with the observation and open or restore a fix card instead.

Never apply `tested-ok` or `decided` on behalf of the human.
