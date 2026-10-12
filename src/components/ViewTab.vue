<script setup lang="ts">
defineProps<{ pressed: boolean; count: number }>();
</script>

<!-- One view of a list, with how many items it holds. -->
<template>
  <button class="view" type="button" :aria-pressed="pressed">
    <slot /><span class="count">{{ count }}</span>
  </button>
</template>

<style scoped>
.view{display:inline-flex;align-items:center;gap:var(--space-dense);height:var(--size-control);padding:0;border:0;border-bottom:2px solid transparent;background:none;color:var(--color-on-surface-muted);font:var(--font-body-sm);font-weight:500;white-space:nowrap}
.view:hover{color:var(--color-on-surface)}
.view[aria-pressed="true"]{border-color:var(--color-on-surface);color:var(--color-on-surface);font-weight:600}
.count{padding:var(--space-xs) var(--space-sm);border-radius:var(--radius-full);background:var(--color-background);box-shadow:inset 0 0 0 1px var(--color-outline-subtle);color:var(--color-on-surface);font:var(--font-code-sm)}
.view[aria-pressed="true"] .count{background:var(--color-on-surface);box-shadow:none;color:var(--color-background)}
</style>
