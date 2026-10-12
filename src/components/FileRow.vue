<script setup lang="ts">
defineProps<{
  /** Something is wrong with the file. */
  problem?: boolean;
  /** The problem being worked on, tinted from edge to edge. */
  current?: boolean;
  /** The column headings, which stay put above the rows. */
  heading?: boolean;
}>();
</script>

<!-- A row of the `.files` grid: what the file is, its name now, and its new name. -->
<template>
  <div class="file" :class="{ cols: heading, problem, at: current }"><slot /></div>
</template>

<style scoped>
/* Rows run the width of the pane, so the problem being worked on can be tinted edge to edge. */
.file{display:grid;grid-template-columns:subgrid;grid-column:1/-1;row-gap:var(--space-dense);align-items:center;min-height:var(--size-control);padding:var(--space-dense) var(--space-surface)}
.file+.file{border-top:1px solid var(--color-outline-subtle)}
.file.at{background:var(--color-warning-soft)}
.cols{position:sticky;top:0;z-index:var(--z-sticky);background:var(--color-surface);padding-block:0 var(--space-dense)}
</style>
