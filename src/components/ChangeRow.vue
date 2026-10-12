<script setup lang="ts">
import { vTip } from "../tip.ts";

defineProps<{
  /** What was there before, or what kind of change it is. */
  before: string;
  beforeTip?: string;
  after: string;
  afterTip?: string;
  /** `before` is the old name of `after`. */
  renamed?: boolean;
}>();
</script>

<!-- What a batch did to one file: before and after side by side. -->
<template>
  <div class="mono oprow">
    <span v-tip="beforeTip" class="muted">{{ before }}</span
    ><span v-tip="afterTip"><span v-if="renamed" class="sr-only">became </span>{{ after }}</span>
  </div>
</template>

<style scoped>
.oprow{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);column-gap:var(--space-surface);padding:var(--space-dense) 0;border-bottom:1px solid var(--color-outline-subtle)}
</style>
