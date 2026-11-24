# Orchestrator conventions (multi-lane runs)

These are the conventions the faxtract runs use. They were first practised in the v2-ui run (see `docs/CONTRACTS.md`, §0 and §14) and are written down here because later run prompts refer to this file.

## Branches and worktrees
- **The run branch** is cut from its parent, e.g. `ui-upgrade` from `v2-ui`. The orchestrator works in the primary checkout on that branch.
- **One lane = one branch + one worktree:** `lane/<run>-<name>` in `./.worktrees/<name>` (gitignored), cut from the run branch.
- **Lanes commit only to their own branch.** They never push, merge or rebase, and never touch `main` or any parent branch.
- **The orchestrator merges** lanes into the run branch, `--no-ff`, in the order the run prompt gives. It pushes only the run branch, normal push, no force.
- **Commit identity** comes from env vars (`source $SCR/bin/gitid.sh`); git config is never edited.

## Ownership and frozen contracts
- **The orchestrator writes the contracts first** (Phase 0/1), commits them, and only then cuts the lanes.
- **Each lane owns an explicit set of paths.** It reads anything and edits only what it owns.
- **Frozen files** (contracts, shared base, tokens) change only through the orchestrator. A lane writes a change request in its report and builds against the current contract meanwhile.
- **New dependencies are installed by the orchestrator** before lanes start; lanes ask instead of installing.

## Shared environment
- **Ports:** each lane gets its own port block; default ports are reserved for the orchestrator's gate.
- **Clean up:** every lane stops every process it started before reporting.
- **Secrets:** never printed or committed. A step that needs a key is marked NEEDS KEYS.

## Lane reports (the agent's final message)
A report lists:
- the files built;
- how to run them;
- test and build results (counts);
- screenshots, if it is UI work;
- what could not be done, and why;
- change requests for frozen files;
- NEEDS KEYS items;
- confirmation that its processes are stopped;
- the final commit hash.

## Gates
- **Merges:** after each one, the orchestrator runs the run's gates.
- **Final gate:** run from a fresh clone of the run branch where the prompt asks for it.
- **Gate artifacts** go to `docs/gates/` (and `docs/design/` for UI runs).
- **Pause:** the orchestrator commits WIP on each lane branch, pushes, and writes a resume plan.
