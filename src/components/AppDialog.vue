<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  /** The id of the heading inside that names the dialog. */
  labelledby: string;
  /** Room for a poster beside the text. */
  wide?: boolean;
}>();
const dialog = ref<HTMLDialogElement>();
defineExpose({
  open: () => dialog.value?.showModal(),
  close: () => dialog.value?.close(),
});
</script>

<!-- Secondary information a person asked for. -->
<template>
  <dialog ref="dialog" class="help" :class="{ facts: wide }" :aria-labelledby="labelledby">
    <slot />
  </dialog>
</template>

<style scoped>
/* It sits on the scrim, with no shadow. */
.help{background:var(--color-surface-raised);color:var(--color-on-surface);border:1px solid var(--color-outline);border-radius:var(--radius-md);padding:var(--space-surface);max-width:min(520px,calc(100vw - 2 * var(--space-page)))}
.help[open]{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-surface)}
.help::backdrop{background:var(--color-scrim)}
.help :slotted(dl){display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--space-nested) var(--space-surface)}
.help :slotted(dt){display:flex;align-items:center;gap:var(--space-dense);white-space:nowrap}
.facts{width:min(640px,calc(100vw - 2 * var(--space-page)));max-width:none}
.facts :slotted(dl){align-items:baseline}
</style>
