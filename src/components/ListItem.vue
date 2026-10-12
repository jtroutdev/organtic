<script setup lang="ts">
import IssueText from "./IssueText.vue";

defineProps<{
  current: boolean;
  tone: string;
  note: string;
  count?: number | string;
  /** What `count` counts, for screen readers, e.g. "files". */
  unit?: string;
  /** Something wrong inside the item, shown after the note, e.g. "3 problems". */
  alert?: string;
  /** Sits beside a tick box in a row that draws the rule, background and selected edge itself. */
  plain?: boolean;
}>();
</script>

<template>
  <button
    class="item"
    :class="{ plain }"
    type="button"
    :aria-current="current"
    :tabindex="current ? 0 : -1"
  >
    <span class="text">
      <strong><slot /></strong>
      <small
        >{{ note }}<IssueText v-if="alert"> · {{ alert }}</IssueText></small
      >
    </span>
    <!-- The count, on the item's status colour. -->
    <span v-if="count !== undefined && count !== ''" class="tally" :class="tone"
      ><span>{{ count }}<span class="sr-only"> {{ unit }}</span></span></span
    >
  </button>
</template>

<style scoped>
.item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;text-align:left;background:none;border:0;border-bottom:1px solid var(--color-outline-subtle);padding:0}
.text{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-dense);align-content:center;padding:var(--space-nested) var(--space-surface)}
.item:hover{background-image:linear-gradient(var(--color-hover) 0 0)}
/* The selected item: the tint, and an accent edge drawn above its contents so that it runs
   unbroken across the tally. */
.item[aria-current="true"]{background-color:var(--color-accent-soft);outline:1px solid var(--color-accent);outline-offset:-1px}
.item:focus-visible{outline:2px solid var(--color-accent);outline-offset:-2px}
.item strong{font-weight:600;overflow-wrap:anywhere}
.item small{color:var(--color-on-surface-muted);font:var(--font-body-sm)}
/* The item's count on its status colour, the height of the item and flush with its right edge:
   a shade of the colour behind and a stronger one for the number. */
.tally{display:grid;place-items:center;min-width:var(--space-3xl);padding:var(--space-nested) var(--space-dense);background:oklch(from currentColor var(--tally-shade) h);font:var(--font-code-md);font-weight:600;line-height:1}
.tally>span{color:oklch(from currentColor var(--tally-number) h)}
.tally.busy>span{animation:pulse var(--duration-pulse) ease-in-out infinite}
@keyframes pulse{50%{opacity:.25}}
.item.plain{border:0;background:none;outline:0}
.item.plain:focus-visible{outline:2px solid var(--color-accent);outline-offset:-2px}
.item.plain .text{padding-left:var(--space-nested)}
@media (prefers-reduced-motion:reduce){
  .tally.busy>span{animation:none}
}
@media (forced-colors:active){
  .item[aria-current="true"]{outline:2px solid Highlight;outline-offset:-2px}
  .tally{forced-color-adjust:none}
}
</style>
