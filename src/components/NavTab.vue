<script setup lang="ts">
defineProps<{
  /** The page this tab opens is the one on screen. */
  current?: boolean;
}>();
</script>

<template>
  <button class="tab" type="button" :aria-current="current ? 'page' : undefined"><slot /></button>
</template>

<style scoped>
.tab{height:var(--size-control);background:none;border:0;border-radius:var(--radius-md);padding:0 var(--space-sm);color:var(--color-on-surface-muted);font:var(--font-label-lg)}
.tab:hover{color:var(--color-on-surface);background-image:linear-gradient(var(--color-hover) 0 0)}
.tab:active{background-image:linear-gradient(var(--color-pressed) 0 0)}
/* Where you are: the accent tint with an accent edge inside it. */
.tab[aria-current="page"]{background-color:var(--color-accent-soft);box-shadow:inset 0 0 0 1px var(--color-accent);color:var(--color-on-surface)}
@media (forced-colors:active){
  .tab[aria-current="page"]{outline:2px solid Highlight;outline-offset:-2px}
}
</style>
