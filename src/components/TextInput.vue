<script setup lang="ts">
const model = defineModel<string | number>();
defineProps<{
  invalid?: boolean;
  /** For a value that is a path, a template or a code. */
  mono?: boolean;
}>();
</script>

<template>
  <input
    v-model="model"
    class="input"
    :class="{ mono }"
    :aria-invalid="invalid ? 'true' : undefined"
  />
</template>

<style scoped src="./input.css"></style>
