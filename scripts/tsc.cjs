// TypeScript 7's compiler, by path. `typescript6` (see vue-tsc.cjs) installs a `tsc` command
// too, and which of the two `node_modules/.bin/tsc` points at is up to the package manager.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const { status } = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(status ?? 1);
