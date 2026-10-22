---
name: md2poui-development
description: Develops an md2poui CLI change from its story and ADR with real subprocess tests and an authorized fork PR.
---

# md2poui development

Use for implementation in the authorized TOTVS md2poui fork. Read
[project.md](references/project.md) for observed conventions and command effects.
This skill does not implement the demo ahead of time or authorize merge.

1. Discover the permitted resources with `project_overview`. Read the assigned Trello
   story and linked Notion ADR through the connectors. Record URLs, acceptance criteria
   and unavailable sources. If a required decision is missing or contradictory, stop only
   the affected work; do not invent it. Local ADR/story copies can support preparation but
   do not prove the remote integrations work.
2. Confirm the local checkout and `git remote -v` match the authorized fork from project
   resources. Preserve local changes. Create a dedicated branch/worktree from the agreed
   demo-start revision; never push upstream or work on the fork default branch.
3. Use `harness tools check graphify` and `harness tools check deja-vu`. If absent, report
   the missing prerequisite and installation command (`harness tools install <name>`).
   Keep the same `HARNESS_CONFIG_DIR` used by setup. Run
   `harness tools run graphify update ./src`, then
   `harness tools run graphify explain md2poui --graph ./src/graphify-out/graph.json`.
   Verify the relevant source and revision; generated graphs are navigational hints.
   Keep `src/graphify-out/` out of the commit.
4. When a prior decision is relevant, run
   `harness tools run deja-vu search --project md2poui --no-embed --limit 3 demo-preparation`
   and `harness tools run deja-vu show <returned-id>`. Cite actual returned history and
   revalidate it against current source. No matches means no history found. Never invent
   a remembered decision or record a fabricated conversation. Record a new decision with
   `harness tools run deja-vu remember "<actual decision and reason>" --project md2poui --tag demo-preparation`
   only after making it, with no secrets or private unrelated content.
5. Reproduce the task through the real CLI before editing. Write a subprocess regression
   test for the observed behavior; record the failing exit/output. Use temporary fixtures
   owned by the test. Implement the smallest change and preserve the library API.
   For BL-001 cover positional arguments, omitted/true/false home, absent arguments,
   nonexistent source and a destination that is a file. Invalid input must fail with a
   useful message, without stack traces or partial output. Verify helper imports/routes
   as well as presence/absence of home files.
6. Run `npm test` from the fork. This runs the existing compilation and test gate; report
   counts and exit status, not an assumed pass. Inspect `git diff --check` and the complete
   diff. Exclude graphs, dist, test outputs, session files, tokens and personal settings.
7. Use local `git`/`gh` for authorized publication: confirm `gh auth status`, explicit fork
   owner/name, branch and target. Push only the task branch and open a PR with
   `gh pr create --repo <authorized-fork> --base <agreed-base> --head <task-branch> --body-file <temporary-file>`.
   The body links story/ADR and gives before/after evidence, tests and unverified work.
   Do not print credentials. Gateway GitHub cannot write. Missing auth means publication
   pending, not permission to switch account or target.
8. Hand the PR and head SHA to an independent reviewer. For BLOCKER/MAJOR feedback,
   reproduce the finding, correct it when supported, rerun checks and return the new SHA.
   Explain disagreements with evidence. Never self-approve or merge. After three review
   rounds or an unresolved blocker, return the evidence to the coordinator.

Report changed behavior, exact revision, context/tool results, test evidence and limitations.
A successful test run covers those cases; it does not prove absence of defects.
