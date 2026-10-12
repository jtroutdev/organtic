<script setup lang="ts">
defineProps<{
  checked?: boolean;
  /** Some, but not all, of what it stands for is ticked. */
  indeterminate?: boolean;
  disabled?: boolean;
}>();
</script>

<template>
  <input type="checkbox" :checked="checked" :indeterminate="indeterminate" :disabled="disabled" />
</template>

<style scoped>
/* Drawn here rather than by the browser, whose mixed state is a filled box with no dash. */
input{appearance:none;flex:none;width:var(--size-tick);height:var(--size-tick);margin:0;border:1px solid var(--color-outline);border-radius:var(--radius-sm);background:var(--color-surface-raised) center no-repeat;cursor:pointer}
input:hover:enabled:not(:checked,:indeterminate){border-color:var(--color-on-surface-muted);background-image:linear-gradient(var(--color-hover) 0 0)}
input:is(:checked,:indeterminate){background-color:var(--color-primary);border-color:var(--color-primary)}
input:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='oklch(100%25 0 0)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E")}
input:indeterminate{background-image:linear-gradient(var(--color-on-primary) 0 0);background-size:var(--space-sm) var(--space-2xs)}
input:disabled{opacity:var(--opacity-disabled);cursor:not-allowed}
@media (forced-colors:active){
  input{appearance:auto}
}
</style>
