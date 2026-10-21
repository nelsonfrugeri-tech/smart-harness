---
name: http-contract-testing
description: Tests the contract of a Go HTTP handler with httptest. Use when adding or changing an endpoint.
---

Test the public contract of a handler, not its internals.

1. List the contract: method, path, request body, status codes and response body.
2. Build the handler and call it with `httptest.NewRecorder` and `httptest.NewRequest`.
3. Write one table-driven case per status code: success, invalid input, not found and conflict.
4. Assert the status, the `Content-Type` header and the decoded JSON body, not the raw string.
5. Assert the error body shape for every failure case.
6. Run `go test ./...` and confirm each new case fails when the behavior is removed.
