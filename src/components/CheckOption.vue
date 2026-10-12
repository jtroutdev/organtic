<script setup lang="ts">
import TickBox from "./TickBox.vue";

defineProps<{
  label: string;
  /** A second line saying what the option does. */
  note: string;
  checked: boolean;
  disabled?: boolean;
}>();
defineEmits<{ change: [checked: boolean] }>();
</script>

<template>
  <label class="check">
    <TickBox
      :checked="checked"
      :disabled="disabled"
      @change="$emit('change', ($event.target as HTMLInputElement).checked)"
    />
    <span
      >{{ label }}<small>{{ note }}</small></span
    >
  </label>
</template>

<style scoped>
.check{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--space-nested);align-items:start}
/* Set down to the middle of the first line of its label. */
.check input{translate:0 var(--space-2xs)}
.check small{display:block;color:var(--color-on-surface-muted);font:var(--font-body-sm)}
</style>
