---
name: Runway
description: A calm, forest-toned interface for personal cash-flow planning.
colors:
  primary: "#072821"
  primary-container: "#072821"
  on-primary: "#ffffff"
  secondary: "#396756"
  secondary-fixed: "#bbedd7"
  background: "#e8efe9"
  surface: "#e8fef5"
  surface-container: "#ddf3ea"
  surface-container-low: "#e3f9f0"
  surface-container-highest: "#d2e7df"
  on-surface: "#0c1f1a"
  on-surface-variant: "#414846"
  outline: "#717975"
  outline-variant: "#c1c8c4"
  error: "#ba1a1a"
  on-error: "#ffffff"
typography:
  headline-lg:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "36px"
    letterSpacing: "-0.025em"
  headline-md:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "30px"
    letterSpacing: "-0.015em"
  headline-sm:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.01em"
  body-md:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "0em"
  body-sm:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "0.01em"
  label-md:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.02em"
  label-sm:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.01em"
  currency-display:
    fontFamily: "var(--font-mono), JetBrains Mono, monospace"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: "40px"
    letterSpacing: "-0.03em"
  currency-md:
    fontFamily: "var(--font-mono), JetBrains Mono, monospace"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  currency-sm:
    fontFamily: "var(--font-mono), JetBrains Mono, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0em"
rounded:
  default: "1rem"
  lg: "1.25rem"
  xl: "1.75rem"
  2xl: "2rem"
  full: "9999px"
spacing:
  space-xs: "0.25rem"
  space-sm: "0.5rem"
  space-md: "0.875rem"
  gutter: "1rem"
  space-lg: "1.25rem"
  margin: "1.25rem"
  space-xl: "1.75rem"
components:
  forest-panel:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
  glass-panel:
    backgroundColor: "rgba(255, 255, 255, 0.7)"
    rounded: "{rounded.xl}"
  primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: "44px"
---

## Overview

**Creative North Star: “Clear cash, calm decisions.”** Runway is an operate-mode finance tool. Its visual language pairs a pale green canvas and translucent panels with deep forest surfaces, helping the owner scan upcoming obligations and cash figures without visual noise.

The interface uses Manrope for general text and a monospaced face for currency. Strong contrast distinguishes the dark summary panels from light editing and list surfaces. A restrained green palette carries the product identity; status colors remain semantic.

**Key Characteristics:**
- Forest green anchors primary navigation and high-priority summary surfaces.
- Pale, layered greens and translucent white surfaces keep dense finance information readable.
- Currency uses monospaced numerals for quick comparison.
- Rounded controls and panels soften the otherwise compact, task-focused layout.

## Colors

The palette is organized around forest green, mint-green secondary accents, and pale green neutrals. Use primary for the main action and dark summary surfaces; the same deep value also appears in the primary-container role. Use secondary and its fixed tint for navigation emphasis and supporting accents. Background and surface roles distinguish the app canvas, panels, and nested information. On-surface colors carry text; outline roles separate controls and cards. Error is reserved for validation and failure states.

**The Forest Anchor Rule.** Keep primary actions and high-priority summary surfaces in the deep forest role; use light surfaces for editable and scan-heavy content.

The Tailwind configuration includes a `darkMode: "class"` selector setting, but the inspected global stylesheet defines no separate dark palette or dark surface rules. Do not infer a supported dark theme from that setting alone.

## Typography

Manrope is the interface sans-serif, with system sans-serif fallbacks. The project defines compact body and label roles alongside three headline sizes. Desktop and narrow-screen overrides reduce several body and headline sizes further; preserve those responsive adjustments where the corresponding utility classes are used.

Currency roles use the configured monospace stack (`var(--font-mono)`, JetBrains Mono, monospace). Use these roles for amounts rather than relying on proportional numerals.

**The Numeric Alignment Rule.** Keep financial amounts in the monospace currency roles so adjacent values are easy to compare.

## Layout

The app uses a responsive single-column flow with full-width content areas and flexible lists. The bills screen separates search and filtering, a committed-total summary, and grouped bill rows. On desktop, global styles reduce selected typography and panel spacing; mobile navigation sits near the bottom and reserves safe-area clearance. Shared content gutters and spacing steps come from the Tailwind spacing extension.

Use compact rows for scanning, while preserving larger touch controls on narrow screens. Let content wrap where long names or amounts require it instead of clipping financial values.

## Elevation & Depth

Depth comes from two established panel treatments. Glass panels use a translucent white fill, a light border, backdrop blur, and a restrained shadow. Forest panels use a dark green gradient, subtle highlight, fine translucent border, and deeper shadow. The app canvas itself uses layered radial and linear gradients. Navigation also uses translucent surfaces and blur on mobile; desktop styling simplifies it.

**The Surface Contrast Rule.** Use tonal layering and restrained shadow to distinguish surfaces; reserve the strongest depth treatment for the forest summary panel.

## Shapes

The radius scale runs from softly rounded controls through generous card corners to full pills. Inputs and segmented controls use rounded corners; primary actions and navigation controls commonly use pill shapes. Shared glass and forest panels use generous corner radii, with a smaller radius applied to those panels at desktop widths.

## Components

- **Forest panel:** Dark, high-contrast summary surface for committed totals and key cash figures. Keep labels and figures legible against its light text color.
- **Glass panel:** Light translucent container for grouped information and editing surfaces. Use the existing border and blur treatment when placing content over the app canvas.
- **Primary action:** Deep green, white-labeled pill control. Existing controls use a minimum height around the project’s 44px mobile touch target.
- **Inputs:** Light translucent fill, subtle outline, rounded shape, and a visible green focus ring. Labels remain adjacent to their fields.
- **Navigation:** Pill-shaped controls in a translucent mobile bar; desktop navigation becomes a simpler horizontal set of links.
- **Currency values:** Use the monospaced currency hierarchy, with the display role reserved for the most prominent totals.

## Do's and Don'ts

**Do:**
- Use the existing semantic palette roles and typography utilities.
- Keep summary totals visually distinct from supporting bill rows.
- Preserve the monospaced treatment for currency figures.
- Keep keyboard focus visible and status/error text distinguishable.
- Respect mobile safe-area spacing and the desktop density adjustments.

**Don't:**
- Treat the Tailwind dark-mode selector as evidence that a dark palette exists.
- Introduce new accent colors where the existing semantic roles suffice.
- Use decorative shadows on every list row; depth belongs to established panel surfaces.
- Use proportional numerals for prominent financial comparisons.
