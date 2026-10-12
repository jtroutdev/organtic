<script setup lang="ts">
import ActionButton from "./ActionButton.vue";

defineProps<{
  /** How much is selected, e.g. "3 groups selected". */
  summary: string;
}>();
defineEmits<{ submit: []; clear: [] }>();
</script>

<!-- What can be done with the ticked items; Escape or its last button clears the ticks. -->
<template>
  <form
    class="row numbers movebar"
    @submit.prevent="$emit('submit')"
    @keydown.esc="$emit('clear')"
  >
    <strong>{{ summary }}</strong>
    <slot />
    <ActionButton variant="quiet" @click="$emit('clear')">Clear selection</ActionButton>
  </form>
</template>

<style scoped>
.movebar{background:var(--color-accent-soft);border-radius:var(--radius-md);padding:var(--space-nested) var(--space-surface)}
.movebar :slotted(label){color:var(--color-on-surface)}
</style>
