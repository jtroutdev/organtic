<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<!-- A label above its control. -->
<template>
  <label class="field">{{ label }} <slot /></label>
</template>

<style scoped>
.field{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-dense);font:var(--font-body-sm);font-weight:500;color:var(--color-on-surface-muted)}
.field :slotted(.input){color:var(--color-on-surface);font:var(--font-body-md)}
.field :slotted(.input.mono){font:var(--font-code-md);font-weight:400}
</style>
