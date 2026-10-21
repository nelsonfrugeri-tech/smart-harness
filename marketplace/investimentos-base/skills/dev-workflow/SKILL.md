---
name: dev-workflow
description: Follows the squad eight-stage development workflow from discovery to finalization. Use for a feature or bug with acceptance criteria.
---

Use this lightweight spec-driven workflow. The task and its acceptance criteria are the spec;
no external Spec Kit installation or new infrastructure is required. For a trivial correction,
combine the planning notes, but keep the acceptance check and verification evidence explicit.

1. Discovery: consult project_overview, relevant ADRs, backlog and delivered work through the
   gateway. Inspect the current GitHub source. Cite the sources and identify what is unknown.
2. Refinement: state expected behavior, scope, edge cases, errors, absence semantics and
   measurable acceptance criteria. Resolve material ambiguity with the developer. Write a
   small plan and link it to the task before implementation.
3. Development: follow the approved plan in small changes. Where feasible, capture a failing
   acceptance test first. Apply go-idioms and dynamodb-single-table. Do not expand the scope.
4. Testing: run focused tests and the repository gates appropriate to the change. Verify
   failure and absence paths. Record the commands, revision, results and unavailable checks.
5. Self-review: inspect the diff against every acceptance criterion, ADR and security boundary.
   Remove unrelated changes and correct defects before asking for independent review.
6. Pull request: prepare a concise description linking the task, behavior, evidence and limits.
   Create the PR only through a capability explicitly authorized for writing; these gateway
   tools are read-only, so provide the developer the prepared text when writing is unavailable.
7. Independent review: ask the reviewer agent to compare the change with the spec and ADRs.
   Address findings and rerun affected checks. Do not treat a self-review as independent review.
8. Finalization: confirm review and required checks, summarize delivered behavior and remaining
   work, then hand off for the developer's merge decision. Never merge or close work without
   authorization, and never call incomplete acceptance criteria completed.

On missing authentication or unavailable MCP tools, identify the missing source and suggest
`harness doctor`. Never fabricate project facts, test results or approval. Keep a clear
boundary between planned work, implemented code and behavior exercised in runtime.
