import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const root = new URL("./site/", import.meta.url);
const context = createContext({ window: {} });
new Script(await readFile(new URL("content.js", root), "utf8")).runInContext(
  context,
);
const pages = context.window.DOCS;
assert.ok(pages.length >= 10, "Documentation pages are missing");
const ids = new Set(pages.map((page) => page.id));
assert.equal(ids.size, pages.length, "Duplicate page IDs");
let links = 0;
for (const page of pages) {
  assert.ok(
    page.title && page.description && page.group && page.html,
    `Incomplete page ${page.id}`,
  );
  const headings = [...page.html.matchAll(/id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(
    new Set(headings).size,
    headings.length,
    `Duplicate anchors in ${page.id}`,
  );
  for (const [, target, anchor] of page.html.matchAll(
    /href="#\/([^"/]+)(?:\/([^"/]+))?"/g,
  )) {
    assert.ok(ids.has(target), `Broken page link ${page.id} -> ${target}`);
    if (anchor)
      assert.ok(
        pages
          .find((item) => item.id === target)
          .html.includes(`id="${anchor}"`),
        `Broken anchor ${anchor}`,
      );
    links++;
  }
}
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "favicon.svg",
  ".nojekyll",
]) {
  await readFile(new URL(file, root));
}
new Script(await readFile(new URL("app.js", root), "utf8"));
assert.ok(
  !pages.some((page) => page.html.includes("harness --help")),
  "Unsupported CLI flag",
);
assert.ok(
  pages
    .find((page) => page.id === "demo")
    .html.includes("--base demo/integration-presentation"),
  "Demo must preserve demo-start",
);
console.log(
  `Documentation valid: ${pages.length} pages, ${links} internal links, assets and JavaScript checked.`,
);
