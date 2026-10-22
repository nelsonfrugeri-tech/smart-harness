---
name: graphify
description: Navigate the md2poui source graph before editing or reviewing its CLI. Use the managed local Graphify CLI to locate symbols and source relationships.
---

Run from the md2poui checkout using the shell tool. Check the prerequisite:

```sh
harness tools check graphify
```

If missing, stop and report `harness tools install graphify` (requires uv and Python 3.10+). Do not substitute a global installation or claim the graph was queried.

Map only source code, with local AST extraction and no model call:

```sh
harness tools run graphify update ./src
harness tools run graphify explain md2poui --graph ./src/graphify-out/graph.json
harness tools run graphify explain adjustOptions --graph ./src/graphify-out/graph.json
```

Inspect the cited source lines in the checkout. The graph is a navigation aid: it does not prove runtime behavior or correctness. Record the Git revision, command, symbol and source line used. After editing, refresh with the same update command. Keep `src/graphify-out/` out of commits.

This is a Smart Harness-authored skill for Graphify 0.9.56, not an official upstream plugin bundle. The separately installed executable comes from https://github.com/Graphify-Labs/graphify/tree/v0.9.56 (Apache-2.0 with legacy MIT portions). Do not install MCP servers, hooks, cloud services or optional semantic backends for this demo.
