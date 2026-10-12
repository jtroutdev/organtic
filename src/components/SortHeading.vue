<script setup lang="ts">
defineProps<{
  /** Which way the column is sorted; left out when the list is not sorted by it. */
  direction?: "asc" | "desc" | null;
}>();
</script>

<!-- A column heading that sorts by its column. The mark keeps its room when the column is not
     the one sorted by, so headings never move. -->
<template>
  <button class="sorter label" :class="direction" type="button">
    <slot /><svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 10l4-4 4 4" /></svg
    ><span class="sr-only"
      >,
      {{
        direction === "asc"
          ? "sorted ascending"
          : direction === "desc"
            ? "sorted descending"
            : "not sorted"
      }}</span
    >
  </button>
</template>

<style scoped>
.sorter{display:inline-flex;align-items:center;gap:var(--space-dense);height:var(--size-control-sm);padding:0;border:0;background:none;white-space:nowrap}
.sorter:hover,.sorter.asc,.sorter.desc{color:var(--color-on-surface)}
.sorter svg{visibility:hidden}
.asc svg,.desc svg{visibility:visible}
.desc svg{rotate:180deg}
</style>
