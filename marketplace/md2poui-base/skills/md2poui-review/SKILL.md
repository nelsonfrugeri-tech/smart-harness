---
name: md2poui-review
description: Reviews an md2poui change independently against its story and ADR and reports only evidenced BLOCKER or MAJOR findings.
---

# md2poui independent review

Use in a session independent from the author. The reviewer does not change product code,
merge, create cosmetic feedback, or manufacture findings for the demo. Read
[review-contract.md](references/review-contract.md) for the source and decision contract.

1. Confirm the explicit fork/PR against project resources. Use the Trello story and linked
   Notion ADR as the Spec, citing actual connector results. A local copy is a stated
   fallback, not proof of a remote read. If the material Spec or diff is unavailable,
   mark the review incomplete without approval.
2. Obtain PR base and head with local `gh pr view <number> --repo <authorized-fork> --json baseRefName,headRefOid,headRefName`.
   Fetch the refs in an isolated checkout, resolve the merge base and inspect the complete
   three-dot diff and relevant callers. Record exact base/head SHAs. Do not review a stale
   checkout while posting against a newer commit. Never run destructive cleanup on the
   author's worktree.
3. Use Graphify when navigation is needed:
   `harness tools run graphify explain md2poui --graph ./src/graphify-out/graph.json`.
   If the graph is missing, generate it only in the isolated checkout with
   `harness tools run graphify update ./src`. Revalidate against source at the reviewed SHA.
   If a previous decision matters, search with
   `harness tools run deja-vu search --project md2poui --no-embed --limit 3 demo-preparation`
   and inspect the returned ID with `harness tools run deja-vu show <id>`.
   Missing tools/history must remain explicit; neither is a substitute for the diff.
4. Assess two paths independently: Standards (repository contracts, correctness, data
   integrity, compatibility and executed checks) and Spec (story/ADR acceptance criteria).
   Use `npm test` in the isolated fork; it compiles and runs Mocha and writes `dist` and
   `test/result`. If dependencies are absent, request the prepared review environment;
   do not silently install new tools. For BL-001 verify positional conversion, default
   and explicit home on/off, helper references, and invalid input without partial output.
   Reproduce each material defect through the real CLI, recording exact input and output.
5. Report only demonstrated BLOCKER/MAJOR with file/line, axis, concrete effect, reproduction
   and minimal correction. Unsupported hypotheses and cosmetic preferences are not PR
   comments. If no such findings exist, say so honestly; do not create a staged defect.
6. Before publication re-read the remote head SHA. If it changed, inspect the new diff and
   rerun affected checks before a new verdict. Use local authenticated `gh` with explicit
   fork target; the gateway is read-only. Publish supported findings using
   `gh pr review <number> --repo <authorized-fork> --request-changes --body-file <temporary-file>`.
   Include file:line for each finding. If the reviewer uses the same GitHub account as
   the PR author, use `--comment` for findings too: GitHub rejects self request-changes
   and approval. Do not switch identity. With no pending material findings and complete
   evidence, publish the review result using `--comment`.
7. After author corrections, inspect the new head and rerun the reproduction and relevant
   checks. Prior approval does not cover new commits. Hand the current verdict and exact
   SHA to the coordinator. After three rounds, hand unresolved evidence to the coordinator;
   never downgrade a finding just to finish. Merge belongs to the integrated acceptance step.
