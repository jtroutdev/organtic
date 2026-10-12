<script setup lang="ts">
defineProps<{
  label: string;
  value: number;
  max: number;
  /** Drawn over the rule beneath a panel's heading, taking no room of its own. */
  under?: boolean;
}>();
</script>

<template>
  <progress class="progress" :class="{ under }" :aria-label="label" :value="value" :max="max"></progress>
</template>

<style scoped>
.progress{appearance:none;display:block;width:100%;height:var(--space-xs);border:0;background:var(--color-outline-subtle);border-radius:var(--radius-full);overflow:hidden}
.progress::-webkit-progress-bar{background:transparent}
.progress::-webkit-progress-value{background:var(--color-accent);transition:width var(--duration-fast)}
.progress::-moz-progress-bar{background:var(--color-accent)}
.progress.under{position:absolute;inset:auto 0 -1px;height:var(--space-2xs);border-radius:0}
@media (prefers-reduced-motion:reduce){
  .progress::-webkit-progress-value{transition:none}
}
@media (forced-colors:active){
  .progress{forced-color-adjust:none}
}
</style>
