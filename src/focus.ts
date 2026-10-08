import { nextTick } from "vue";

/** `v-focus`: moves focus to a control when it appears, e.g. the first field of a form just opened. */
export const vFocus = { mounted: (element: HTMLElement) => element.focus() };

/** Moves focus once the screen has updated; used when the control that had focus is gone. */
export async function focusOn(selector: string) {
  await nextTick();
  document.querySelector<HTMLElement>(selector)?.focus();
}
