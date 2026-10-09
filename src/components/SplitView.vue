<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  /** What the list on the left holds, e.g. "Groups". */
  list: string;
  /** What the right side shows, e.g. "Selected group". */
  detail: string;
  /** Key of the selected item. */
  current?: string;
}>();

// A new selection starts with its lists at the top, and stays in view in the side list.
const side = ref<HTMLElement>();
const pane = ref<HTMLElement>();
watch(
  () => props.current,
  async () => {
    await nextTick();
    for (const el of [pane.value, ...(pane.value?.querySelectorAll(".scroll,.strip") ?? [])])
      el?.scrollTo(0, 0);
    side.value
      ?.querySelector('.item[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  },
);

// The list is one tab stop; arrow keys move through it and select as they go.
function move(event: KeyboardEvent) {
  const items = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".item"),
  ];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = {
    ArrowDown: Math.min(at + 1, items.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (at < 0 || to === undefined) return;
  event.preventDefault();
  items[to]?.focus();
  items[to]?.click();
}
</script>

<template>
  <div class="panel split">
    <div class="side">
      <div class="sidehead"><slot name="head" /></div>
      <div ref="side" class="list" role="group" :aria-label="list" @keydown="move">
        <slot name="side" />
      </div>
    </div>
    <section ref="pane" class="detail" tabindex="-1" :aria-label="detail">
      <slot />
    </section>
  </div>
</template>
