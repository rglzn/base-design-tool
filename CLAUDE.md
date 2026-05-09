# Base Design Tool — Claude Code workflow rules

Read `docs/architecture.md` at the start of every session. Read `docs/spec.md` sections on demand only.

## Session start — always
1. Read `CLAUDE.md` and `architecture.md` only.
2. State which `spec.md` sections you need and wait for approval before reading them.
3. State your file plan (one line per file) and wait for explicit approval before writing anything.

Do not skip steps. Do not start writing on a greenlight that hasn't come yet.

## Working directory
`base_planner/` only. Source in `src/`. Docs in `docs/`.

## Token discipline — mandatory
Token waste is a critical failure. Every unnecessary read, rewrite, or output line has a real cost.

- **architecture.md only on session start.** Never re-read it mid-session.
- **Source files: read only the section you need.** Use `head`/`tail`/line ranges. Never read an entire source file unless you are doing a full rewrite of that file.
- **Never re-read a file after editing it.** Trust your own edits.
- **No reads after spec approval.** Produce the file plan immediately. If a specific fact is missing, name it and ask — do not read speculatively to find it.
- **Plan before acting.** Before touching any file, output a one-line-per-file plan (e.g. `app.js — add setShowPlacementGhost`). Wait for user approval. Then implement with no further chat output until done.
- **One rewrite per file per session maximum.** If you find a bug in something you just wrote, fix it with a targeted edit — never a second full rewrite.
- **No self-correction loops.** If you cannot fix a mistake with a single targeted edit, stop, commit what works, and report what's broken.

## Edits
Prefer targeted edits. Full rewrite only when: (a) file doesn't exist, (b) >50% changing, or (c) explicitly asked. After writing, state filename and line count only. Plan the complete set of edits to a file before making the first one.

## Output discipline — zero tolerance
Every output token costs money. Violations are not minor.

- No narration, transitions, or process commentary of any kind.
- No code in chat output. Ever. Code goes in files only.
- No pasting file contents to show your work.
- No inline explanations of what an edit does — the edit speaks for itself.
- Responses to the user: one-liners only unless a question genuinely requires more.
- End-of-session summary: a single bullet list, one line per file changed. Nothing else.

## Git
Branch per step. Commit once per logical milestone (not per file edit). Never push without explicit approval. No force-push or rebase of shared history. Do not commit without confirming with the user first unless explicitly told to auto-commit.

## Permissions
Auto-approve: reads/writes within repo, `git add`. Always ask before: `git commit`, `git push`, `rm`, anything outside repo.

## Conventions
See `docs/architecture.md`. Summary: British spelling · CSS variables only · `.modal-danger-banner` on all destructive actions · state mutations through `App` methods only.

## When blocked
Stop. State what's blocking and what you need. Do not attempt workarounds or alternative approaches without asking.

## Updating docs/architecture.md
MAY: move To Do → Done once complete; update Current State; fix factual errors.
MAY NOT: add To Do items; reorder or rewrite them; change data model, schemas, sidebar layout, or any section defining what should be built. Current State must stay ≤5 sentences: (a) last completed step, (b) what is broken and why, (c) what the current step must accomplish.

If the spec looks wrong or something seems missing, stop and ask. Do not edit to match what you implemented.
