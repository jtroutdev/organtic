<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { vTip } from "../tip.ts";
import ActionButton from "./ActionButton.vue";
import TickBox from "./TickBox.vue";

const props = defineProps<{
  /** Names the list of options and links it to its button. */
  id: string;
  label: string;
  options: readonly { key: string; label: string; note: string; checked: boolean }[];
}>();
defineEmits<{ toggle: [key: string, box: HTMLInputElement] }>();
const on = computed(() => props.options.filter((option) => option.checked).length);

// The menu stays open while options are ticked. Escape, a click outside it or its button closes it.
const menu = ref<HTMLElement>();
const open = ref(false);
function close(refocus: boolean) {
  open.value = false;
  if (refocus) menu.value?.querySelector("button")?.focus();
}
const outside = (event: PointerEvent) => {
  if (!menu.value?.contains(event.target as Node)) close(false);
};
const escape = (event: KeyboardEvent) => {
  if (event.key === "Escape") close(true);
};
function listen(on: boolean) {
  const change = on ? document.addEventListener : document.removeEventListener;
  change.call(document, "pointerdown", outside as EventListener);
  change.call(document, "keydown", escape as EventListener);
}
watch(open, listen);
onUnmounted(() => listen(false));
</script>

<!-- A button that opens a list of tick boxes beneath it. -->
<template>
  <div ref="menu" class="menu">
    <ActionButton
      aria-haspopup="true"
      :aria-controls="id"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ label }}<span class="n">{{ on }}<span class="sr-only"> turned on</span></span>
    </ActionButton>
    <div v-if="open" :id="id" class="pop" role="group" :aria-label="label">
      <label v-for="option in options" :key="option.key" v-tip="option.note" class="opt">
        <TickBox
          :checked="option.checked"
          @change="$emit('toggle', option.key, $event.target as HTMLInputElement)"
        />
        {{ option.label }}<span class="sr-only">. {{ option.note }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.menu{position:relative}
.n{font:var(--font-code-sm);color:var(--color-on-surface-muted)}
.pop{position:absolute;z-index:var(--z-overlay);top:calc(100% + var(--space-dense));right:0;width:max-content;max-width:calc(100vw - 2*var(--space-page));display:grid;grid-template-columns:minmax(0,1fr);padding:var(--space-dense);background:var(--color-surface-raised);border:1px solid var(--color-outline);border-radius:var(--radius-md);box-shadow:var(--shadow-overlay)}
.opt{display:flex;align-items:center;gap:var(--space-nested);min-height:var(--size-control);padding:0 var(--space-nested);border-radius:var(--radius-sm);cursor:pointer}
.opt:hover{background-image:linear-gradient(var(--color-hover) 0 0)}
</style>
