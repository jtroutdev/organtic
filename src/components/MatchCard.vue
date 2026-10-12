<script setup lang="ts">
import type { QueueCandidate } from "../../core/types.ts";
import { vTip } from "../tip.ts";
import ActionButton from "./ActionButton.vue";
import PosterImage from "./PosterImage.vue";

defineProps<{
  candidate: QueueCandidate;
  /** Where the match came from, e.g. "TMDB". */
  source: string;
  /** This is the group's match; it takes the accent edge and tint. */
  chosen: boolean;
  /** The label on the chosen card: "Chosen" once confirmed, else "Suggested". */
  confirmed?: boolean;
  disabled?: boolean;
}>();
defineEmits<{ use: []; details: [] }>();
</script>

<template>
  <div class="cand" :class="{ on: chosen }">
    <PosterImage
      :src="candidate.posterUrl"
      :thumb="candidate.posterThumbUrl"
      :placeholder="candidate.kind === 'tv' ? 'TV' : 'FILM'"
      lazy
    />
    <strong v-tip.clipped="candidate.title"
      >{{ candidate.title }}
      <span class="muted">({{ candidate.year ?? "year unknown" }})</span></strong
    >
    <span class="fit" :class="{ low: candidate.weak }"> {{ candidate.fit }} · {{ source }} </span>
    <span class="row">
      <span v-if="chosen" class="label">{{ confirmed ? "Chosen" : "Suggested" }}</span>
      <ActionButton
        v-else
        :disabled="disabled"
        :aria-label="`Use this: ${candidate.title} (${candidate.year ?? 'year unknown'})`"
        @click="$emit('use')"
      >
        Use this
      </ActionButton>
      <ActionButton
        aria-haspopup="dialog"
        :aria-label="`Details of ${candidate.title} (${candidate.year ?? 'year unknown'})`"
        @click="$emit('details')"
      >
        Details
      </ActionButton>
    </span>
  </div>
</template>

<style scoped>
/* A match is something you act on, so it takes the stronger outline. */
.cand{display:grid;grid-template:auto auto minmax(0,1fr)/var(--size-poster) minmax(0,1fr);gap:0 var(--space-nested);align-items:start;border:1px solid var(--color-outline);border-radius:var(--radius-md);padding:var(--space-nested);background:var(--color-surface)}
.cand.on{border-color:var(--color-accent);background:var(--color-accent-soft)}
.cand .poster{grid-row:1/-1}
.cand strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cand .row{align-self:end;min-height:var(--size-control)}
.fit{font:var(--font-label-md);color:var(--color-accent)}
.fit.low{color:var(--color-warning)}
@media (forced-colors:active){
  .cand.on{outline:2px solid Highlight;outline-offset:-2px}
}
</style>
