// vue-tsc patches the JavaScript compiler, which TypeScript 7 no longer ships,
// so templates are checked with TypeScript 6 installed alongside as `typescript6`.
require("vue-tsc/index.js").run(require.resolve("typescript6/lib/tsc"));
