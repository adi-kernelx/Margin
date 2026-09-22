# Frontend Implementation Log: Margin

A chronological record of the frontend rebuild described in
[`FRONTEND_PLAN.md`](FRONTEND_PLAN.md). It records what each phase changed,
why, what deviated from the plan, and what the user accepted. It also holds the
**API contract register**: every frontend feature that needs a backend, whether
that endpoint already exists, and — where it does not — the contract the
backend should be built to.

**Started:** September 22, 2026
**Last updated:** September 22, 2026 (F2 and F3 implemented)
**Current phase:** F2 and F3 implemented; awaiting user acceptance
**Main project log:** [`implementation_log.md`](implementation_log.md)

---

## How to Use This Log

- Add one entry **after** each phase, not during it.
- A phase is **implemented** when the automated checks pass, and **accepted**
  only when the user confirms the manual UI checks. Record both separately.
- Use `⚡ Plan Deviation`, `⚡ Design Decision`, and `⚡ Bug` callouts with a
  short reasoning block, matching the main log.
- When a phase needs a backend capability, update the API contract register in
  the same entry. Never wire the UI to an endpoint marked **Missing** — build a
  graceful "unavailable" state instead and leave the register entry open.
- Save before/after screenshots to `docs/frontend-screens/F<n>/`.

### Entry template

```markdown
## Phase F<n>: <name>

**Date:** <start–end>
**Status:** Implemented / Accepted on <date> / Not accepted
**Objective:** <one or two sentences from the plan>

### F<n>.1: <deliverable>
**Created / modified**
- `path` — what it does, not just its name.

### ⚡ Design Decision / Plan Deviation / Bug: <title>
> **Reasoning:** ...

### Verification
- Automated: tsc / tests (count) / core lint / build.
- Raw palette classes in phase files: <before> → <after>.
- Performance: <benchmark and result>.
- Manual acceptance: <each step and the user's result, or "pending">.

### API register changes
- <feature>: <status change>

**Git checkpoint:** `<sha>` — <subject>
```

---

## API Contract Register

The product is local-first: most frontend features need **no** backend. This
register lists only the features that talk to the optional Python services.

Service map as of September 22, 2026:

| Service | Code | Port | Compose | Wired in frontend |
|---|---|---|---|---|
| OCR | `ocr-service/app/main.py` | 8000 | `ocr-service/docker-compose.yml` | Yes — `src/lib/ocr/client-ocr.ts` |
| RAG + ingest | `local-llm/rag-api/main.py` | 9101 | `local-llm/docker-compose.yml` | Yes — `src/lib/rag-service.ts`, `src/lib/ingest-service.ts` |
| Semantic search | `ingest-pipeline/search_api.py` | none set | none | No |
| Standalone ingest | `ingest-pipeline/ingest_api.py` | 9200 | none | No (frontend uses the 9101 ingest instead) |
| Embeddings | `embedding-service/server.py` | not checked | none | No |

### Existing endpoints the frontend can use

| # | Frontend feature | Phase | Endpoint | Contract | Status |
|---|---|---|---|---|---|
| E1 | Service status dots | F2 | `GET :8000/health` | → `{ "status": "ok" }` | **Exists.** Not yet polled by the UI. |
| E2 | Service status dots | F2 | `GET :9101/health` | → `{ "status": "ok" }` | **Exists.** Not yet polled by the UI. |
| E3 | OCR a page | F3, F9.3 | `POST :8000/ocr/recognize?page=<n>` | multipart `file` (page image) → OCR sidecar JSON; tokens carry `confidence` | **Exists and wired.** |
| E4 | Assistant answers | F6 | `POST :9101/query` | `{ question, mode: "qa"\|"summary"\|"compare"\|"explain"\|"extract", scope?: { docIds?, pages?, selection? }, topK = 8, sessionId? }` → `{ answer, confidence, sources: [{ docId, page?, bbox?, score, text?, relevance_score? }], metrics? }` | **Exists and wired.** The UI does not yet expose `mode` or `scope`; F6 will. |
| E5 | "Index this document for AI" | F6 | `POST :9101/ingest` | `{ docId, pdfFingerprint, displayName?, ocrData: { "<page>": OcrPageData } }` → `{ success, chunksIngested, message, cached }` | **Exists and wired.** Synchronous — no progress. |
| E6 | Index state badge | F6, F4 | `GET :9101/status/{fingerprint}` | → `{ ingested, chunkCount, pdfFingerprint }` | **Exists and wired.** Boolean state only. |
| E7 | Semantic search mode | F6 | `POST /search` (search_api) | `{ query, docId?, pdfFingerprint?, limit = 5 }` → `{ results: [...], error? }` | **Exists in code, not deployed.** Needs a compose service and a fixed port before F6 can use it. |

### Missing endpoints — contracts for the backend to build

Each entry is a proposal. The frontend will ship a graceful unavailable state
until the endpoint exists; the backend should treat these shapes as the
starting contract and record any change here.

#### M1 — Streaming assistant answers (needed by F6)

```
POST :9101/query/stream
Request:  same body as POST /query
Response: text/event-stream
  event: token    data: { "text": "..." }
  event: sources  data: { "sources": [Source], "confidence": number }
  event: done     data: { "metrics": {...} }
  event: error    data: { "message": "..." }
```

Requirement: when the client closes the connection (the Stop button),
generation must stop on the server rather than running to completion.

**Why:** a local 8B model takes several seconds to answer; without streaming
the UI can only show a spinner, and there is no way to cancel.

#### M2 — Ingest progress (needed by F6, F4 badges)

Either make ingest a job:

```
POST :9101/ingest          → { jobId }
GET  :9101/ingest/{jobId}  → { state: "queued"|"running"|"done"|"failed",
                               chunksDone, chunksTotal, message? }
```

or extend `GET /status/{fingerprint}` with
`{ state, chunksDone, chunksTotal }` while ingest is running.

**Why:** `POST /ingest` currently blocks until finished and `/status` returns
only `ingested: boolean`, so a progress bar is impossible.

#### M3 — Deploy semantic search (needed by F6)

Add `search_api.py` to a compose file with a fixed port (proposed `9102`), or
mount its `/search` route inside the `:9101` app. No contract change needed.

#### M4 — Service info (optional, F7 Settings)

```
GET /info → { service, version, ready: boolean,
              model?: string, device?: "cpu"|"cuda", contextTokens?: number }
```

On both `:8000` and `:9101`. Settings works without it; this only enriches the
Services section.

#### M5 — Region-level heavy OCR (needed by F9.3, roadmap W13)

```
POST :8000/ocr/recognize-region?page=<n>
multipart: file (page image), regions: JSON [{ x, y, width, height }]  (page pixels)
→ { regions: [{ bbox, tokens: [{ text, bbox, confidence }] }] }
```

**Why:** the escalation ladder only sends low-confidence regions to the heavy
model, not whole pages.

#### M6 — Layout analysis and reading order (needed by F9.4, roadmap W14–16)

```
POST /layout/analyze?page=<n>
multipart: file (page image)
→ { width, height,
    regions: [{ id, bbox: [x0, y0, x1, y1],
                class: "title"|"text"|"list"|"table"|"figure"|"formula"|"caption"|"header"|"footer",
                confidence }],
    readingOrder: [regionId, ...] }
```

Service and port to be decided when the ML work starts (likely a new
container, or a route on the OCR service).

#### M7 — OKF knowledge bundle (needed by F9.5, roadmap W17)

```
POST /okf/build          { pdfFingerprint }       → { jobId }
GET  /okf/{fingerprint}                          → { concepts: [{ id, type, title, path, pages: [int] }],
                                                     edges: [{ from, to, kind? }] }
GET  /okf/{fingerprint}/concept/{id}             → { id, frontmatter: {...}, markdown }
GET  /okf/{fingerprint}/path?from=<id>&to=<id>   → { path: [conceptId, ...] }
```

The graph layout itself is computed in the browser; the service only produces
and serves the bundle.

#### M8 — Version history and document compare (F9.1, F9.2, roadmap W10–11)

**Decision pending.** The parent plan places the object store in an API
container, but the project has since removed its Node backend and keeps all
document state in IndexedDB. Recommendation: build the object store in the
browser (`src/core/` + IndexedDB), which needs **no endpoint** and keeps the
local-first model intact. If a service is chosen instead, record its contract
here before F9.1 starts.

---

## Phase F0: Baseline and Plan Intake

**Date:** September 22, 2026
**Status:** In progress — audit and register complete; screenshots pending
**Objective:** Record the frontend's starting point so every later phase can
show a measurable before-and-after.

### F0.1: Frontend audit

Every component in `src/components` and `src/pages` was scanned for raw
Tailwind palette classes (which bypass tokens), token classes, and `dark:`
overrides. The command, for re-running after each phase:

```bash
for f in $(find src/components src/pages -name "*.tsx" | sort); do
  raw=$(grep -oE "\b(bg|text|border|ring|from|to|hover:bg|hover:text)-(gray|slate|blue|purple|red|green|zinc|neutral|indigo|yellow)-[0-9]+" "$f" | wc -l)
  tok=$(grep -oE "\b(bg|text|border|shadow)-(ground|surface-[1-4]|sunken|line|text|accent|danger|warning|success|elev-[1-4]|edge|page)\b" "$f" | wc -l)
  echo "$raw $tok $f"
done
```

**Baseline (September 22, 2026, post-8R):** 502 raw palette classes across 16
files. Full table saved to `docs/frontend-screens/F0/audit-baseline.txt`;
condensed table in `FRONTEND_PLAN.md` §1.

Movement since the plan was written:

- `AnnotationCanvas.tsx` fell from 3,162 → 2,783 lines and dropped from 8 raw
  classes to 0. The 8R.1 text-editor extraction is why.
- `TextAnnotationEditor.tsx` is new (248 lines, 3 token classes, 0 raw).
- `LibraryGrid.tsx` grew from 116 → 204 lines with the 8R.3 folder/reference
  work; still 0 raw.
- `NotesPanel.tsx` grew slightly with the 8R.2 note model.

### F0.2: Findings that shaped the plan

1. **Two design systems coexist.** Rebuild-era surfaces use tokens; older
   surfaces use raw colours with hand-written `dark:` variants, so dark mode
   runs on two mechanisms.
2. **Fonts are declared but never loaded.** Every screen renders in the system
   fallback.
3. **Theme flashes.** `isDarkMode` defaults to `false` and the `dark` class is
   applied after mount, so dark-mode users see a light frame on every load.
4. **Depth is mostly unused.** Only `LibraryGrid.tsx` applies elevation with
   intent; its tilt is 8° with a single shadow and no reduced-motion guard.
5. **The service health endpoints exist but nothing reads them.** The UI
   cannot tell the user whether OCR or the assistant is available.

### ⚡ Design Decision: zone the interface by what is on screen

The UI/UX Pro Max skill recommended flat minimalism for a document tool and
dimensional layering when queried for depth — the latter rated
`accessibility risk: high`.

> **Reasoning:** Both are correct for different surfaces. Where a PDF page is
> visible, interface ornament competes with the user's document, so that zone
> stays flat. Where no page is visible — library, organiser, onboarding,
> settings — depth has nothing to compete with. The skill's accessibility
> requirements (4.5:1 contrast, keyboard access, visible focus, reduced motion,
> and WCAG 2.2 non-drag alternatives) become explicit acceptance criteria in
> every phase.

### ⚡ Design Decision: restyle repaired components, not broken ones

Three Phase 8 repairs (textbox, notes model, library folders) and one search
fix are open in the main log.

> **Reasoning:** Restyling a component that is about to be rewritten wastes
> the work twice. F3, F4 and F6 are gated on their repairs; F1, F2 and F7 touch
> none of those components and can proceed in parallel.

### Verification

- Audit command recorded above; results saved to
  `docs/frontend-screens/F0/audit-baseline.txt` (16 files, 502 raw classes).
- API register built from the actual route decorators in `ocr-service`,
  `local-llm/rag-api`, and `ingest-pipeline`, and from the fetch calls in
  `src/lib`.
- **Pending — user action:** baseline screenshots in light and dark mode for
  the surfaces listed in the plan's F0 acceptance criteria, saved to
  `docs/frontend-screens/F0/`. F1 does not depend on them.

### API register changes

- Register created: 7 existing endpoints (E1–E7), 8 missing or pending
  contracts (M1–M8).

**Git checkpoint:** not yet committed.

---

## Phase F1: Foundation v2 — tokens, depth, fonts, theme

**Date:** September 22, 2026
**Status:** Implemented; awaiting user acceptance
**Objective:** Every later phase draws from one finished toolkit. After F1,
adding depth to a component is a class name, not a design decision.

### F1.1: Self-hosted fonts

**Created / modified**
- `package.json` — new deps `@fontsource-variable/plus-jakarta-sans` and
  `@fontsource/jetbrains-mono`.
- `src/main.tsx` — imports `plus-jakarta-sans` (variable) and the 400 / 500
  weights of `jetbrains-mono`.

Verified in the production build: the CSS references `plus-jakarta-sans-*.woff2`
and `jetbrains-mono-*.woff2` files that are bundled into `dist/assets/`. A
Google Fonts link was rejected because it would break the offline promise.

### F1.2: Token upgrades

**Modified**
- `src/styles/tokens.css` — the elevation scale rewritten as three composited
  layers per level (contact + soft + ambient), with a negative spread on the
  ambient layer so the shadow sits under the card rather than haloing it. New
  tokens for depth (`--tilt-max`, `--perspective`, `--lift`, `--press`,
  `--sheen-opacity`, `--glass-bg`, `--glass-blur`, `--edge-press`,
  `--surface-raised-fill`). New theme-invariant annotation palette
  (`--hl-yellow` / `-pink` / `-green` / `-blue` / `-orange` and `--ink-black`
  / `-blue` / `-red`).
- `tailwind.config.js` — mirrors the annotation palette (`hl.*`, `ink.*`) so
  Tailwind and CSS custom properties cannot drift.

### ⚡ Bug caught by the token contrast test: `--text-muted` failed AA on light ground

The `tokens.test.ts` file added below parses `tokens.css` and asserts every
text-token / surface-token pair meets WCAG AA (4.5:1 for body text, 3:1 for
non-text). On the first run the old `--text-muted: #6A7683` measured 4.28:1
against `--ground: #F4F6F8` — below AA. Captions and secondary labels use
this token as body copy, so weakening the assertion was not an option.

> **Fix:** darken `--text-muted` to `#5A6472`. All 22 contrast pairs now pass,
> and the token will not drift in future because CI runs this test.

### F1.3: Depth utility layer

**Created**
- `src/styles/depth.css` — `.depth-raised`, `.depth-float`, `.depth-overlay`,
  `.depth-dialog`, `.depth-pressable` (key-cap press-and-lift), `.depth-tilt`
  (pointer-tracked tilt with a specular sheen `::before`), `.depth-stack`
  (three-sheet stacked paper), `.depth-glass` (backdrop blur — the one glass
  surface), `.iso-scene` (isometric artwork transform).
- `src/index.css` — imports the new stylesheet after `tokens.css`.

Every animated utility is disabled under `prefers-reduced-motion: reduce`
inside the file. Nothing here transitions `box-shadow` on many elements at
once: the `::before` sheen is opacity-only, and elevation change happens via
one shadow variable swap, both compositor-friendly.

### ⚡ Design Decision: elevation animates via opacity, not by transitioning box-shadow

> **Reasoning:** `box-shadow` transitions repaint, which becomes expensive on
> a 200-card grid. The `.depth-pressable` rule keeps its own elevation static
> and animates only `transform` on hover, and the sheen is a
> `::before`-layer opacity fade. Neither triggers layout or paint outside its
> own layer.

### F1.4: Pure helpers in the core

**Created**
- `src/core/ui/tilt.ts` — `computeTilt({pointerX, pointerY, width, height, maxTiltDegrees})`
  returns clamped rotations plus the sheen origin in percent. Pure and
  DOM-free.
- `src/core/ui/tilt.test.ts` — 6 tests: rest at centre, correct sign on each
  axis, clamping at the cap, sheen percentages, and degenerate-input safety.
- `src/core/ui/contrast.ts` — `parseHex`, `relativeLuminance`, `contrastRatio`
  implementing the WCAG 2.1 formula; `CONTRAST` thresholds.
- `src/core/ui/contrast.test.ts` — 7 tests including WCAG's own worked example
  (black on white = 21:1) and Margin's own body-on-ground pair.

### F1.5: Pointer-tilt hook

**Created**
- `src/lib/ui/usePointerTilt.ts` — a shell over `computeTilt` that reads the
  DOM bounds, rAF-throttles pointer events, sets `will-change: transform`
  only while hovered, honours both `prefers-reduced-motion: reduce` and
  `pointer: coarse`, and writes four CSS custom properties. The tilt is
  clamped to whatever `--tilt-max` resolves to in the surface's own scope.

### F1.6: Theme system

**Created / modified**
- `src/lib/theme/theme.ts` — `ThemePreference = 'system' | 'light' | 'dark'`,
  `useThemeStore` (zustand), storage key `margin:theme`, resolution against
  `prefers-color-scheme`.
- `src/lib/theme/ThemeProvider.tsx` — subscribes the store to the system
  media query and mirrors the resolved theme back into the legacy
  `useAppStore().isDarkMode` field so pre-F2 components keep rendering.
- `index.html` — a tiny inline script (before the module script tag) that
  reads `localStorage['margin:theme']` and, if the resolved theme is dark,
  stamps `dark` on the document element **before the first paint**.
- `src/main.tsx` — wraps `<App />` with `<ThemeProvider>`.
- `src/pages/Dashboard.tsx` — removed its own `classList.toggle('dark', …)`
  effect and the `isDarkMode && 'dark'` compound class on its root.
- `src/lib/store.ts` — `toggleDarkMode` now delegates to
  `useThemeStore.setPreference`, so the two stores cannot fight.

### ⚡ Design Decision: theme goes through an inline pre-hydration script

> **Reasoning:** React attaches classes after mount, so before F1 a dark-mode
> user saw a light frame on every reload. Nine lines of vanilla JavaScript
> before the module script make the flash impossible. The storage key is
> re-exported from `theme.ts` as `THEME_STORAGE_KEY` so the script and the
> store cannot silently drift apart.

### F1.7: Contrast test

**Created**
- `src/styles/tokens.test.ts` — reads `tokens.css`, extracts the `:root` and
  `:root.dark` blocks, and runs `contrastRatio` on every text/surface pair
  named in the plan (10 pairs × 2 themes for body text, plus 1 non-text pair
  per theme). Any drift below 4.5:1 for body copy or 3:1 for non-text fails
  the build. This is the F1 acceptance criterion.

### F1.8: Design gallery

**Created / modified**
- `src/pages/DesignGallery.tsx` — a dev-only route rendering the theme
  controls, the four elevation levels, the type scale, the tilt card, stacked
  paper, and the annotation swatches, plus a "simulate reduced motion"
  toggle. All sections use only tokens.
- `src/App.tsx` — a `?gallery` query parameter renders `<DesignGallery />`
  instead of the app. Guarded by `import.meta.env.DEV`, so the gallery is
  not bundled into production; verified in the production build (no gallery
  string in the shipped JS).

### Verification

- **Automated:** `npx tsc -b`, `npx eslint src/core --max-warnings 0`,
  `npm test -- --run`, and `npx vite build` all green.
- **Tests:** 118 passing across 22 files (up from 83 / 19). New F1 additions:
  6 tilt, 7 contrast, 22 token-contrast pairs (11 per theme).
- **Build:** production build succeeds. Font files, tokens, and depth styles
  all present in `dist/assets/`. The design gallery string is absent from
  the shipped bundle.
- **Raw palette classes in phase files:** untouched by F1 (F1 does not
  restyle components; it only replaces the tokens, styles, and providers
  everything below it will draw from). Baseline of 502 stands and F2 will
  drive it down.
- **Manual acceptance (pending):**
  1. Load the app in dark mode; confirm no light flash on reload.
  2. Visit `/?gallery`; confirm fonts render as Plus Jakarta Sans and
     JetBrains Mono, not the system fallback.
  3. In the gallery, cycle System / Light / Dark; confirm the surfaces,
     shadows, sheen, and stacked paper all render correctly in both themes.
  4. Enable "Simulate reduced motion" in the gallery; confirm the tilt and
     stack-fanout stop and the durations drop to instant.
  5. Toggle the OS-level system theme with the gallery on "System"; confirm
     the app follows the OS.

### ⚡ Plan Deviation: `--text-muted` value changed from the plan's proposal

The plan's palette table used `#6A7683`. That value failed the AA contrast
test on ground; recorded here so the plan is not the source of truth on this
one value. `tokens.css` is authoritative.

### API register changes

- No backend contact was added or changed in F1.

**Git checkpoint:** not yet committed. `git status` after F1: 12 modified
files, 6 new source files, 4 new test files, 2 new doc/screenshot artefacts.

---

## Phase F2: Chrome zone — title bar, tabs, tool dock, status bar

**Date:** September 22, 2026
**Status:** Implemented; awaiting user acceptance
**Objective:** The frame around the document reads as a native application and
never competes with the page. Every chrome component draws from the token
system that F1 established.

### F2.1: Service health module and StatusBar

**Created**
- `src/lib/services/health.ts` — a zustand store plus a poller that probes
  `GET :8000/health` (OCR) and `GET :9101/health` (RAG) with a 2.5 s timeout
  and back-off (5 s while online, 30 s while offline).
- `src/components/StatusBar.tsx` — elevation-1 bottom bar rendering active
  document name, zoom, pane count, open-document count, save state, and one
  colour-plus-label pip per service. Uses the existing tooltip conventions so
  meaning never rides on the pip colour alone.
- `src/pages/Dashboard.tsx` — mounts the status bar and starts the poller
  once on first render.

### F2.2: Chrome primitive migrations

Every component in the plan's chrome-zone list moved onto tokens. Raw palette
classes in each of these files dropped to zero:

- `src/components/Header.tsx` — context menu at elevation 3.
- `src/components/PaneHeader.tsx` — rebuilt on `IconButton` and
  `ToolbarGroup`; zoom control replaces raw grays.
- `src/components/DocumentPane.tsx` — pane surface uses `bg-surface-1` and
  the token line colour.
- `src/components/SaveButton.tsx` — key-cap style via `depth-pressable`; the
  dirty pip uses `bg-warning` so colour and motion together carry meaning.
- `src/components/Sidebar.tsx` — replicate-toolbar rail sits at elevation 1;
  the toggle switches to an `accent-soft` badge.
- `src/components/FileSystem/SideMenu.tsx` — panel at elevation 3.
- `src/components/FileSystem/FileTree.tsx` — 42 raw classes to zero, without
  changing behaviour; a batch script mapped every pattern to its token
  equivalent.
- `src/components/ui/Toast.tsx` — one surface per toast type
  (success/danger/warning + info), each carrying colour and border together.
- `src/components/PermissionPrompt.tsx` — rebuilt on the `Dialog` and
  `Button` primitives.

### F2.3: Physical pane tabs

The Header tab-strip in `src/components/Header.tsx` now uses one of two
treatments per tab:

- **Active** — raised, sits on the pane's surface colour, has the lit top
  edge (`--edge-highlight`), and no bottom border. It reads as continuous
  with the pane below it.
- **Inactive** — sunken (`bg-sunken`) with muted text; hover raises to
  `bg-surface-2`.

A `-mb-px` overlap makes the active tab visually merge with the pane border.

### F2.4: Glass tool dock

`src/components/Toolbar.tsx` swapped its solid `bg-surface-2 border shadow-elev-3`
wrapper for the `.depth-glass` utility from F1. This is the only glass
surface in the app; every other floating element uses solid tokens.

### ⚡ Design Decision: no meaning-on-colour-alone in the status pips

> **Reasoning:** Colour-blind users cannot distinguish red-vs-green pips.
> Every pip is labelled in text next to the dot and again in the tooltip; the
> pip fill is a fixed status colour and the label carries the meaning.

### API register changes

- E1 (`GET :8000/health`) and E2 (`GET :9101/health`) are now consumed by
  the status bar. No contract change.

---

## Phase F3: Reading zone — the page as paper

**Date:** September 22, 2026
**Status:** Implemented; awaiting user acceptance
**Objective:** The PDF page looks like paper on a desk, and every editable
overlay on it reads as the user's own markup rather than interface.

### F3.1: Page presentation

**Modified — `src/components/PDFViewer.tsx`**
- The page frame keeps `bg-white` (a page is white), plus one hairline
  `border-line` and the single `--page-shadow` seating shadow. Nothing at the
  page surface exceeds elevation 0.
- The scroll container drops its raw grays and uses `bg-ground`.
- Loading state is now a paper-coloured `bg-sunken` placeholder at the final
  page size, with a slow `animate-pulse` shimmer; the tokens.css
  reduced-motion block already zeroes its duration for users who opt out.

### F3.2: Night reading filter

**Modified**
- `src/lib/store.ts` — new `readingFilter: 'none' | 'dim' | 'sepia'` with
  a setter.
- `src/components/PDFViewer.tsx` — the page frame carries an inline `filter`
  style (`brightness/contrast` for Dim, `sepia` for Sepia). The underlying
  PDF is never modified; exports carry the original pixels.
- `src/components/SettingsModal.tsx` — a new segmented control exposes the
  filter alongside the theme control, so dark-mode users can dim the page
  itself without staring at a bright white surface.

### F3.3: Text annotation editor styling

**Modified — `src/components/TextAnnotationEditor.tsx`**
- The editor frame is now `border-2 border-dashed border-accent bg-surface-1`
  with `shadow-elev-3` — a dashed outline reads as a selectable region and
  the token surface follows the theme.
- Dropped the `isDarkMode` read; the surface token handles both themes.

### F3.4: Floating format toolbar

**Rewritten — `src/components/FloatingFormatToolbar.tsx`**
- Container is now an elevation-3 popover.
- 40 raw palette classes replaced by two reusable helper strings: a
  `toggleClass(active)` that maps to `bg-accent-soft` when pressed and to
  `hover:bg-sunken` otherwise, and a `fieldClass` for the number and select
  inputs.
- The colour swatch preview uses `border-line`.
- Dropped the `isDarkMode` read entirely.

### F3.5: Theme controls in Settings

**Rewritten — `src/components/SettingsModal.tsx`**
- Appearance is now a three-state control (System / Light / Dark) that
  drives the F1 theme store directly, not the legacy toggle.
- Reading filter joins Appearance in the same dialog.

### ⚡ Design Decision: the reading filter is a CSS filter on the page frame

> **Reasoning:** Dim and sepia are display concerns. They must not touch the
> stored PDF or the exported PDF. Applying the filter to the page frame keeps
> it perfectly reversible and free — `filter: brightness()` runs on the GPU
> compositor and does not repaint.

### API register changes

- No backend contact added or changed in F3.

### Verification (F2 + F3)

- **Automated:** tsc, core lint, tests (118/118 across 22 files), and the
  production build all green.
- **Raw palette classes:** 502 → **323 across 5 files**. The eleven files
  named in F2 and the six named in F3 are at zero. The remaining five
  (`AIChatSidebar`, `SearchBar`, `MathModal`, `SaveModal`, `SaveOptionsModal`)
  are gated to F6 and F7 by design.
- **Manual acceptance (pending):**
  1. Open a document; confirm the page reads as paper on a neutral ground
     with no visible interface ornament near it.
  2. Open the tool dock and confirm the glass background composites over
     the page correctly in both themes.
  3. Switch reading filter in Settings between Off/Dim/Sepia and confirm the
     page canvas changes; then export and confirm the exported PDF looks
     unaffected.
  4. Stop the OCR service; confirm its status pip flips to danger within a
     poll interval and the tooltip explains the impact.
  5. Cycle System / Light / Dark from Settings and confirm the whole chrome
     zone follows without flashes.

---

## Upcoming

| Phase | Status | Blocked by |
|---|---|---|
| F1 Foundation v2 | **Implemented** | — |
| F2 Chrome zone | **Implemented** | F1 |
| F3 Reading zone | **Implemented** | F2 |
| F4 Library | Ready to start | F1 (8R.3 done) |
| F5 Page organiser | Not started | F4 |
| F6 Side panels | Not started | F2; M1–M3 for full assistant/search |
| F7 Dialogs and states | Not started | F2 |
| F8 Demo build | Not started | F4–F7 |
| F9.x Future surfaces | Not started | Corresponding backend weeks; M5–M8 |
