---
version: alpha
name: Organtic
description: A desktop tool that renames and files media. Dense, flat, keyboard friendly, dark first.
colors:
  primary: "oklch(56.3% 0.246 280)"
  primary-hover: "oklch(57.7% 0.238 281)"
  primary-pressed: "oklch(53.1% 0.264 277)"
  on-primary: "oklch(100% 0 0)"
  accent: "oklch(72.9% 0.149 288)"
  accent-soft: "oklch(27.6% 0.102 284)"
  background: "oklch(16.4% 0.027 290)"
  surface: "oklch(19.8% 0.034 290)"
  surface-raised: "oklch(22.8% 0.04 290)"
  on-surface: "oklch(93.9% 0.016 290)"
  on-surface-muted: "oklch(69.7% 0.045 290)"
  outline: "oklch(53% 0.059 290)"
  outline-subtle: "oklch(30.3% 0.052 290)"
  success: "oklch(79.4% 0.114 164)"
  success-soft: "oklch(29.7% 0.044 166)"
  warning: "oklch(80.5% 0.127 74)"
  warning-soft: "oklch(29.4% 0.045 77)"
  error: "oklch(73.5% 0.147 16)"
  error-soft: "oklch(27.9% 0.062 13)"
  hover: "oklch(93.9% 0.016 290 / 0.06)"
  pressed: "oklch(93.9% 0.016 290 / 0.12)"
  scrim: "oklch(14.5% 0.024 290 / 0.55)"
  shadow: "oklch(14.5% 0.024 290 / 0.35)"
  primary-light: "oklch(48.1% 0.294 272)"
  primary-hover-light: "oklch(50.7% 0.279 275)"
  primary-pressed-light: "oklch(43.3% 0.269 271)"
  on-primary-light: "oklch(100% 0 0)"
  accent-light: "oklch(48.1% 0.294 272)"
  accent-soft-light: "oklch(92.5% 0.039 292)"
  background-light: "oklch(95.5% 0.012 290)"
  surface-light: "oklch(97.6% 0.008 290)"
  surface-raised-light: "oklch(100% 0 0)"
  on-surface-light: "oklch(21.1% 0.041 290)"
  on-surface-muted-light: "oklch(48% 0.05 290)"
  outline-light: "oklch(62% 0.044 290)"
  outline-subtle-light: "oklch(87.7% 0.025 290)"
  success-light: "oklch(49.8% 0.101 161)"
  success-soft-light: "oklch(93.7% 0.026 166)"
  warning-light: "oklch(48.1% 0.11 60)"
  warning-soft-light: "oklch(92.9% 0.048 77)"
  error-light: "oklch(49.7% 0.188 23)"
  error-soft-light: "oklch(91.6% 0.036 11)"
  hover-light: "oklch(21.1% 0.041 290 / 0.06)"
  pressed-light: "oklch(21.1% 0.041 290 / 0.12)"
typography:
  headline-lg:
    fontFamily: Readex Pro
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
  headline-md:
    fontFamily: Readex Pro
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  title-lg:
    fontFamily: Red Hat Text
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.3
  title-md:
    fontFamily: Red Hat Text
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.3
  body-md:
    fontFamily: Red Hat Text
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Red Hat Text
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  label-lg:
    fontFamily: Red Hat Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
  label-md:
    fontFamily: Red Hat Text
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.3
  label-sm:
    fontFamily: Red Hat Text
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.06em
  code-md:
    fontFamily: Red Hat Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
  code-sm:
    fontFamily: Red Hat Mono
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1
rounded:
  none: 0px
  sm: 4px
  md: 6px
  full: 999px
spacing:
  2xs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 40px
  gutter: 16px
  control: 32px
  control-sm: 24px
components:
  button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: 0 12px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: 0 12px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  button-quiet:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: 0 8px
  button-compact:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.code-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control-sm}"
    padding: 0 8px
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: 0 12px
  checkbox:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.sm}"
    size: 16px
  checkbox-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  tab:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: 0 8px
  tab-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.on-surface}"
  segment:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-lg}"
    height: "{spacing.control}"
    padding: 0 12px
  segment-on:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.background}"
  list-item:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    padding: 8px 12px
  list-item-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.on-surface}"
  pill-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  pill-suggestion:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  pill-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  pill-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  pill-off:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  tag-kind:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.sm}"
    padding: 4px
  banner-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  banner-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  banner-ask:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 16px
  match-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 8px
  match-card-chosen:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.on-surface}"
  popover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 4px
  dialog:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 16px
  state-layer-hover:
    backgroundColor: "{colors.hover}"
  state-layer-pressed:
    backgroundColor: "{colors.pressed}"
  keycap:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.code-md}"
    rounded: "{rounded.sm}"
    padding: 4px 8px
---

# Organtic

## Overview

Organtic is a desktop app for renaming and filing media. People use it in a window that is often short, to work through long lists. The interface is dense, flat and quiet: a list on the left, the selected item in full on the right, and one clear next action.

Vertical space is the scarcest thing in the app. Every rule below prefers the choice that keeps rows short and the window still. The window itself never scrolls; only lists do.

Every neutral sits on one hue, 290 in oklch, a blue violet; the brand colours sit beside it between 272 and 288. A new neutral takes hue 290 and changes only lightness and chroma. Dark is the design. Every colour token above is its dark value, set on `:root`, and every screen is designed and reviewed in dark. Light is derived afterwards: a token with the suffix `-light` overrides the same CSS variable under `prefers-color-scheme: light`, and must hold the same contrast as its dark partner.

Token names here and CSS variable names are the same word with a prefix for its kind: `--color-on-surface`, `--font-body-sm`, `--space-md`, `--radius-md`, `--size-control`. A value that is not a token does not appear in a component rule.

## Colors

- **Primary (oklch(56.3% 0.246 280))** is a fill that carries a white label: the primary button, a ticked box, the current step badge. It has a hover and a pressed step.
- **Accent (oklch(72.9% 0.149 288))** is text, a ring or a bar drawn on a surface: the focus ring, the progress fill, the match score, a web link. They are two values, so each use picks by job, not by look. The light theme happens to give them one value.
- **Accent soft (oklch(27.6% 0.102 284))** is the tint for the place you are in: the selected row, the current tab, the chosen match.
- **Background, surface, surface raised** are three steps of the same tinted neutral. Background is the window. Surface is the detail pane. Surface raised is panels, cards, controls and pop-ups.
- **On surface (oklch(93.9% 0.016 290))** is body text. **On surface muted (oklch(69.7% 0.045 290))** is secondary text, labels and resting tabs.
- **Outline (oklch(53% 0.059 290))** bounds anything a person acts on: buttons, inputs, tick boxes, match cards, the drop zone. It holds 3:1 against all three surfaces.
- **Outline subtle (oklch(30.3% 0.052 290))** is a rule between rows, the edge of a static panel and the progress track. Nothing depends on seeing it.
- **Hover and pressed** are the on surface colour at 6% and 12%. They are layers, laid over whatever a control or row sits on, never fills in their own right.
- **Success, warning, error** are text colours. Each has a soft partner that is the fill behind that text and nothing else.
- **Scrim and shadow** are the same near black at two strengths, for the dialog backdrop and the pop-up shadow.

Every colour is written in `oklch()`: tokens, one-off mixes, shadows and scrims. A colour with transparency uses the slash form, `oklch(L C H / alpha)`. A colour derived from another uses relative syntax, `oklch(from <colour> L C h)`, which keeps the source hue: the tally shade and number are made this way from the status colour. The one place a hex value remains is the Electron window's `backgroundColor`, which does not accept oklch and mirrors the background token. Hex, `rgb()`, `hsl()` and named colours do not appear in the stylesheet or in markup. Values stay inside the sRGB gamut.

Contrast targets follow WCAG 2.2 AA: 4.5:1 for text, 3:1 for the edge or fill that makes a control or its state visible. All text pairs pass in both themes. The selection tint alone is under 3:1 against its neighbours, so a selected item always carries the accent edge as well.

## Typography

Three families. **Readex Pro** is the display face, used only for the page heading, summary numbers and the wordmark. **Red Hat Text** is everything else that is prose or a label. **Red Hat Mono** is for anything that is a file name, a path, a code or a count.

Eleven levels. Body is 14px. Nothing is smaller than 11px, and there are no half pixel sizes.

- `headline-lg` page heading and summary numbers. `headline-md` wordmark.
- `title-lg` the title of the selected item. `title-md` a section heading inside a pane.
- `body-md` body. `body-sm` second lines, field labels, hints.
- `label-lg` buttons, tabs, steps. `label-md` pills and the match score. `label-sm` section labels and tree tags, always in capitals with 0.06em tracking.
- `code-md` paths, episode codes, placeholders, key caps. `code-sm` the step badge, counts and the kind tag.

Weight carries state in two places only: the current step and the active list view go from 500 to 600.

## Layout

Spacing is a scale on a base of 4: 2, 4, 8, 12, 16, 24, 32, 40. When a design calls for a value between two steps, round down on the vertical axis and up on the horizontal one.

Page structure and scroll regions are built with CSS grid and `overflow`. Flex is for content flow inside a component: a wrapping row of buttons, a run of pills. The region that fills takes `minmax(0, 1fr)`; the list inside it scrolls.

Every screen is the same split: a list between 220 and 300px wide on the left, the selected item on the right. Content is never capped in width. Below 760px the split stacks.

The gutter is 16px. Every control is 32px tall: buttons, inputs, tabs, steps, segmented sets, list view tabs and option rows. A compact 24px button exists for use inside a table row and nowhere else.

Wizard steps (Add files, Review, Preview, Done) end in a footer: the destructive or back action on the left, a secondary action second from the right, the step's one primary action on the far right. History and Settings keep their actions at the top.

## Elevation & Depth

The app is flat. Depth is a step of surface colour and a 1px edge. There is one shadow, under a pop-up. A dialog sits on the scrim with the stronger outline and no shadow. Layers are named: sticky column headings, then overlays, then the skip link.

## Shapes

Three radii. `sm` 4px for small things: tick boxes, tags, key caps, posters, option rows. `md` 6px for controls, panels, cards and banners. `full` for pills, counts, badges and progress bars. Edges are 1px. The focus ring is 2px.

## Components

All interactive components answer the same states.

- **Hover** lays the hover layer over the control and brightens its edge to on surface muted. The control lifts, on any surface, including a selected row.
- **Pressed** lays the pressed layer instead. The primary button is the one exception: it has hover and pressed fills of its own, so its white label keeps its contrast.
- **Focus** is a 2px accent ring, offset 2px outside the control, or drawn inside the row for list items.
- **Unavailable** is 50% opacity with a not-allowed pointer, for a control that is off for a reason of its own.
- **Busy** keeps the resting look and changes only the pointer. A running action never dims the screen. Waiting shows where it was started (the button) or where its result lands (a bar on the rule under a heading, a pulsing tally).
- **Invalid** gives an input an error edge and a sentence underneath that says why.

**Button.** Default, primary and quiet. One primary per step. Quiet is for the least important action in a row; it has no fill or edge at rest and shows whatever surface it sits on, as do tabs, segments and the kind tag. Their tokens name the surface they are usually on. The compact button is for a value in a table row that opens an editor, such as an episode code.

**Input and field.** A field is a `body-sm` label above a 32px input. Mono inputs use `code-md`.

**Tick box.** 16px, drawn by the app so that the mixed state shows a dash. Its label is part of the target.

**Tabs, steps, list views.** The current tab takes the accent soft tint. A finished step shows a success badge and is a button; the current step shows a primary badge; a step not yet reachable is plain text. List views are text tabs resting on the rule above the list, each with a count.

**Segmented set.** Two or three options in one outlined control. The option that is on takes the inverted fill.

Two selection idioms, never mixed: the **accent tint with a 1px accent edge** marks where you are (a tab, a row, a chosen match). The edge is drawn inside the item and above its contents, so it runs unbroken across a list item's tally. The **inverted fill** marks which option of a small set is on.

**List item and tally.** Two lines and, flush right, a count on a shade mixed from its status colour.

**Pill and tag.** Five tones: success, suggestion, warning, error, off. Words only. A pill is never a button.

**Banner.** One sentence and at most one default button, above the page.

**Match card.** Poster, title, year, fit and actions. The chosen card takes the accent edge and tint.

**File row.** Before and after side by side in mono. The problem being worked on is tinted warning soft from edge to edge.

**Pop-up and dialog.** A pop-up is a list of 32px option rows under the button that opened it. A dialog is for secondary information a person asked for, such as match details.

## Do's and Don'ts

- Do keep rows short. When in doubt, take the smaller vertical step.
- Do put progress next to the action that started it or in the place its result will land.
- Do pair every status colour with words.
- Do show before and after side by side.
- Do put secondary information behind a Details button.
- Don't design a screen in light first. Light is checked after dark is settled.
- Don't mark the selected item with a stripe on its left edge.
- Don't style an action as a link. Links are only for things that open a web page.
- Don't use arrow characters in the interface.
- Don't put a dot or an icon inside a pill.
- Don't dim, shift or flash the screen while something loads.
- Don't use outline subtle as the only edge of something a person acts on.
- Don't write a colour in hex, rgb, hsl or by name. Use oklch.
- Don't write a raw colour, size or duration in a component rule. Add a token or use one.
