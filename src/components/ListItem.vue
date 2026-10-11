<script setup lang="ts">
defineProps<{
  current: boolean;
  tone: string;
  note: string;
  count?: number | string;
  /** What `count` counts, for screen readers, e.g. "files". */
  unit?: string;
  /** Something wrong inside the item, shown after the note, e.g. "3 problems". */
  alert?: string;
}>();
</script>

<template>
  <button
    class="item"
    type="button"
    :aria-current="current"
    :tabindex="current ? 0 : -1"
  >
    <span class="text">
      <strong><slot /></strong>
      <small
        >{{ note }}<span v-if="alert" class="issue"> · {{ alert }}</span></small
      >
    </span>
    <!-- The count, on the item's status colour. -->
    <span v-if="count !== undefined && count !== ''" class="tally" :class="tone"
      ><span>{{ count }}<span class="sr-only"> {{ unit }}</span></span></span
    >
  </button>
</template>
