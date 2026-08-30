# Design

Brandcast TV's console is designed as a **macOS desktop application**, not a web
dashboard that happens to run in a browser. Every route is a window scene: a source
list on the left, a translucent toolbar on top, grouped inset content in the middle.

The reference is Apple's own utilities under macOS Tahoe: System Settings, Console,
Photos, App Store Connect, TestFlight.

## Theme

**The scene**: a retail operations lead at a laptop in a back office, daylight through
a window behind them, screen brightness near maximum, checking twelve store displays
between two other tasks. They also open this at 9pm from the sofa on a dark laptop.

That sentence does not force one answer. It forces **both**, which is the macOS answer:
follow the system appearance, and make both modes first-class.

Default is `System`. Manual `Light` / `Dark` override lives in the toolbar and persists
to `localStorage`. `color-scheme` is set so native scrollbars, form controls, and
selection follow suit.

## Color

Strategy: **Restrained.** Tinted neutrals plus one accent, and semantic color that only
ever means state.

The system is a direct port of Apple's semantic color vocabulary. Names are Apple's, so
the intent is unambiguous.

### Accent

macOS system blue. The only saturated non-semantic color in the product.

| Token | Light | Dark |
|---|---|---|
| `--color-accent` | `oklch(0.548 0.207 262)` | `oklch(0.664 0.181 258)` |

Used for: primary buttons, the selected sidebar row, focus rings, links, active
segment in a segmented control. Never for decoration, never as a gradient.

### Neutrals

Tinted toward the accent hue (262) at chroma 0.004 to 0.012. Never `#000`, never `#fff`.
Light mode's canvas is `oklch(0.968 0.002 262)` and content sits **above** it on white.
Dark mode's canvas is `oklch(0.178 0.005 262)`, content on `oklch(0.216 0.006 262)`.

This is the macOS window model: a recessed window background, raised content surfaces.

### Layered surfaces

Apple's `systemGroupedBackground` model, three levels:

| Token | Role |
|---|---|
| `--color-background` | the window canvas, behind everything |
| `--color-surface` | grouped inset content: lists, panels, the toolbar |
| `--color-surface-secondary` | raised rows inside a surface, field wells |
| `--color-surface-tertiary` | hover and pressed states |

Nested cards are banned. If content needs a third level of containment, the structure
is wrong.

### Semantic state

macOS system palette, tuned per appearance. Green `systemGreen`, orange `systemOrange`,
red `systemRed`, and each has a `-soft` tint for chip backgrounds.

Every semantic color is paired with a text label and an icon. Color alone is never the
signal.

### Vibrancy

The toolbar and sidebar use `backdrop-filter: saturate(180%) blur(20px)` over a
semi-opaque surface. This is the one sanctioned use of blur: it is functional
(it communicates a floating layer over scrolling content), not decorative
glassmorphism, and it degrades to solid where unsupported.

## Typography

**One family**: the native system stack.

```
-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif
```

On macOS this resolves to SF Pro, which is what makes the console read as native. No
webfont is loaded, so there is no FOUT and no network cost.

Numerals in tables, counts, timers, and money use `font-variant-numeric: tabular-nums`.

### Scale

Apple's macOS text styles, fixed rem, ratio ~1.2. Not fluid, not clamped.

| Style | Size / line-height | Weight | Use |
|---|---|---|---|
| `largeTitle` | 26px / 32px | 700, `-0.02em` | window title in the toolbar |
| `title1` | 21px / 26px | 650, `-0.015em` | page heading |
| `title2` | 17px / 22px | 620, `-0.01em` | section heading |
| `headline` | 13px / 18px | 600 | list row title, table header |
| `body` | 13px / 18px | 400 | default UI text |
| `callout` | 12px / 16px | 400 | secondary row text |
| `footnote` | 11px / 15px | 400 | timestamps, hints |
| `caption` | 10px / 13px | 590, `0.06em` uppercase | group labels in the sidebar |

13px body is deliberate. It is macOS's control size, and it is what makes a dense
operator tool feel like a system app rather than a marketing site scaled down.

## Iconography

**HugeIcons stroke icons only.** `@hugeicons/react` + `@hugeicons/core-free-icons`.

Emoji, dingbats, and unicode geometric glyphs are banned outright as icons. They render
inconsistently across platforms, ignore font weight, do not reliably inherit
`currentColor`, and are announced by screen readers.

Rules:

- One family, one stroke weight per context: `1.5` at 16 to 20px, `1.8` at 24px+.
- Icons inherit `currentColor`. No hardcoded fills.
- Decorative icons carry `aria-hidden="true"`. Icon-only controls carry an accessible
  name.
- Sidebar icons render at 17px inside an 18px optical box so glyph widths align.
- Every icon reference goes through `web/src/components/global/icon.tsx`. Views never
  import from `@hugeicons/core-free-icons` directly, so the set cannot drift.

## Layout

### Window structure

Every dashboard route is one macOS window:

```
┌───────────────────────────────────────────────┐
│ ○ ○ ○  toolbar (translucent, sticky)          │
├───────────┬───────────────────────────────────┤
│ sidebar   │  content                          │
│ (source   │  grouped inset sections           │
│  list)    │                                   │
└───────────┴───────────────────────────────────┘
```

- **Sidebar**: 236px, translucent, `sidebar` material. Source-list rows are 28px tall
  with a 6px inset and a fully rounded selection pill in accent. Groups carry a
  `caption` uppercase label. Collapses below `lg`.
- **Toolbar**: 52px, sticky, translucent, hairline bottom border. Holds the window
  title on the leading edge and controls on the trailing edge, exactly as AppKit does.
- **Content**: 24px padding, max 1400px, grouped sections at 20px vertical rhythm.

### Traffic lights

Each route shows the three macOS window dots in the toolbar's leading corner. They are
decorative and `aria-hidden`, but they are what makes a browser tab read as an
application window. On hover the close dot dims, matching AppKit's inactive state.

### Corner radii

Apple's continuous-corner scale: 6px controls, 8px fields, 10px chips, 12px grouped
sections, 16px sheets. Never larger; a 24px radius on a panel is a web idiom.

### Spacing

4px base. Rhythm comes from varying the step (8 / 12 / 16 / 24 / 32), not from applying
16px everywhere.

## Components

### Controls

- **Push button**: 28px tall, 6px radius, 13px medium label. Primary is filled accent.
  Secondary is `surface-secondary` with a hairline. Destructive is red text on a red
  soft fill, never a filled red button unless it is the confirmed action in a sheet.
- **Segmented control**: pill track in `surface-secondary`, selected segment raised in
  `surface` with a subtle shadow. Used for appearance switching and any 2 to 4 way
  exclusive choice, replacing dropdowns where the options are few.
- **Text field**: 28px, 8px radius, `field` well background, 1px border, accent focus
  ring at 3px alpha.

### Grouped inset list

The workhorse. Replaces most of the current card grids.

A `surface` container at 12px radius, hairline border, rows separated by inset
separators that start after the icon column. This is `UITableView.insetGrouped` and
macOS System Settings, and it is the single most recognizably-Apple structure available.

### Sheets

Modals are macOS sheets: they animate down from the toolbar edge, 16px radius, and the
confirm button sits trailing. Used only where inline editing is genuinely impossible.

### States

Every control ships `default / hover / focus-visible / active / disabled / loading`.
Loading in content is a skeleton, not a centered spinner. Empty states teach the next
action and offer the button that performs it.

## Motion

- 150 to 220ms, `cubic-bezier(0.32, 0.72, 0, 1)`. That curve is Apple's standard
  ease-out; it decelerates hard and never overshoots.
- Motion conveys state only: selection, sheet presentation, disclosure, status change.
- No page-load choreography. No bounce, no elastic, no spring on layout.
- Everything collapses to near-zero under `prefers-reduced-motion: reduce`.

## Accessibility

- WCAG 2.1 AA floor. Body text is 15.8:1 light, 16.1:1 dark. Muted text is 5.9:1 light,
  7.2:1 dark.
- 2px accent focus ring with a 2px offset on every interactive element.
- Logical properties only (`ms-`, `pe-`, `border-e`, `text-start`) so Arabic mirrors.
- Icons never carry meaning alone.
- Full keyboard operation, skip link to `#main-content`.

## Banned in this project

- Emoji or unicode glyphs used as icons.
- Gradient text, `background-clip: text`.
- Colored side-stripe borders.
- Decorative glassmorphism outside the sidebar and toolbar materials.
- Nested cards.
- The hero-metric template: giant number, gradient accent, tiny label.
- Identical icon-heading-text card grids repeated down a page.
- Em dashes in UI copy.
