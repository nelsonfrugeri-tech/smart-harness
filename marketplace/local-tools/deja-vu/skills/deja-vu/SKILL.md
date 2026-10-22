---
name: deja-vu
description: Retrieve real local preparation decisions and session history for md2poui before implementation or review; record useful decisions for later sessions.
---

Use the shell tool and check the managed binary:

```sh
harness tools check deja-vu
```

If missing, stop and report `harness tools install deja-vu` (requires Go 1.25+). A skill file alone is not an installed indexer. Never claim a recall without executing the search.

Search actual indexed local history and recorded decisions:

```sh
harness tools run deja-vu search --harness deja --project md2poui --no-embed --limit 3 "demo-preparation"
```

For a relevant result, inspect its ID with `harness tools run deja-vu show <id>`. Say what was recovered and how it changed the work. If nothing matches, state that explicitly; do not invent history. Revalidate historical claims against current code.

During preparation, record only a real decision agreed in this session:

```sh
harness tools run deja-vu remember "<actual decision and reason>" --project md2poui --tag demo-preparation
```

The note persists between processes and sessions. To refresh existing coding-session history, use `harness tools run deja-vu index`. Upstream discovers histories on this machine, including other coding agents; use a dedicated demo account/configuration when the presentation must exclude private history. Do not export or publish transcripts. The managed index defaults to HARNESS_CONFIG_DIR/deja-index and notes to HARNESS_CONFIG_DIR/deja-notes.jsonl; DEJA_INDEX_DIR and DEJA_NOTES_FILE may explicitly override them. An isolated index alone does not isolate source histories.

This is a Smart Harness-authored skill for deja-vu 0.16.8, https://github.com/vshulcz/deja-vu/tree/v0.16.8 (MIT). The demo invokes its local CLI directly, without installing upstream MCP or hooks. Use `--no-embed` searches; no cloud service is required.
