---
name: dynamodb-single-table
description: Designs and reviews key-based DynamoDB access for Investimentos. Use for persistence changes and new access patterns.
---

Consult ADR-0001 before proposing a key or index. Derive every access from an explicit query;
never add Scan or a filter that hides an unbounded read. For a new access pattern, explain
the key or index change and record its rationale in an ADR before implementation.

The current design uses table investimentos with PK/SK and GSI1PK/GSI1SK. A portfolio has
PK PORTFOLIO#<id> and SK PORTFOLIO; its positions use SK POSITION#<symbol>; its orders use
SK ORDER#<orderId>. An order also has GSI1PK ORDER#<orderId> and GSI1SK ORDER. Confirm these
facts against the current source before applying them.

Use GetItem for an exact key, Query with a key condition for a collection and conditional
PutItem for creation. Preserve the identifier validation that excludes # from client IDs.
Account for eventual consistency on the GSI: a missing immediate read is not proof that
creation failed. Do not promise read-after-write consistency from DynamoDB Local behavior.

Keep collection reads bounded. When changing pagination, expose an opaque continuation token
based on LastEvaluatedKey and test empty, first, middle and final pages. The existing positions
pagination is backlog work; do not describe it as delivered without checking the source.
Test conditions, duplicates and absence against an owned DynamoDB Local table. Never use
production credentials or delete a table whose ownership was not established by the test.
