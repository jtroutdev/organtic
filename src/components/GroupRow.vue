<script setup lang="ts">
import { computed } from "vue";
import type { QueueGroup } from "../../core/types.ts";
import { STATUS, nameOf, plural } from "../store.ts";
import ListItem from "./ListItem.vue";
import TickBox from "./TickBox.vue";

// One group in the Matching list, with its tick box. A row of its own so that selecting or
// ticking redraws only the rows it changes, however long the list.
const props = defineProps<{
  item: QueueGroup;
  current: boolean;
  ticked: boolean;
}>();
defineEmits<{
  tick: [on: boolean, range: boolean];
  open: [event: MouseEvent];
}>();
// A file left out of the batch is no longer a problem to solve.
const problems = computed(
  () => props.item.files.filter((file) => !!file.issue && !file.excluded).length,
);
const chosen = computed(() =>
  props.item.chosen == null ? null : props.item.candidates[props.item.chosen],
);
</script>

<template>
  <div class="tickrow">
    <label class="pick">
      <TickBox
        :aria-label="`Select ${nameOf(item)}`"
        :checked="ticked"
        :tabindex="current ? 0 : -1"
        @click="
          $emit('tick', ($event.target as HTMLInputElement).checked, $event.shiftKey)
        "
      />
    </label>
    <ListItem
      plain
      :current="current"
      :tone="STATUS[item.status][0]"
      :note="STATUS[item.status][1]"
      :count="item.files.length"
      unit="files"
      :alert="problems ? plural(problems, 'problem') : ''"
      @click="$emit('open', $event)"
    >
      <template v-if="chosen">
        {{ chosen.title }}
        <span class="muted">({{ chosen.year ?? "year unknown" }})</span>
      </template>
      <template v-else>{{ item.parsedTitle || "Unnamed" }}</template>
    </ListItem>
  </div>
</template>

<style scoped>
/* A list item with a tick box beside it; the row takes over the item's rule, background and
   selected edge. Rows out of sight are not drawn; until one has been, it takes a list item's
   height. */
.tickrow{display:grid;grid-template-columns:auto minmax(0,1fr);border-bottom:1px solid var(--color-outline-subtle);content-visibility:auto;contain-intrinsic-size:auto var(--size-list-item)}
.tickrow:hover{background-image:linear-gradient(var(--color-hover) 0 0)}
.tickrow:has([aria-current="true"]){background-color:var(--color-accent-soft);outline:1px solid var(--color-accent);outline-offset:-1px}
.pick{padding-left:var(--space-surface)}
</style>
