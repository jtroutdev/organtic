/**
 * Reading a reply without trusting how big it is. A source that sends no `content-length`, or the
 * wrong one, must not be able to make the app hold an unbounded amount in memory.
 */

/** As much as any metadata reply should ever need. */
export const JSON_LIMIT = 10_000_000;

export class ReplyTooLarge extends Error {
  constructor(host: string) {
    super(`${host} sent more data than Organtic will read. Try again later.`);
    this.name = "ReplyTooLarge";
  }
}

/**
 * The reply's text, read as it arrives and stopped at `limit`. The stated length is checked first,
 * where there is one, and the body is cancelled rather than drained on refusal.
 */
export async function readTextLimited(
  response: Response,
  host: string,
  limit = JSON_LIMIT,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new ReplyTooLarge(host);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ReplyTooLarge(host);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The reply's JSON, read with the same limit. Invalid JSON throws a `SyntaxError`. */
export async function readJsonLimited(
  response: Response,
  host: string,
  limit = JSON_LIMIT,
): Promise<unknown> {
  return JSON.parse(await readTextLimited(response, host, limit));
}
