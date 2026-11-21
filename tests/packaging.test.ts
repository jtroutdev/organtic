import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { productionPolicy } from "../scripts/pagePolicy.ts";

const root = path.join(import.meta.dirname, "..");
const read = (file: string) => fs.readFile(path.join(root, file), "utf8");
const policyOf = (html: string) => /Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? "";

test("the built page's policy reaches no dev server and allows no form", async () => {
  const source = await read("index.html");
  assert.match(policyOf(source), /ws:\/\/127\.0\.0\.1:\*/, "the dev server keeps its websocket");
  const built = policyOf(productionPolicy(source));
  assert.doesNotMatch(built, /ws:/);
  assert.match(built, /(^|; )connect-src 'self'(;|$)/);
  assert.match(built, /(^|; )form-action 'none'(;|$)/);
  // Everything else is left as it was.
  assert.equal(built, policyOf(source).replace(" ws://127.0.0.1:*", ""));
});

test("the build refuses a page whose policy it cannot change", () => {
  assert.throws(() => productionPolicy("<html></html>"), /no content security policy/);
  assert.throws(
    () =>
      productionPolicy(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ws://localhost:*" />`,
      ),
    /no longer has/,
  );
});

test("the packaged app turns off Node's ways in and checks its archive", async () => {
  const { build } = JSON.parse(await read("package.json")) as {
    build: { electronFuses?: Record<string, boolean> };
  };
  assert.deepEqual(build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // The page is loaded from a file: URL, which needs the file protocol's usual access.
    grantFileProtocolExtraPrivileges: true,
  });
});

test("the package ships no node_modules: the interface is bundled, the desktop process needs only Electron", async () => {
  const { dependencies } = JSON.parse(await read("package.json")) as {
    dependencies?: Record<string, string>;
  };
  assert.deepEqual(dependencies ?? {}, {});
});
