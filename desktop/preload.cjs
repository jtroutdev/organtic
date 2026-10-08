const { contextBridge, ipcRenderer, webUtils } = require("electron");
const invoke =
  (method) =>
  (...args) =>
    ipcRenderer.invoke(`media:${method}`, ...args);
contextBridge.exposeInMainWorld("organtic", {
  desktop: true,
  ...Object.fromEntries(
    [
      "load",
      "addFiles",
      "addFolder",
      "search",
      "choose",
      "confirm",
      "confirmSuggested",
      "cancelLookups",
      "remove",
      "clear",
      "include",
      "exclude",
      "setEpisode",
      "setOrdering",
      "setNumbering",
      "moveFiles",
      "chooseDestination",
      "resetDestination",
      "preview",
      "apply",
      "history",
      "undo",
      "saveSettings",
      "setToken",
      "setTvdbKey",
      "openReference",
    ].map((method) => [method, invoke(method)]),
  ),
  onQueue: (listener) =>
    ipcRenderer.on("media:queue", (_event, queue) => listener(queue)),
  // Paths come only from real dropped files; the page cannot name a path itself.
  addDropped: (files) =>
    invoke("addPaths")(
      Array.from(files, (file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
});
