---
name: go-idioms
description: Applies Go conventions to the Investimentos API. Use when planning, implementing or reviewing Go handlers, services and persistence.
---

Read the repository and its ADRs before changing code. Keep HTTP transport, domain decisions
and DynamoDB persistence in their existing packages; use explicit names and small interfaces
at the consumer boundary. Prefer the standard library and existing dependencies.

Pass context.Context through request and storage calls. Respect cancellation and release
resources. Return errors with context using wrapping; use errors.Is/errors.As for classification.
Do not panic for expected errors. Handle missing portfolios and orders explicitly.

Keep money in integer cents. Validate IDs and inputs at the HTTP boundary. Follow ADR-0003
for application/problem+json and do not expose internal errors to clients. Preserve the
net/http routing decision in ADR-0002.

Write focused table-driven tests for success, invalid input, absence and dependency failure.
Use deterministic fixtures. Run gofmt, go vet and the repository unit test target; run the
DynamoDB integration target only against an owned local test environment. Report the exact
commands and results. Add no retry or circuit breaker in this phase.
