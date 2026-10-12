<script setup lang="ts">
import KindTag from "./KindTag.vue";
import StatusPill from "./StatusPill.vue";

defineProps<{
  kind: "tv" | "movie";
  /** ok, sug, warn, bad or off. */
  tone: string;
  status: string;
}>();
</script>

<!-- What the selected group is and where it stands; the slot is its title. -->
<template>
  <div class="row grouphead">
    <KindTag :kind="kind" />
    <h2 class="title"><slot /></h2>
    <StatusPill :tone="tone">{{ status }}</StatusPill>
  </div>
</template>

<style scoped>
.grouphead{gap:var(--space-dense) var(--space-nested);min-width:0;min-height:var(--size-control)}
</style>
