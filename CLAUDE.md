# CLAUDE.md
# Base Design Tool — Claude Code workflow rules

You are Claude Code working on the Base Design Tool, a browser-based 3D
base planner for Dune Awakening guild bases. This file defines workflow
rules. Project facts (state shape, file layout, schemas, conventions)
live in docs/architecture.md — read it at the start of every session.

## Working directory
- This repo only. Never read or write files outside it.
- Source code lives in src/. Docs live in docs/.
- snapshots/ contains ad-hoc backups (if present); do not touch unless asked.

## Session start
- Always read docs/architecture.md first.
- Read other files only when the task needs them. Do not pre-emptively
  load the whole codebase.

## Edits
- Prefer targeted edits over rewrites.
- Use a full file rewrite only when:
  (a) the file does not exist,
  (b) more than 50% of the file is changing, or
  (c) I explicitly ask.
- Always deliver complete files, never partial diffs in the chat.
- After writing, state filename and line count only — no recap, no
  preview.

## Output discipline
- No narration. No "Now I'll...", "Let me check...", transition sentences.
- Ask questions if needed; otherwise output results only.
- Never paste file contents back into chat to "show your work".

## Git
- Branch per migration step (e.g. step-1-cloudflare, step-3-refactor).
- Commit frequently within a step with clear messages.
- Never push without explicit approval.
- Never force-push, rebase shared history, or rewrite main.

## Permissions
- Auto-approvable: file reads/writes within the repo, git add, git commit,
  npm/pip installs, builds.
- Always ask: git push, rm, anything outside the repo, network calls
  beyond package installs.

## Conventions
- British spelling in all UI text and code comments.
- CSS variables only — never hardcode colours. Full palette in
  docs/architecture.md.
- The user's name for this tool is "Base Design Tool".

## Destructive actions in the app
- Any user action that erases data must show a modal containing a
  .modal-danger-banner element before executing.

## When blocked
- Stop. Do not guess.
- Commit progress with a clear message.
- Tell me what's blocking and what you'd need to proceed.

## Updating docs/architecture.md
You MAY:
- Move items from "To Do" to "Done" in section 0 once they are complete.
- Update section 17 (Project State) Current/Next to reflect the latest state.
- Fix factual errors (e.g. wrong file paths, broken references).

You MAY NOT:
- Add new items to the To Do list.
- Reorder or rewrite To Do item descriptions.
- Change Open Decisions.
- Modify the data model, schemas, sidebar layout, conventions, or any
  section that defines what should be built.

If the spec looks wrong, unclear, or you think a missing item should
be added, stop and ask. Do not edit the spec to match what you implemented.
