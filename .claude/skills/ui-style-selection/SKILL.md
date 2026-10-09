---
name: ui-style-selection
description: Choose the visual design style for a new UI project (spatial UI, glassmorphism, neumorphism, claymorphism or maximalism) before building it. Use at the start of every new frontend, dashboard, app or website project, and whenever the user asks which design style to use or asks for a redesign.
---

# UI style selection

At the start of every new UI project, pick ONE primary style from the five below (optionally plus one accent style), state the choice and the one-line reason to the user, then build with it. Do not ask the user to choose unless the project type is genuinely unclear; recommend, and let them override.

## The five styles

| Style | What it is | Strengths | Weaknesses |
|---|---|---|---|
| **Spatial UI** | The content's real space (map, floor plan, 3D model, canvas) is the workspace; panels float over it with depth hierarchy; selecting an object moves the camera to it and anchors its details beside it. | Shows *where* things are; keeps context; great for anything physical or geographic. | Needs real spatial data; heavier to build (3D/map stack); poor fit for list/form-heavy apps. |
| **Glassmorphism** | Translucent frosted panels (backdrop blur) over a meaningful background. | Keeps the background visible under overlays; modern, light. | Text readability drops over busy backgrounds; costly blur on low-end devices. Best as an **accent**, not a base. |
| **Neumorphism** | Soft extruded/pressed shapes, same colour as background, low contrast. | Calm, tactile, minimal. | Poor contrast and accessibility (fails WCAG easily); pressed vs unpressed states are ambiguous. Only for tiny, low-stakes surfaces (a single control panel, a music player). |
| **Claymorphism** | Chunky, rounded, inflated 3D-looking shapes with soft inner shadows and pastel colours. | Friendly, playful, memorable. | Wastes space; reads as a toy in professional contexts. |
| **Maximalism** | Bold colour, dense layering, mixed type, decoration as a feature. | Strong personality and brand expression; stands out. | Competes with status and error signals; tiring for long sessions; hard to scan. |

## Decision procedure

1. **Is the work about stakes and speed?** For example operations, control rooms, monitoring, trading, medical, admin consoles, or anything with alarms, approvals or long sessions.
   - Use a calm, muted base where colour is reserved for state (ISA-101 "high-performance HMI" principle).
   - Never use neumorphism, claymorphism or maximalism here.
   - If the domain is physical or geographic (grid, fleet, logistics, buildings, field assets, maps), choose **Spatial UI + Glassmorphism accent**.
   - Otherwise choose a **clean flat base + Glassmorphism accent** only for overlays (drawers, popovers, floating panels).
2. **Is it a data-heavy productivity tool** (CRM, analytics, internal tools, SaaS dashboards)?
   - Use a **clean flat base**. Add Glassmorphism only for overlays.
   - Add Spatial UI only if there is real spatial data.
3. **Is it consumer, onboarding, education, kids or a habit/wellness app?**
   - Choose **Claymorphism** (with accessible contrast on text).
   - Use Glassmorphism for hero or overlay moments.
4. **Is it brand, marketing, portfolio, editorial, fashion, music or an event site** (expression over efficiency)?
   - Choose **Maximalism**, kept to marketing surfaces.
   - Any functional flow inside it (checkout, forms) stays clean.
5. **Is it a small device-like surface** (a single widget, smart-home or media control, settings panel)?
   - **Neumorphism** is acceptable.
   - Verify contrast ≥ 4.5:1 for text and add a non-shadow cue (colour or icon) for on/off states.
6. **Immersive or 3D product** (configurator, digital twin, AR/VR, games, visualisation)? Choose **Spatial UI**.

When two rules match, the higher-stakes rule wins (rule 1 beats everything).

## Non-negotiables in every style

- Text contrast meets WCAG AA (4.5:1 body, 3:1 large text and UI components); test glass panels over the busiest background they can appear on.
- State never relies on shadow or translucency alone; pair it with colour, icon or label.
- Colours for error, warning and success are reserved for meaning, not decoration.
- Respect `prefers-reduced-motion`; and for glass, fall back to an opaque surface when `backdrop-filter` is unsupported or performance is poor.
- Keep one spacing scale, one radius scale and at most two typefaces (maximalism may use three on marketing surfaces).

## Implementation notes (Tailwind / shadcn)

- **Glass panel:** `bg-white/85 backdrop-blur-md border border-white/60 shadow-lg shadow-slate-900/5`. Use a dark variant `bg-slate-900/70` on dark maps. Keep opacity at 80% or more when text sits on it.
- **Spatial:** make the map or canvas the page background (`fixed inset-0`). Panels go in an overlay layer with `pointer-events-none` on the layer and `pointer-events-auto` on each panel. Use camera fly-to on selection and anchor detail cards to the selected object.
- **Neumorphism:** use two shadows (light top-left, dark bottom-right) on a background-coloured surface. Use an inset version for the pressed state.
- **Claymorphism:** use large radius (`rounded-3xl`), pastel fill, an outer soft shadow plus an inner highlight (`shadow-[inset_0_-6px_12px_rgba(0,0,0,.08),0_12px_24px_rgba(0,0,0,.08)]`).
- **Maximalism:** use a bold palette of 4–6 hues, oversized display type, layered imagery and texture. Keep the grid underneath so it still scans.

## Output to the user

Start the project with one short line, for example:
"Style: Spatial UI + glass accents — it's a geographic operations tool where operators need to see where problems are and colour must be reserved for alarms."
