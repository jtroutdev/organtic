<script setup lang="ts">
const model = defineModel<string>();
</script>

<template>
  <select v-model="model" class="input">
    <slot />
  </select>
</template>

<style scoped src="./input.css"></style>
