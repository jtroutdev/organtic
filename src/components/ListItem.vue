<script setup lang="ts">
defineProps<{
  current: boolean;
  tone: string;
  note: string;
  count?: number | string;
  /** What `count` counts, for screen readers, e.g. "files". */
  unit?: string;
}>();
</script>

<template>
  <button
    class="item"
    type="button"
    :aria-current="current"
    :tabindex="current ? 0 : -1"
  >
    <span class="dot" :class="tone" aria-hidden="true"></span>
    <strong><slot /></strong>
    <span v-if="count !== undefined && count !== ''" class="n"
      >{{ count }}<span class="sr-only"> {{ unit }}</span></span
    >
    <small>{{ note }}</small>
  </button>
</template>
