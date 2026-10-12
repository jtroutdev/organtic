<script setup lang="ts">
defineProps<{
  /** ok, sug, warn, bad or off. */
  tone: string;
}>();
</script>

<template>
  <p class="note" :class="tone"><slot /></p>
</template>

<style scoped>
/* In the status tone and as wide as the pane's content. */
.note{border-radius:var(--radius-md);padding:var(--space-nested) var(--space-surface);font:var(--font-body-sm)}
.note.ok{background:var(--color-success-soft)}
.note.sug{background:var(--color-accent-soft)}
.note.warn{background:var(--color-warning-soft)}
.note.bad{background:var(--color-error-soft)}
.note.off{background:var(--color-surface);box-shadow:inset 0 0 0 1px var(--color-outline-subtle)}
</style>
