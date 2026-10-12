<script setup lang="ts">
withDefaults(
  defineProps<{
    /** A single row: content on the left, a control on the right. */
    bar?: boolean;
    as?: "div" | "details";
  }>(),
  { as: "div" },
);
</script>

<template>
  <component :is="as" class="card" :class="{ bar }"><slot /></component>
</template>

<style scoped>
.card{background:var(--color-surface-raised);border:1px solid var(--color-outline-subtle);border-radius:var(--radius-md);padding:var(--space-surface);display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-surface)}
.card.bar{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--space-surface);padding:var(--space-nested) var(--space-surface)}
</style>
