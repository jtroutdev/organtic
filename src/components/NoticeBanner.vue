<script setup lang="ts">
defineProps<{ tone: "ask" | "ok" | "bad" }>();
</script>

<!-- One sentence and at most one default button. -->
<template>
  <div class="banner" :class="tone">
    <span><slot /></span>
    <slot name="action" />
  </div>
</template>

<style scoped>
.banner{border-radius:var(--radius-md);padding:var(--space-nested) var(--space-surface);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-surface);align-items:center}
.banner.bad{background:var(--color-error-soft);color:var(--color-error)}
.banner.ok{background:var(--color-success-soft);color:var(--color-success)}
.banner.ask{background:var(--color-accent-soft)}
.banner.bad :slotted(.btn),.banner.ok :slotted(.btn){color:var(--color-on-surface)}
</style>
