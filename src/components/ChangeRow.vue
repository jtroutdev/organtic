<script setup lang="ts">
import { vTip } from "../tip.ts";
import IssueText from "./IssueText.vue";
import StatusPill from "./StatusPill.vue";

defineProps<{
  /** What was there before, or what kind of change it is. */
  before: string;
  beforeTip?: string;
  after: string;
  afterTip?: string;
  /** `before` is the old name of `after`. */
  renamed?: boolean;
  /** What became of the change, when it is not simply done: [tone, words]. */
  outcome?: [tone: string, label: string];
  /** Why it failed or was skipped. */
  reason?: string;
}>();
</script>

<!-- What a batch did to one file: before and after side by side. -->
<template>
  <div class="mono oprow" :class="{ told: outcome }">
    <span v-tip="beforeTip" class="muted">{{ before }}</span
    ><span v-tip="afterTip"><span v-if="renamed" class="sr-only">became </span>{{ after }}</span>
    <StatusPill v-if="outcome" :tone="outcome[0]">{{ outcome[1] }}</StatusPill>
    <IssueText v-if="reason" class="why" :bad="outcome?.[0] === 'bad'">{{ reason }}</IssueText>
  </div>
</template>

<style scoped>
.oprow{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);column-gap:var(--space-surface);padding:var(--space-dense) 0;border-bottom:1px solid var(--color-outline-subtle)}
/* One width for every pill's column, so the names line up from row to row. */
.oprow.told{grid-template-columns:minmax(0,2fr) minmax(0,3fr) calc(var(--size-control)*3);align-items:center;row-gap:var(--space-dense)}
.oprow.told>.pill{justify-self:end}
.why{grid-column:1/-1}
</style>
