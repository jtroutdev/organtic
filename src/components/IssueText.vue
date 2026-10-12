<script setup lang="ts">
withDefaults(
  defineProps<{
    /** An error; without it, a warning. */
    bad?: boolean;
    as?: "span" | "p";
    /** The problem being worked on. */
    strong?: boolean;
  }>(),
  { as: "span" },
);
</script>

<template>
  <component :is="as" class="issue" :class="{ bad, strong }"><slot /></component>
</template>

<style scoped>
.issue{color:var(--color-warning);font:var(--font-body-sm);font-weight:500}
.issue.bad{color:var(--color-error)}
.issue.strong{font-weight:600}
</style>
