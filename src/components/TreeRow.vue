<script setup lang="ts">
defineProps<{
  /** How many folders deep the row sits. */
  depth: number;
  folder?: boolean;
  /** The row cannot be made as planned. */
  clash?: boolean;
}>();
</script>

<template>
  <div class="node" role="listitem" :class="{ dir: folder, clash }" :data-depth="depth">
    <slot />
  </div>
</template>

<style scoped>
/* Each level of the tree steps in by one space; the row's depth is read from its attribute. */
.node{padding:var(--space-dense) 0 var(--space-dense) calc(attr(data-depth type(<number>), 0) * var(--space-surface));display:flex;flex-wrap:wrap;gap:var(--space-dense) var(--space-nested);align-items:baseline}
.node.dir{font-weight:500}
.node.clash{color:var(--color-error)}
</style>
