import type { QueueGroup, QueueState, QueueUpdate } from "./types.ts";

/**
 * Applies an update from the session to the queue the interface holds. Changed groups replace
 * their old description where they stand, so a list showing the queue redraws only them; a new
 * order rebuilds the list from the groups already held and the ones given.
 */
export function applyQueueUpdate(queue: QueueState, update: QueueUpdate) {
  if (update.order) {
    const byKey = new Map<string, QueueGroup>(queue.groups.map((group) => [group.key, group]));
    for (const group of update.groups) byKey.set(group.key, group);
    queue.groups = update.order.flatMap((key) => {
      const group = byKey.get(key);
      return group ? [group] : [];
    });
  } else if (update.groups.length) {
    const index = new Map(queue.groups.map((group, at) => [group.key, at]));
    for (const group of update.groups) {
      const at = index.get(group.key);
      if (at !== undefined) queue.groups[at] = group;
    }
  }
  if (update.skipped) queue.skipped = update.skipped;
  if (update.unread) queue.unread = update.unread;
  queue.lookups = update.lookups;
}
