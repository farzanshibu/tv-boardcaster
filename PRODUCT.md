# Product

## Register

product

## Users

**Primary: the retail operations lead.** Runs 5 to 100 screens across branches of a
restaurant chain, pharmacy group, showroom or clinic. Not a designer, not an IT admin.
Sits at a laptop in a back office or on a shop floor, usually in daylight, often
interrupted. Their day is: check nothing is dark, swap today's promo, get back to
running the store.

**Secondary: the content editor.** Uploads artwork and builds loops, cannot publish.
Works in longer focused sessions.

**Secondary: the platform operator (superadmin).** Internal. Lives in the tenant
console, moves between orgs, needs density over comfort.

The job to be done: *"prove every screen is playing the right thing, and change what
they play without calling anyone."*

## Product Purpose

Brandcast TV turns any smart TV into a centrally managed marketing display. Pair a
screen with a four digit code, assign a playlist, push instantly, and watch the fleet's
health. It is multi tenant SaaS billed per screen.

Success is the operator glancing at the overview and closing the tab, because
everything is green. Failure is the operator opening a support ticket to ask whether a
screen is online.

## Brand Personality

Three words: **calm, precise, native.**

The tool should feel like a system utility that shipped with the operating system, not
like a startup dashboard. Voice is plain and declarative. It states what is true
("2 screens offline"), it does not perform enthusiasm ("Uh oh! Something went wrong 😬").
Confidence comes from restraint: neutral surfaces, one accent, real data, no ornament.

Reference lane: Apple's own utilities and pro apps. System Settings, Console, TestFlight,
App Store Connect. Also Linear and Raycast for keyboard-first density.

## Anti-references

- **The purple gradient SaaS dashboard.** Glowing hero metric, gradient border cards,
  radial mesh backgrounds, floating glass panels. This is the single loudest thing to
  avoid.
- **Emoji as iconography.** Emoji, dingbats, and CJK/geometric unicode glyphs
  (`▦ ▶ ◷ ⚙ ★ ⟿ ⧉ ⏻ ⠿ ✕ ✓ →`) standing in for icons. They render differently on
  every platform, ignore font weight, do not inherit color reliably, and are read aloud
  by screen readers. Every icon must be a real vector from one family.
- **Bootstrap-era admin.** Heavy 1px-everything tables, blue links, dense chrome with
  no hierarchy.
- **Nested cards.** A card inside a card inside a panel.
- **Decorative motion.** Page load choreography, bouncing, elastic easing.

## Design Principles

1. **Native before novel.** Match the platform's own vocabulary, spacing, and control
   shapes. A user fluent in macOS System Settings should need zero learning.
2. **Status is the product.** Screen health, publish state, and plan usage are the
   information the operator came for. They get the strongest position and the only
   saturated color on the page.
3. **One accent, spent carefully.** Blue marks the current selection and the primary
   action. Everything else is a tinted neutral. Semantic color (green, orange, red)
   only ever means state.
4. **Density with air.** Show real counts and real rows, but let the grid breathe.
   Grouped inset lists over borders on everything.
5. **Never guess about a screen.** Every surface that can be stale says when it last
   synced. Silence is not evidence that it is working.

## Accessibility & Inclusion

- **WCAG 2.1 AA is a hard floor**, and body text targets well above it. This is
  non-negotiable: PRD section 8 requires it.
- **Five locales**: English, Hindi, Tamil, Kannada, Arabic. Arabic means RTL is a
  first-class layout, so logical CSS properties (`ms-`, `pe-`, `border-e`) only,
  never `left`/`right`.
- **Icons are never the only signal.** Every status icon pairs with a text label.
  Color alone never carries meaning, for deuteranopia and for the bright-showroom
  monitors these screens are managed from.
- **`prefers-reduced-motion`** is respected globally.
- **`prefers-color-scheme`** is respected: the console follows the operating system
  by default, with a manual override.
- Full keyboard operation with a visible focus ring on every interactive element,
  and a skip link to main content.
