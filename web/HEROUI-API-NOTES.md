# HeroUI 3 API notes (verified against @heroui/react 3.2.4 by type-probing)

Not guesswork: each value below was confirmed by assigning an invalid literal and
reading the compiler's expected-type list.

- CSS import is `@import "@heroui/react/styles";` (NOT `.../styles.css` — that path
  is not exported under the `style` condition and fails the Tailwind v4 build).
- No `<Provider>` wrapper is required (unlike HeroUI v2 / NextUI).
- Compound components: `Card.Header`, `Card.Title`, `Card.Content`, `Card.Footer`.

| Component | Prop | Allowed values |
|---|---|---|
| Button | `variant` | primary, secondary, tertiary, outline, ghost, danger, danger-soft |
| Button | `size` | sm, md, lg |
| Chip | `variant` | primary, secondary, tertiary, soft |
| Chip | `color` | default, accent, success, warning, danger |

Button has **no `color` prop** — that is a v2 API and is a compile error in v3.
