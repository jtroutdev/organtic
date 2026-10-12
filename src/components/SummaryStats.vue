<script setup lang="ts">
defineProps<{ stats: readonly (readonly [count: number, label: string])[] }>();
</script>

<!-- A run of counts, each with what it counts. -->
<template>
  <div class="stats">
    <span v-for="[count, label] in stats" :key="label"
      ><b>{{ count }}</b
      >{{ label }}</span
    >
  </div>
</template>

<style scoped>
.stats{display:flex;flex-wrap:wrap;gap:var(--space-dense) var(--space-surface);font-variant-numeric:tabular-nums}
.stats>span{display:inline-flex;align-items:baseline;gap:var(--space-nested)}
.stats b{font:var(--font-headline-lg);line-height:1}
</style>
