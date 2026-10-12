<script setup lang="ts">
withDefaults(defineProps<{ width?: "short" | "medium" | "long" }>(), { width: "medium" });
</script>

<!-- Stands in for a line of text that is still loading. It is as tall as a line of the text
     around it, so what loads takes its place without anything moving. -->
<template>
  <span class="bone" :class="width" aria-hidden="true"></span>
</template>

<style scoped>
.bone{display:grid;align-items:center;height:1lh;max-width:100%}
.bone::before{content:"";height:.6lh;border-radius:var(--radius-sm);background:var(--color-outline-subtle);animation:appear var(--duration-fast) var(--duration-fast) backwards,pulse var(--duration-pulse) ease-in-out var(--duration-fast) infinite alternate}
.short{width:10ch}
.medium{width:22ch}
.long{width:38ch}
/* Held back for a moment, so a wait too short to notice shows nothing at all. */
@keyframes appear{from{opacity:0}}
@keyframes pulse{to{opacity:.5}}
@media (prefers-reduced-motion:reduce){
  .bone::before{animation:none}
}
@media (forced-colors:active){
  .bone::before{background:GrayText}
}
</style>
