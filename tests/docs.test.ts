import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SKIPPED = new Set(["node_modules", "dist", "build", "release"]);
// How far into a file an agent can be expected to read before deciding what it holds.
const TOP = 100;

function markdownFiles(folder = ""): string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) return [];
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const lines = (path: string) => readFileSync(join(ROOT, path), "utf8").split(/\r?\n/);

// The "## " headings of a file, leaving out fenced code and the contents list itself.
function sections(text: string[]): string[] {
  let fenced = false;
  return text.flatMap((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return !fenced && line.startsWith("## ") && line !== "## Contents" ? [line.slice(3)] : [];
  });
}

// CLAUDE.md is a pointer, not a document.
const docs = markdownFiles().filter((path) => path !== "CLAUDE.md");

test("CLAUDE.md only imports AGENTS.md", () => {
  assert.equal(readFileSync(join(ROOT, "CLAUDE.md"), "utf8").trim(), "@AGENTS.md");
});

test("AGENTS.md lists every documentation file", () => {
  const agents = lines("AGENTS.md").join("\n");
  for (const path of docs) {
    if (path !== "AGENTS.md") assert.ok(agents.includes(`](${path})`), `${path} is not linked from AGENTS.md`);
  }
});

test("every documentation file opens with its contents", () => {
  for (const path of docs) {
    const text = lines(path);
    const top = text.slice(0, TOP);
    // DESIGN.md starts with front matter, so its contents are a comment there.
    const start = top.indexOf(path === "DESIGN.md" ? "# Contents" : "## Contents");
    assert.notEqual(start, -1, `${path} has no contents in its first ${TOP} lines`);
    const end = path === "DESIGN.md" ? text.findIndex((line, at) => at > start && !line.startsWith("#")) : text.findIndex((line, at) => at > start && line.startsWith("## "));
    assert.ok(end !== -1 && end <= TOP, `${path}: the contents run past line ${TOP}`);
    const contents = text.slice(start + 1, end);
    for (const heading of sections(text)) {
      const listed = path === "DESIGN.md" ? contents.some((line) => line.startsWith(`#     ${heading} `)) : contents.some((line) => line.trim().startsWith(`- [${heading}](#`));
      assert.ok(listed, `${path}: "${heading}" is missing from the contents`);
    }
  }
});
