# Margin Frontend Plan

**Created:** September 22, 2026
**Status:** Planned. No frontend phase in this document has started.
**Companion log:** [`frontend_implementation_log.md`](frontend_implementation_log.md) —
written after each phase, and home of the API contract register.
**Parent plan:** [`MARGIN_BUILD_PLAN.html`](MARGIN_BUILD_PLAN.html), §05 (pages,
notes, panes), §06 (frontend and depth), §07 (features), §16 (demo build).

This plan turns Margin's working-but-inconsistent interface into one coherent,
crafted product with pseudo-3D depth — built entirely from CSS transforms,
layered shadows, and compositor-only animation. No WebGL, no Three.js, no
animation library in the application bundle.

---

## 1. Where the frontend is today

An audit of every component on September 22, 2026. "Raw" counts Tailwind
palette classes such as `bg-gray-100`, `text-blue-600`, or `dark:bg-gray-800`
that bypass the design tokens. "Token" counts classes that use them
(`bg-surface-2`, `text-muted`, `shadow-elev-3`).

| Surface | Lines | Raw | Token | State |
|---|---:|---:|---:|---|
| `SearchBar.tsx` | 538 | 90 | 0 | Untouched by the token system |
| `SaveModal.tsx` | 192 | 64 | 0 | Untouched; dark mode via 34 `dark:` overrides |
| `AIChatSidebar.tsx` | 318 | 59 | 0 | Untouched |
| `MathModal.tsx` | 147 | 58 | 0 | Untouched; 40 `dark:` overrides |
| `SaveOptionsModal.tsx` | 212 | 52 | 0 | Untouched; 30 `dark:` overrides |
| `FileSystem/FileTree.tsx` | 408 | 42 | 0 | Untouched |
| `FloatingFormatToolbar.tsx` | 226 | 40 | 0 | Untouched |
| `PermissionPrompt.tsx` | 48 | 18 | 0 | Untouched |
| `PaneHeader.tsx` | 54 | 17 | 0 | Untouched |
| `ui/Toast.tsx` | 91 | 17 | 0 | Primitive, but not migrated |
| `Header.tsx` | 258 | 10 | 20 | Partially migrated |
| `Sidebar.tsx`, `SideMenu.tsx` | 120 | 20 | 0 | Untouched |
| `AnnotationCanvas.tsx` | 3,162 | 8 | 0 | Reading zone; mostly canvas |
| `PDFViewer.tsx` | 1,211 | 7 | 0 | Reading zone |
| `LibraryGrid.tsx` | 116 | 0 | 19 | Migrated; basic tilt present |
| `NotesPanel.tsx` | 138 | 0 | 20 | Migrated |
| `PageOrganizer.tsx` | 179 | 0 | 15 | Migrated; real thumbnails (uncommitted) |
| `ui/*` primitives (10 files) | ~430 | 0 | ~65 | Migrated |

Also raw but small: `SaveButton.tsx` (6) and `DocumentPane.tsx` (2). Every
other component and page has zero raw palette classes.

**What this tells us**

1. **Two design systems coexist.** Surfaces built during the rebuild use
   tokens; older surfaces use raw grays and blues with hand-written `dark:`
   variants. Exactly 510 raw colour classes remain across 17 files. Dark mode therefore works
   by two different mechanisms, and the older surfaces will not follow any
   future token change.
2. **The depth system exists on paper only.** `tokens.css` defines four
   elevations and an edge highlight, but only the Library uses them with any
   intent, and its tilt is a single-shadow tilt with no reduced-motion guard
   and no lit edge.
3. **The fonts are not loaded.** `--font-sans` names Plus Jakarta Sans and
   `--font-mono` names JetBrains Mono, but nothing loads either. Every screen
   renders in the system fallback.
4. **Theme follows a store boolean, not the user's system.** `isDarkMode`
   defaults to `false` and `Dashboard.tsx` toggles `<html class="dark">` after
   mount, so a dark-mode user sees a light flash on every load.
5. **Light-mode surfaces 1–4 are all `#FFFFFF`.** This is intentional (light
   mode encodes elevation by shadow) but it means shadows are the *only* depth
   signal in light mode, which is exactly why they must be done well.

### Interaction with the Phase 8 repair sequence

The main implementation log lists four Phase 8 defects (8R.1–8R.4). Three of
them are frontend-heavy, so this plan is sequenced to **restyle the repaired
component, never the broken one**:

| Repair | What it changes | Frontend phase that depends on it |
|---|---|---|
| 8R.1 Textbox rewrite | New text-annotation editor and state machine | F3 styles the new editor |
| 8R.2 Notes with multiple anchors | New `Note` entity; highlights no longer auto-create notes | F6 builds the notes panel on the new model |
| 8R.3 Library references and folders | Folder UI, file-handle references | F4 builds the library on the new model |
| 8R.4 Merged-document search | Index lifecycle fix | F6 moves search into the side panel |

F1 and F2 touch none of those components and can start immediately.

---

## 2. The design thesis: zone the application

The UI/UX Pro Max skill returned two conflicting answers for this product:
**Flat / Minimalism** for a productivity document tool, and
**dimensional-layering** when queried for depth — the latter flagged
`accessibility risk: high`, requiring 4.5:1 text contrast, keyboard access,
visible focus, and reduced-motion support.

Both are right about different parts of the screen. Margin's content is
someone else's document, so wherever a page is visible the interface recedes;
wherever no page is visible there is nothing to compete with, and depth does
real work.

| Zone | Surfaces | Treatment | Elevation |
|---|---|---|---:|
| **Reading** | Page canvas, annotation layer, OCR text layer | Absolutely flat. One hairline edge and one seating shadow under the page. No tint, glass, tilt or animation. | 0 |
| **Chrome** | Title bar, pane tabs, tool dock, dividers, status bar, side panels | Restrained. Enough depth to say "this floats above the page". Two levels, no tilt, no parallax. The tool dock is the single permitted glass surface. | 1–2 |
| **Depth** | Library, page organiser, empty states, onboarding, settings, export | Full dimensional layering: stacked cards, pointer tilt, lift on hover, isometric artwork. | 1–4 |
| **Showcase** | Demo build's "what this is" panel | Maximal: up to three parallax layers and a canvas hero, in a separately loaded chunk. | 1–4 |

**One rule settles every later argument:** nothing in the Reading zone may
exceed elevation 0 except the page seating shadow.

---

## 3. The pseudo-3D toolkit

Every technique below is compositor-friendly. Ranked by payoff per byte.

### 3.1 Stacked shadows (the foundation)

A real object above a surface casts three shadows: a tight contact shadow, a
wider soft shadow, and a faint ambient spread. The current tokens use two.
F1 moves every level to three layers:

```css
--elev-1: 0 1px 1px rgb(9 14 20 / .06), 0 1px 3px rgb(9 14 20 / .05), 0 0 0 1px rgb(9 14 20 / .03);
--elev-2: 0 1px 2px rgb(9 14 20 / .07), 0 4px 10px rgb(9 14 20 / .06), 0 10px 24px -8px rgb(9 14 20 / .06);
--elev-3: 0 2px 4px rgb(9 14 20 / .07), 0 10px 20px rgb(9 14 20 / .08), 0 24px 48px -12px rgb(9 14 20 / .10);
--elev-4: 0 3px 6px rgb(9 14 20 / .08), 0 18px 36px rgb(9 14 20 / .12), 0 40px 80px -20px rgb(9 14 20 / .18);
```

The negative spread on the ambient layer keeps the large shadow under the
object rather than haloing it — the difference between "floating card" and
"card with a glow".

### 3.2 The lit top edge

`inset 0 1px 0 rgb(255 255 255 / .55)` on raised surfaces reads as light
catching a top edge. Combined with a 2–3% top-to-bottom gradient on the
surface fill, a flat rectangle becomes a physical control. Dark mode swaps the
highlight to `rgb(255 255 255 / .06)` and relies on the surface ladder.

### 3.3 Press and lift

- **Pressable** controls (tool buttons, cards): hover lifts `translateY(-1px)`
  and raises one elevation level; active presses `translateY(1px)`, drops to
  elevation 0, and swaps the edge highlight for an inset shadow — a key-cap.
- **Animating elevation cheaply:** never transition `box-shadow` on many
  elements; it repaints. Put the higher elevation on a `::after` layer and
  transition its `opacity`, which stays on the compositor.

### 3.4 Pointer-tracked tilt

`perspective(900px) rotateX() rotateY()` driven by CSS custom properties.

- Maximum **4°** (the Library currently uses 8°, which reads as a toy).
- Pointer handling is `requestAnimationFrame`-throttled and writes only two
  custom properties; nothing triggers layout.
- `will-change: transform` is set on `pointerenter` and removed on leave, not
  permanently — permanent layers on a 200-card grid cost memory.
- Disabled when `prefers-reduced-motion: reduce` or `pointer: coarse`.
- A specular sheen follows the pointer: a radial gradient in a `::before`
  layer positioned by the same variables, at 6–10% opacity.
- The tilt math is pure and lives in `src/core/ui/tilt.ts` with tests.

### 3.5 Stacked paper

A document card is three sheets: the card, and two offset sheets behind it at
decreasing elevation and slight rotation (`-1.5deg`, `+1deg`). On hover the
back sheets fan out a few pixels. It is the most legible "this is a document"
cue available, and it is three `div`s.

### 3.6 Isometric artwork in CSS

Empty states, onboarding and folder cards use a shared transform,
`rotateX(55deg) rotateZ(-45deg)`, applied to a handful of token-coloured
`div`s — a stack of pages, an open folder, a pen. It weighs nothing, scales
perfectly, and themes automatically. No illustration PNGs or SVG files to
maintain.

### 3.7 Real 3D flip — exactly one place

`rotateY(180deg)` with `backface-visibility: hidden` is reserved for the
flashcard review surface (F9), where a card literally has two sides. Nowhere
else.

### 3.8 Parallax and glass, rationed

- **Parallax:** showcase surface only, at most three layers, decorative layers
  only, never text or controls.
- **Backdrop blur:** the floating tool dock over the page. Dialog scrims use a
  plain dim, not blur, because blurring a full-screen PDF behind a dialog is
  expensive and adds nothing.

### 3.9 What we are not using

- **WebGL / Three.js.** Roughly 600 KB before a single model, a permanent GPU
  context, and competition with PDF.js for the GPU budget that renders pages.
- **Animation libraries** (GSAP, Framer Motion) in the app bundle. CSS
  transitions and the Web Animations API cover everything here. The showcase
  chunk may use one if it earns it; the app may not.
- **Box-shadow focus rings.** They composite into elevation shadows and vanish
  on raised surfaces. Focus is always `outline` with `outline-offset`.

---

## 4. Non-negotiables: accessibility and performance

The skill rates dimensional layering as high accessibility risk. These rules
are the price of using it, and each has a verification method.

| Rule | Verified by |
|---|---|
| Text contrast ≥ 4.5:1 and UI-component contrast ≥ 3:1 on **every** surface level, in both themes | Automated test that parses `tokens.css` and checks every foreground/surface pair (F1) |
| Elevation never carries meaning alone — selected, active, disabled and error states also change colour, border or text | Design-gallery review checklist |
| Focus rings use `outline`, never `box-shadow` | Lint-style grep in CI for `focus:shadow`/`ring-` on interactive primitives |
| `prefers-reduced-motion` disables tilt, parallax, FLIP and fan-out, and renders the final state immediately | Tested by forcing the media query in the gallery |
| Every drag has a non-drag alternative (WCAG 2.2 AA "Dragging Movements") | Page organiser: Move left/right and "Move to position"; panes: "Split right/down" menu; library: "Move to folder…" |
| Every interaction is keyboard-operable | Manual keyboard pass per phase |
| At most one or two animated elements per view (skill rule "Excessive Motion") | Review checklist |
| No layout thrash: tilt, lift and FLIP write `transform`/`opacity` only | Performance panel check on the library with 200 cards |
| The chrome must not cost the pen anything | Re-run the Phase 5 ink latency benchmark (`src/lib/metrics/ink-debug.ts`) after F2 and F3; the gate must still pass |
| Interaction to Next Paint under 200 ms on library, organiser and panels | Chrome DevTools performance recording |

**Dependency budget.** The only new runtime dependencies this plan allows:

- `@fontsource-variable/plus-jakarta-sans` and `@fontsource/jetbrains-mono` —
  self-hosted fonts. A Google Fonts link would break the offline promise.
- A Markdown renderer plus sanitiser for notes (`marked` + `dompurify`, or
  equivalent). Rendering user Markdown without sanitising is an XSS hole.

Anything else must be justified in the frontend log.

---

## 5. Phases

Each phase lists its goal, deliverables, files, backend needs, and acceptance
criteria. A phase is **accepted** only when automated checks pass *and* the
user has manually confirmed the UI checks — the same rule the main log uses.
Estimates assume the 20–25 focused hours per week in the parent plan.

---

### Phase F0 — Baseline and plan intake

**Goal:** Record the starting point so every later phase can show a
before-and-after.

**Deliverables**
- The audit in §1 of this plan (done while writing it).
- Baseline screenshots of every surface in light and dark mode, saved under
  `docs/frontend-screens/F0/`.
- The API contract register in the frontend log.

**Acceptance:** screenshots exist for the library, empty workspace, one open
document, two-pane workspace, page organiser, notes panel, search dropdown,
AI chat, settings, and save dialogs.

**Estimate:** 2–3 hours.

---

### Phase F1 — Foundation v2: tokens, depth system, fonts, theme

**Goal:** Every later phase draws from one finished toolkit. After F1, adding
depth to a component is a class name, not a design decision.

**Deliverables**

1. **Self-hosted fonts.** Install the two `@fontsource` packages, import them
   in `main.tsx`, and verify rendering with the network offline.
2. **Token upgrades in `src/styles/tokens.css`.**
   - Three-layer elevation scale (§3.1) for light mode; dark mode keeps the
     surface-lightness ladder and adds a 1 px top border at 6% white.
   - Depth tokens: `--tilt-max: 4deg`, `--perspective: 900px`,
     `--lift: -1px`, `--press: 1px`, `--glass-bg`, `--glass-blur: 12px`,
     `--sheen-opacity`.
   - Surface fill gradient token (`--surface-raised-fill`) for the lit look.
   - Annotation colour tokens (`--hl-yellow`, `--hl-pink`, `--hl-green`,
     `--hl-blue`, `--hl-orange`, `--ink-black`, `--ink-blue`, `--ink-red`)
     that are **theme-invariant**: a yellow highlight stays yellow because it
     is document content, not interface.
3. **Depth utility layer `src/styles/depth.css`.** `.depth-raised`,
   `.depth-float`, `.depth-overlay`, `.depth-pressable`, `.depth-tilt`,
   `.depth-stack` (stacked paper), `.depth-glass`, `.iso-scene`, each with its
   reduced-motion override inside the same file. Mirrored into
   `tailwind.config.js` where a utility is more natural.
4. **Pure helpers in the core, with tests.**
   - `src/core/ui/tilt.ts` — pointer position → clamped rotation and sheen
     position.
   - `src/core/ui/contrast.ts` — WCAG relative-luminance and contrast ratio.
5. **Hook `src/lib/ui/usePointerTilt.ts`.** rAF-throttled, fine-pointer only,
   reduced-motion aware, sets `will-change` only while hovered.
6. **Theme system.**
   - Three states: System, Light, Dark; persisted in `localStorage`.
   - A tiny inline script in `index.html` applies the class **before first
     paint**, removing the light flash for dark-mode users.
   - `Dashboard.tsx` stops owning the class toggle; a `ThemeProvider` does.
7. **Token contrast test `src/styles/tokens.test.ts`.** Parses both theme
   blocks of `tokens.css` and asserts the §4 contrast rules for every text
   token on every surface token.
8. **Design gallery.** A development-only route (`?gallery`) rendering every
   primitive, every elevation, the tilt card, stacked paper, isometric scene,
   both themes side by side, and a reduced-motion toggle. It is excluded from
   the production bundle and becomes the review surface for every phase.

**Backend:** none.

**Acceptance**
- Fonts render with the network disabled.
- No light flash on reload in dark mode.
- Contrast test passes for both themes.
- Gallery shows all depth utilities in both themes; reduced motion flattens
  every animated one.

**Estimate:** 1 week.

---

### Phase F2 — Chrome zone: title bar, tabs, tool dock, status bar

**Goal:** The frame around the document feels like a native application and
never competes with the page.

**Deliverables**

1. **Unified title bar** (`Header.tsx`, elevation 1). Wordmark returns to the
   library; global search trigger; service-status indicator; theme and
   settings. Consistent 40 px height, token spacing.
2. **Physical pane tabs** (`PaneHeader.tsx`). The active tab is raised and
   visually joins the pane surface below it (shared fill, lit top edge,
   no bottom border); inactive tabs sit sunken. Close buttons appear on hover
   and focus. Overflow scrolls with fade masks. Drag-to-split keeps working and
   gains a non-drag "Split right / Split down / Move to pane" menu.
3. **Floating tool dock** (`Toolbar.tsx`). The annotation tools move into a
   pill-shaped dock floating over the top of the page — the one glass surface
   in the app (`.depth-glass`). Tool buttons are key-caps (`.depth-pressable`).
   The active tool shows accent-soft fill, accent icon and an accessible label,
   not elevation alone. Tool options open as elevation-2 popovers anchored to
   the dock.
4. **Pane dividers.** A 1 px line whose grab handle lifts on hover and shows a
   focus outline for keyboard resizing.
5. **Status bar** (new, `StatusBar.tsx`, elevation 1): page *n* of *N*, zoom,
   save state, OCR state, and service health dots for OCR and RAG.
6. **Service health model** (`src/lib/services/health.ts`). Polls each
   service's existing `GET /health` with back-off; exposes
   `online | offline | checking`. The status dots and tooltips read from it.
7. **Migrate the chrome's raw classes:** `Header`, `PaneHeader`,
   `DocumentPane`, `Toolbar`, `SaveButton`, `Sidebar`, `SideMenu`,
   `FileSystem/FileTree`, `ui/Toast`, `PermissionPrompt`.

**Backend:** `GET /health` on OCR (`:8000`) and RAG (`:9101`) — both exist.

**Acceptance**
- Zero raw palette classes in the listed files.
- Ink latency benchmark still passes with the dock visible.
- Pane tabs, dock, and dividers fully keyboard-operable.
- Health dots change within one poll interval when a service is stopped.

**Estimate:** 1 week.

---

### Phase F3 — Reading zone: the page as paper

**Depends on:** 8R.1 (textbox rewrite) for deliverable 4.

**Goal:** The page looks like paper on a desk, and everything drawn on it
looks like the user's own markup rather than interface.

**Deliverables**

1. **Page presentation.** Neutral ground, one seating shadow
   (`--page-shadow`), a hairline edge, zoom-aware page gaps, and page-number
   captions that stay muted.
2. **Page loading.** A paper-coloured placeholder at the final page size
   (no layout shift) with a single subtle shimmer that stops under reduced
   motion.
3. **Night reading filter.** Optional per-document "Dim" and "Sepia" filters
   on the page canvas via CSS `filter`, so dark-mode users are not staring at a
   white page. Off by default; the PDF itself is never modified.
4. **Text annotation editor styling** — applied to the component produced by
   8R.1: raised resize knobs, dashed selection outline, a caret-coloured
   accent.
5. **Floating format toolbar** (`FloatingFormatToolbar.tsx`) becomes an
   elevation-3 popover built on the `Popover` primitive, with an
   "Ask about selection" action (see F6).
6. **Selection, search and focus highlights** use tokens; search hits pulse
   once on arrival, then hold.
7. **Annotation colour pickers** draw swatches from the theme-invariant
   annotation tokens added in F1.

**Backend:** none. (OCR state display uses the existing
`POST /ocr/recognize` flow already wired in `client-ocr.ts`.)

**Acceptance**
- No element inside the page area uses elevation above 0 except the page
  shadow.
- Dim and sepia filters do not affect exported PDFs.
- Ink latency benchmark still passes.

**Estimate:** 4–5 days.

---

### Phase F4 — Depth zone I: the library

**Depends on:** 8R.3 (library references and folders).

**Goal:** The library is the showcase of the depth system and the first thing
a new user sees.

**Deliverables**

1. **Continue reading shelf.** The three most recently opened documents as
   large stacked-paper cards with a reading-progress ribbon and last page.
2. **Document cards** (`.depth-stack` + `.depth-tilt`): cover thumbnail, 4°
   tilt with specular sheen, lift on hover, back sheets fanning out, badges for
   OCR'd / has notes / page count.
3. **Folders.** Isometric CSS folder cards showing document count. Dragging a
   card over a folder opens the folder "lid" (`rotateX`). Every drag has a
   "Move to folder…" menu equivalent.
4. **Views and filtering.** Grid / list toggle (segmented control), sort by
   recent, name and size, and a filter field using `useDeferredValue`.
5. **Import experience.** Dropping files anywhere on the library raises a
   lifted drop overlay; per-file import progress.
6. **Card context menu:** open, open in new pane, rename, move, remove from
   library, and re-grant file permission when a handle has lost access.
7. **Empty and first-run state.** An isometric scene (stack of pages and a
   pen), "Import PDFs", and "Open sample document".
8. **Virtualised grid** for large libraries: pure
   `src/core/ui/virtual-grid.ts` (visible rows and columns for a given
   viewport and card size) with tests; `VirtualizedGrid.tsx` primitive.

**Backend:** none. The library is IndexedDB and file handles.

**Acceptance**
- 200-card library scrolls without dropped frames; tilt causes no layout.
- Every drag interaction has a menu equivalent.
- Reduced motion shows static cards with elevation-on-focus only.

**Estimate:** 1 week.

---

### Phase F5 — Depth zone II: the page organiser

**Goal:** The single best demonstration of the depth system, and the most
useful new feature in the plan.

**Deliverables**

1. **Organiser as an elevation-4 workspace overlay** with its own header,
   selection count, and undo/redo.
2. **Pages as physical sheets** using the real thumbnails already rendered
   lazily. On grab a sheet lifts (`scale(1.03)`, elevation 4, slight rotation);
   its neighbours part to make room.
3. **FLIP reordering.** Neighbours animate from old to new positions with the
   Web Animations API. Pure FLIP math in `src/core/ui/flip.ts` with tests.
4. **Insert gaps.** Hovering between sheets opens a "+" gap for a blank page
   or "Insert from PDF…"; dropping a PDF file into a gap merges it there.
5. **Rotation animates** the sheet by 90° over 200 ms.
6. **Floating selection bar** (elevation 3) for multi-selection: rotate,
   delete, extract, split here.
7. **Non-drag alternatives:** Move left / Move right buttons, a "Move to
   position…" field, and keyboard reordering (arrows to focus, Alt+arrows to
   move).
8. **Virtualised thumbnails** via `virtual-grid.ts` so a 900-page book opens
   instantly.

**Backend:** none.

**Acceptance**
- Reordering a 900-page document stays responsive.
- Every organiser action is reachable without dragging and without a mouse.
- All actions still share the single undo/redo history.

**Estimate:** 1 week.

---

### Phase F6 — Side panels: notes, search, outline, assistant

**Depends on:** 8R.2 (notes model) and 8R.4 (merged-document search).

**Goal:** One coherent right-hand panel system instead of separate sidebars
and dropdowns.

**Deliverables**

1. **Panel dock.** One resizable right-side dock (elevation 1) with tabs:
   Notes, Search, Outline, Assistant. Remembers width and last tab per
   document.
2. **Notes** (on the 8R.2 model). Note cards at elevation 1 that lift on
   focus; each shows its highlight anchors as colour-swatched quote chips.
   Edit / Preview toggle with full Markdown rendering (headings, lists, bold,
   links) plus KaTeX, sanitised. Focusing a note scrolls to and pulses its
   highlight once; clicking a highlight focuses its note.
3. **Search.** Results move from the header dropdown into the panel, grouped
   by document, with snippets, match highlighting and keyboard navigation.
   The header keeps a compact trigger (`Ctrl+F`). A mode switch offers
   **Exact** (the local index) and **Semantic** (see backend below), shown
   only when the semantic service is online.
4. **Outline.** The PDF's own outline via PDF.js `getOutline()`; falls back to
   a page list. Client-side only.
5. **Assistant** (`AIChatSidebar.tsx` rebuilt):
   - Message layout with the answer, a confidence meter, and source chips
     that jump to `page` and `bbox`.
   - A **mode** selector exposing the existing API modes: Ask, Summarise,
     Compare, Explain, Extract.
   - A **scope** selector: this document, all open documents, selected pages,
     or current selection.
   - "Index this document for AI" with state from the ingest status endpoint.
   - Streaming token display and a Stop button (requires a new endpoint; see
     below). Until it exists, a typed "thinking" state with elapsed time.
   - Chat history stored locally per document in IndexedDB — no server.

**Backend**
- Exists and wired: `POST /query` (mode, scope, topK, sessionId are in the
  schema but the UI does not surface them yet), `POST /ingest`,
  `GET /status/{fingerprint}`.
- Exists but not deployed: `POST /search` in `ingest-pipeline/search_api.py`
  (no compose service, no fixed port).
- Missing: streaming answers, ingest progress. See the register.

**Acceptance**
- Creating 1,000 highlights does not create 1,000 note cards (8R.2 behaviour
  preserved through the redesign).
- Search after merging a PDF finds text from the merged pages (8R.4 preserved).
- Assistant source chips navigate to the correct page and region.

**Estimate:** 1.5 weeks.

---

### Phase F7 — Dialogs, settings, export, and system states

**Goal:** Every remaining surface uses the system, and the app has consistent
empty, loading, and error states.

**Deliverables**

1. **Migrate dialogs to the `Dialog` primitive** at elevation 3–4 with a dim
   scrim: `SaveModal`, `SaveOptionsModal`, `MathModal`, `SettingsModal`,
   `PermissionPrompt`.
2. **Export dialog** as selectable raised option cards: PDF with editable
   annotations, flattened PDF, Markdown notes, Margin JSON.
3. **Settings, sectioned:** Appearance (theme, reading filter default,
   density), Services (URLs, live health, "Test connection"), Storage
   (`navigator.storage.estimate()` usage and a "Keep data persistent" request
   via `navigator.storage.persist()`), Shortcuts, About.
4. **State components:** `EmptyState` (with isometric art slot), `ErrorState`,
   `Skeleton`, and consistent toasts at elevation 3.
5. **Keyboard layer:** a shortcut sheet on `?` and a command palette on
   `Ctrl+K`, driven by one action registry. Fuzzy matching is pure
   (`src/core/ui/fuzzy.ts`) with tests.
6. **First-run coach marks** for import, annotate, and organise; dismissible
   and remembered locally.

**Backend:** optional `GET /info` for model and device details in Settings
(missing; see register). Settings works without it.

**Acceptance**
- Zero raw palette classes remain anywhere in `src/components`.
- Every dialog traps focus and restores it on close.
- Command palette reaches every toolbar and menu action.

**Estimate:** 1 week.

---

### Phase F8 — Demo build and showcase surface (aligned with roadmap Week 9)

**Goal:** One link anyone can open to understand Margin in thirty seconds.

**Deliverables**

1. **`VITE_DEMO=1` build target.** OCR and RAG code paths compiled out behind
   feature flags; a bundled sample mathematical PDF; everything else is the
   real app.
2. **Showcase panel** on the demo's empty state: "What this is", three
   parallax layers at most, isometric artwork, and a lightweight canvas hero
   (a generative gradient field). Loaded as a separate chunk only in the demo
   build.
3. **Demo notice:** a slim banner explaining that data stays in this browser.
4. **CI job** that builds the demo target so it cannot rot.

**Backend:** none by design — the demo must run as static files.

**Acceptance:** the demo loads from static hosting with no services, and the
showcase chunk is absent from the normal build.

**Estimate:** 3–4 days.

---

### Phase F9 — Surfaces for roadmap Weeks 10–17

Each of these is built **alongside** its backend week, not before, because a
UI without data is a mock. Designs are fixed now so the backend can be built to
the contract.

| Sub-phase | Roadmap | Surface | Backend |
|---|---|---|---|
| F9.1 | W10–11 | **Version history scrubber**: a timeline rail with snapshots as points; scrubbing previews the page state; restore creates a new command. | Decision pending: in-browser object store (no endpoint, consistent with local-first) or a service (contract proposed in the register). |
| F9.2 | W10–11, §07 #2 | **Compare two PDFs**: two synchronised panes with added/removed/changed overlays and a change-density minimap. | Same decision as F9.1. |
| F9.3 | W13 | **OCR ladder visibility**: per-page chips on thumbnails (text layer / cached / fast / heavy) and a confidence heatmap overlay. | Page OCR exists; region-level heavy OCR is missing. |
| F9.4 | W14–16 | **Layout and reading order**: overlay of detected regions coloured by class, numbered reading-order arrows, and a read-aloud mini-player (Web Speech API) with word highlighting. | Layout analysis endpoint missing. |
| F9.5 | W17 | **Knowledge graph and prerequisite path**: concept graph (SVG, force layout computed client-side), concept preview, and a "path from what I know" panel. | OKF build/read endpoints missing. |
| F9.6 | Stretch, §07 #1 | **Flashcards**: review deck using the one real 3D flip in the app; FSRS scheduling client-side in the core. | None. |

---

## 6. Timeline

| Order | Phase | Estimate | Can start |
|---|---|---|---|
| 1 | F0 Baseline | 2–3 h | Now |
| 2 | F1 Foundation v2 | 1 week | Now |
| 3 | F2 Chrome zone | 1 week | After F1 |
| 4 | F3 Reading zone | 4–5 days | After F2 and 8R.1 |
| 5 | F4 Library | 1 week | After F1 and 8R.3 |
| 6 | F5 Page organiser | 1 week | After F4 (shares virtual grid) |
| 7 | F6 Side panels | 1.5 weeks | After F2, 8R.2 and 8R.4 |
| 8 | F7 Dialogs and states | 1 week | After F2 |
| 9 | F8 Demo build | 3–4 days | After F4–F7 |
| 10 | F9.x | With each backend week | Per roadmap |

F1 through F8 total roughly seven weeks of focused work. They can interleave
with the Phase 8 repairs because F1, F2 and F7 touch none of the repaired
components.

---

## 7. How each phase is verified

1. **Automated:** `npx tsc -b`, `npm test`, `npx eslint src/core --max-warnings 0`,
   and `npm run build` all green. Every new pure helper in `src/core/ui/` ships
   with tests.
2. **Raw-class count** for the phase's files is zero (re-run the §1 audit
   command, recorded in the log).
3. **Design gallery review** in light, dark, and reduced-motion modes.
4. **Performance:** ink benchmark (F2, F3), 200-card library scroll (F4),
   900-page organiser (F5).
5. **Manual acceptance by the user** on the listed UI steps. Until then the
   phase is recorded as implemented, not accepted.
6. **Screenshots** saved to `docs/frontend-screens/F<n>/` for before/after
   comparison with F0.
