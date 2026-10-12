<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  /** What the list on the left holds, e.g. "Groups". */
  list: string;
  /** What the right side shows, e.g. "Selected group". */
  detail: string;
  /** Key of the selected item. */
  current?: string;
  /** The last row of the head rests on the rule beneath it, e.g. a row of tabs. */
  flushHead?: boolean;
}>();

// A new selection starts with its lists at the top, and stays in view in the side list.
const side = ref<HTMLElement>();
const pane = ref<HTMLElement>();
watch(
  () => props.current,
  async () => {
    await nextTick();
    for (const el of [pane.value, ...(pane.value?.querySelectorAll(".scroll,.strip") ?? [])])
      el?.scrollTo(0, 0);
    side.value
      ?.querySelector('.item[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  },
);

// The list is one tab stop; arrow keys move through it and select as they go.
function move(event: KeyboardEvent) {
  const items = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".item"),
  ];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = {
    ArrowDown: Math.min(at + 1, items.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (at < 0 || to === undefined) return;
  event.preventDefault();
  items[to]?.focus();
  items[to]?.click();
}
</script>

<template>
  <div class="panel split">
    <div class="side">
      <div class="sidehead" :class="{ flush: flushHead }"><slot name="head" /></div>
      <div ref="side" class="list" role="group" :aria-label="list" @keydown="move">
        <slot name="side" />
      </div>
      <div class="sidefoot"><slot name="foot" /></div>
    </div>
    <section ref="pane" class="detail" tabindex="-1" :aria-label="detail">
      <slot />
    </section>
  </div>
</template>

<style scoped>
.panel{background:var(--color-surface-raised);border:1px solid var(--color-outline-subtle);border-radius:var(--radius-md);overflow:hidden}
.split{display:grid;grid-template:minmax(0,1fr)/minmax(220px,300px) minmax(0,1fr)}
.side{border-right:1px solid var(--color-outline-subtle);display:grid;grid-template:auto minmax(0,1fr) auto/minmax(0,1fr);min-height:0}
.sidehead:not(:empty){position:relative;padding:var(--space-surface);border-bottom:1px solid var(--color-outline-subtle)}
.sidehead.flush{padding-bottom:0}
.sidefoot:not(:empty){padding:var(--space-nested) var(--space-surface);border-top:1px solid var(--color-outline-subtle)}
.list{display:grid;grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;overflow-y:auto}
/* The pane's columns come from the stylesheet's pane grid; it scrolls as a whole only when it is
   too short for its lists. */
.detail{padding-block:var(--space-surface);grid-auto-rows:auto;align-content:start;row-gap:var(--space-surface);min-width:0;background:var(--color-surface);overflow-y:auto}
.detail:focus{outline:none}
/* Keeps visually hidden labels inside the box that scrolls them. */
.list,.detail{position:relative}
@media (max-width:760px){
  .split{grid-template:fit-content(40%) minmax(0,1fr)/minmax(0,1fr)}
  .side{border-right:0;border-bottom:1px solid var(--color-outline-subtle)}
}
</style>
