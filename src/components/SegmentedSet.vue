<script setup lang="ts" generic="T extends string">
import { vTip } from "../tip.ts";

defineProps<{
  /** What the set chooses, for screen readers. */
  label: string;
  options: readonly (readonly [value: T, label: string, tip?: string])[];
  modelValue: T;
  disabled?: boolean;
}>();
defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<template>
  <div class="seg" role="group" :aria-label="label">
    <button
      v-for="[value, name, tip] in options"
      :key="value"
      v-tip="tip"
      type="button"
      :aria-pressed="modelValue === value"
      :disabled="disabled"
      @click="$emit('update:modelValue', value)"
    >
      {{ name }}
    </button>
  </div>
</template>

<style scoped>
/* Which option of a small set is on: the inverted fill. */
.seg{display:inline-flex;height:var(--size-control);border:1px solid var(--color-outline);border-radius:var(--radius-md);overflow:hidden}
.seg button{border:0;background:none;padding:0 var(--space-md);white-space:nowrap;color:var(--color-on-surface-muted);font:var(--font-label-lg)}
.seg button:hover:not([aria-pressed="true"]){color:var(--color-on-surface);background-image:linear-gradient(var(--color-hover) 0 0)}
.seg button:active:not([aria-pressed="true"]){background-image:linear-gradient(var(--color-pressed) 0 0)}
.seg button[aria-pressed="true"]{background:var(--color-on-surface);color:var(--color-background)}
.seg button:focus-visible{outline-offset:-2px}
@media (forced-colors:active){
  .seg button[aria-pressed="true"]{outline:2px solid Highlight;outline-offset:-2px}
}
</style>
