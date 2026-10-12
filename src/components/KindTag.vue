<script setup lang="ts">
defineProps<{ kind: "tv" | "movie" }>();
</script>

<template>
  <span class="kind">{{ kind === "tv" ? "TV" : "FILM" }}</span>
</template>

<style scoped>
.kind{font:var(--font-code-sm);letter-spacing:var(--tracking-code);color:var(--color-on-surface-muted);border:1px solid var(--color-outline-subtle);border-radius:var(--radius-sm);padding:var(--space-xs);white-space:nowrap}
</style>
