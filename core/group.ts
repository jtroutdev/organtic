import { normalizeTitle } from "./parse.ts";
import type {
  Candidate,
  MediaFile,
  MediaGroup,
  RankedCandidate,
} from "./types.ts";

/**
 * Collects files that should share one match: every episode of a show, or the files of
 * one movie. Files flagged as samples, trailers or extras are returned separately.
 */
export function groupFiles(files: MediaFile[]): {
  groups: MediaGroup[];
  skipped: MediaFile[];
} {
  const groups = new Map<string, MediaGroup>();
  const skipped: MediaFile[] = [];
  for (const file of files) {
    const { parsed } = file;
    if (parsed.skip) {
      skipped.push(file);
      continue;
    }
    const title = normalizeTitle(parsed.title);
    const key = !title
      ? `unknown:${file.id}`
      : parsed.kind === "tv"
        ? `tv:${title}`
        : `movie:${title}:${parsed.year ?? ""}`;
    const group = groups.get(key);
    if (group) {
      group.fileIds.push(file.id);
      group.year ??= parsed.year;
    } else
      groups.set(key, {
        key,
        kind: parsed.kind,
        title: parsed.title,
        year: parsed.year,
        fileIds: [file.id],
      });
  }
  return {
    groups: [...groups.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
    skipped,
  };
}

function titleScore(wanted: string, offered: string): number {
  const a = normalizeTitle(wanted),
    b = normalizeTitle(offered);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = new Set(a.split(" ")),
    right = new Set(b.split(" "));
  const shared = [...left].filter((word) => right.has(word)).length;
  // Dice coefficient over words, capped so only an exact title scores 1.
  return Math.min(0.9, (2 * shared) / (left.size + right.size));
}

function yearScore(wanted: number | null, offered: number | null): number {
  if (wanted === null || offered === null) return 0.5;
  const distance = Math.abs(wanted - offered);
  return distance === 0 ? 1 : distance === 1 ? 0.7 : 0;
}

/** A short reason a person can check, e.g. "Exact title, year differs". */
function describeFit(
  title: number,
  wanted: number | null,
  offered: number | null,
): string {
  const titlePart =
    title === 1
      ? "Exact title"
      : title >= 0.5
        ? "Similar title"
        : "Title differs from the filename";
  if (wanted === null || offered === null) return titlePart;
  return `${titlePart}, year ${wanted === offered ? "matches" : "differs"}`;
}

/**
 * Orders provider results by how well they fit the parsed title and year. The top result
 * is `confident` only when it is a strong fit and clearly ahead of the runner-up; anything
 * else needs a person to choose.
 */
export function rankCandidates(
  wanted: { title: string; year: number | null },
  candidates: Candidate[],
): { ranked: RankedCandidate[]; confident: boolean } {
  const ranked = candidates
    .map((candidate, order) => {
      const title = titleScore(wanted.title, candidate.title);
      return {
        candidate,
        order,
        score: 0.8 * title + 0.2 * yearScore(wanted.year, candidate.year),
        fit: describeFit(title, wanted.year, candidate.year),
      };
    })
    // Providers already order by relevance; keep that order between equal scores.
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ candidate, score, fit }) => ({ candidate, score, fit }));
  const [best, next] = ranked;
  return {
    ranked,
    confident:
      !!best && best.score >= 0.85 && (!next || best.score - next.score >= 0.1),
  };
}
