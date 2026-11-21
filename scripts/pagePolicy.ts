/**
 * The content security policy the built page ships with. `index.html` lets the page reach the
 * dev server's websocket, which hot reloading needs; the built page has no dev server, so the
 * build takes that source out. The build fails rather than ship a policy it could not change.
 */
const POLICY = /(http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;
const DEV_CONNECT = "connect-src 'self' ws://127.0.0.1:*";

export function productionPolicy(html: string): string {
  const found = POLICY.exec(html);
  if (!found) throw new Error("index.html has no content security policy.");
  const directives = found[2].split(";").map((directive) => directive.trim());
  const at = directives.indexOf(DEV_CONNECT);
  if (at === -1)
    throw new Error(`The page's policy no longer has "${DEV_CONNECT}"; update scripts/pagePolicy.ts.`);
  directives[at] = "connect-src 'self'";
  return html.replace(POLICY, (_, before: string, _policy: string, after: string) => before + directives.join("; ") + after);
}
