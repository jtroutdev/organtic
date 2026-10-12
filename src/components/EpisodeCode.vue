<script setup lang="ts">
defineProps<{
  /** A compact button that opens the season and episode form; plain text otherwise. */
  editable?: boolean;
  /** Something is wrong with the file the code belongs to. */
  problem?: boolean;
}>();
</script>

<template>
  <button v-if="editable" class="ep" :class="{ problem }" type="button"><slot /></button>
  <span v-else class="ep" :class="{ problem }"><slot /></span>
</template>

<style scoped>
.ep{font:var(--font-code-md);color:var(--color-accent);white-space:nowrap}
/* The compact button, for use inside a table row only. */
button.ep{height:var(--size-control-sm);border:1px solid var(--color-outline);border-radius:var(--radius-sm);background:var(--color-surface-raised);padding:0 var(--space-sm);color:var(--color-on-surface);line-height:1}
button.ep:hover{border-color:var(--color-on-surface-muted);background-image:linear-gradient(var(--color-hover) 0 0)}
button.ep:active{background-image:linear-gradient(var(--color-pressed) 0 0)}
.ep.problem{color:var(--color-warning)}
</style>
