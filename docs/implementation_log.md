# Implementation Log: Margin

Margin is a local-first workspace for reading, organising, searching, and
annotating mathematical PDFs. This document is both a build history and a
technical hand-off: a reader should be able to understand the current system,
why it has this shape, what each roadmap phase delivered, and what remains
unreliable without reading the Git history first.

**Rebuild started:** September 2, 2026  
**Last updated:** October 6, 2026  
**Roadmap position:** Weeks 1–8 implemented (8R manual acceptance pending);
Weeks 9–17 replaced by the ML track ML1–ML7, ML1 in progress  
**Working branch:** `phase-0-demolition` (the name is historical; the branch now
contains the rebuild through ML1)  
**Primary stack:** React 19, TypeScript, Vite, PDF.js, pdf-lib, IndexedDB,
Vitest; ML: Python, PyMuPDF, pytest

---

## How to Read the Project

### Product boundary

Margin is a single-user desktop-browser application. The browser owns the
document workspace and local persistence. It does not require an application
server, account, Firebase, S3, or collaboration service. Optional local Python
services provide OCR and RAG, but PDF reading, editing, page operations, notes,
the library, and native-text search are designed to work without them.

### Architecture in one view

```text
React components
    │
    ├── src/lib/       browser/PDF/storage adapters and stateful services
    │       │
    │       └── IndexedDB, PDF.js, pdf-lib, File System Access API
    │
    └── src/core/      pure TypeScript domain logic
            ├── annotations and command inversion
            ├── ink geometry and stroke processing
            ├── workspace layout
            ├── stable page identities
            ├── note anchors and Markdown export
            └── literal native-text search

ml/                Python: PDF block extraction and weak labels (ML track)
```

`src/core/` cannot import React, browser globals, storage, network, PDF, or
shell modules. ESLint enforces this rule and CI treats a violation as a build
failure. Components and `src/lib/` may depend on the core; the core may not
depend on them.

### Persistence model

- The original PDF or a filesystem handle identifies the source document.
- An IndexedDB sidecar stores editable Margin annotations and page workspace
  state for recovery.
- The page workspace stores immutable PDF sources plus an ordered list of page
  records. Merge and reorder operations change that list; they do not rewrite
  every annotation.
- The Margin library currently stores imported PDF blobs in a separate
  IndexedDB database. Ordinary filesystem-opened PDFs are not automatically
  added to that library.
- Search pages are extracted from the materialised PDF.js document in memory
  for each accepted document revision (the IndexedDB search cache was removed
  in Phase 8R.6).

### Source documents for the rebuild

- `docs/MARGIN_BUILD_PLAN.html` defined the original 17-week roadmap; Weeks
  1–8 follow it. From October 2026, `docs/IMPLEMENTATION_PHASES.md` is the plan
  (ML track ML1–ML7).
- Git history records the actual implementation checkpoints.
- `README.md` describes the intended current architecture, but the manual
  findings in this log take precedence where the README overstates reliability.

### ⚡ Design Decision: local-first means deleting cloud architecture

The inherited application contained Firebase authentication, Firestore file
state, S3/cloud saving, sharing, Express routes, and collaboration remnants.
Those were not retained behind dormant adapters.

> **Reasoning:** Dead integrations still impose dependencies, security surface,
> types, and failure modes. A single-user local application is easier to
> understand only if its source of truth is genuinely local.

### ⚡ Design Decision: the roadmap number is the phase number

Earlier versions of this log used internal build numbers, combined roadmap
weeks under unmatched subsection numbers, and described “Phase 3–4” without a
Phase 4 subsection. This rewrite uses the roadmap directly: Weeks 1–2 are
Phase 1–2, Weeks 3–4 are Phase 3–4, and so on. Every combined heading contains
subsections for both numbers.

---

## Phase 0: Safety Checkpoint and Plan Intake

**Date:** September 2, 2026  
**Objective:** Preserve the inherited working tree and establish the rebuild
plan before destructive removal work.

### Phase 0.1: Baseline checkpoint

- `ab63d6f` captured the pre-rebuild working tree so removed systems remained
  recoverable from Git.
- `docs/MARGIN_BUILD_PLAN.html` became the roadmap reference.
- The initial UI-design reference was vendored temporarily in `936c54a`; it was
  later removed from tracked application history as an agent-only artifact.

### ⚡ Plan Deviation: agent assets were removed from the repository

The temporary design-skill files and AI-specific instruction files were not
kept as project dependencies.

> **Reasoning:** They are development-environment artifacts, not Margin source.
> Keeping them tracked inflated diffs and risked exposing machine- or
> assistant-specific material. `.gitignore` now excludes `.agents/`,
> `.claude/`, `.codex/`, `.gpt/`, `.chatgpt/`, and named agent instruction
> files.

### Testing

- Verified both baseline commits were reachable in Git.
- No application behaviour changed in this phase.

**Git checkpoints:**  
`ab63d6f` — checkpoint: prior working tree before Phase 0  
`936c54a` — chore: vendor ui-ux-pro-max and ui-styling skills

---

## Phase 1–2: Demolition and Constructive Foundations

**Date:** September 2–8, 2026  
**Roadmap:** Weeks 1–2 — Demolition  
**Objective:** Remove abandoned server/cloud paths, isolate pure domain logic,
and add the tests, CI, and design tokens needed by every later phase.

### Phase 1.1: Remove duplicate and abandoned systems

**Removed**

- `src/lib/old-save-manager.ts` and `src/lib/saving/engine/` — competing save
  implementations whose overlapping responsibilities made the active path
  ambiguous.
- `src/lib/collab-store.ts` and `src/components/CollabUserList.tsx` — unused
  real-time collaboration surface.
- `backend/src/lib/ocr-vision.ts` — abandoned Cloud Vision integration.
- Firebase auth/config, login/signup/shared-link pages, Firestore stores,
  cloud/S3 adapters, upload/share services, and cloud-specific types.
- The Express backend, Firebase Functions project, Firebase rules, and backend
  scripts.

**Created / modified — local replacement boundary**

- `src/lib/local-fs-store.ts` — local filesystem-oriented store replacing the
  Firestore-shaped file boundary.
- `src/lib/storage/library-db.ts` — IndexedDB stores for library folders, file
  metadata, and imported blobs.
- `src/types/library.ts` — browser-local folder/file records with epoch
  timestamps and no Firebase types.
- `src/lib/saving/{adapters,file-save-controller,save-manager}.ts` — reduced to
  local save behavior.
- `src/{App.tsx,components/Header.tsx,components/PDFViewer.tsx}` — removed auth,
  cloud, and sharing entry points.

The three demolition commits removed 25,736 lines and added 478 lines. The
deletion count includes the complete backend and Functions projects, not only
frontend code.

### Phase 1.2: Establish the pure core

**Created — core**

- `src/core/annotations/models.ts` — annotation, geometry, and command types.
- `src/core/annotations/operations.ts` — add, update, delete, and batch command
  factories; every valid command carries its inverse.
- `src/core/annotations/spatial-index.ts` — quadtree used for annotation hit
  candidates.
- `src/core/annotations/test-factories.ts` — readable deterministic fixtures.

**Modified — shell compatibility**

- `src/lib/annotations/{models,operations,spatial-index}.ts` became thin
  re-export shims so existing UI imports did not need an all-at-once rewrite.
- `eslint.config.js` added the zero-tolerance core import/global boundary.

### ⚡ Bug: importing command logic opened IndexedDB

The first Node test failed with `ReferenceError: indexedDB is not defined`.
Pure command factories shared a module with a storage-backed operation log,
which opened IndexedDB during import.

> **Fix:** Move environment-free models, commands, and spatial indexing into
> `src/core/`; leave browser persistence in `src/lib/`. This failure is the
> concrete reason the boundary is enforced rather than documented informally.

### ⚡ Bug: batch construction could discard an uninvertible operation

An adversarial command test showed that the old batch builder could silently
omit a child operation that lacked an inverse.

> **Fix:** Reject the entire batch. Partial undo is worse than refusing an
> invalid command because it leaves visible state inconsistent with history.

### Phase 2.1: Test and CI safety net

**Created / modified**

- `vitest.config.ts` — Node-environment Vitest configuration.
- `src/core/annotations/operations.test.ts` — command/inverse round trips,
  document identity, batch ordering, and invalid-batch rejection.
- `src/core/annotations/spatial-index.test.ts` — basic quadtree behavior plus a
  200-run property check against a linear scan.
- `.github/workflows/ci.yml` — Node 22 install, typecheck, core-boundary lint,
  tests, and production build on pushes and pull requests.
- `README.md` — replaced aspirational cloud behavior with the local-first
  architecture and an explicit roadmap.

### Phase 2.2: Design token layer

**Created / modified**

- `src/styles/tokens.css` — semantic colors, spacing, typography, radii,
  elevations, and light/dark values.
- `src/index.css` — application styles consume shared tokens.
- `tailwind.config.js` — Tailwind names map to the same semantic tokens.

### ⚡ Design Decision: neutral workspace ground, separate annotation colors

The app accent was kept visually distinct from yellow, pink, green, blue, and
orange highlighters, and the workspace ground remained near-neutral.

> **Reasoning:** A tinted ground changes the perceived white of a PDF page; an
> accent close to a markup color makes application chrome look like document
> content.

### Testing

- 15 tests passed at checkpoint: 8 command tests and 7 spatial-index tests.
- Typecheck, core-boundary lint, and production build passed in CI.

**Git checkpoints:**  
`c72adbb` — refactor: delete orphaned save engines, collab remnants, Vision OCR  
`ca823f9` — refactor(frontend): remove Firebase auth, S3 cloud sync and sharing  
`e1f242c` — refactor: delete the Express backend and all remaining Firebase surface  
`f9c0944` — feat: core/shell split, test harness, CI, and the design token layer

---

## Phase 3–4: Interface Shell and Component System

**Date:** September 9–15, 2026  
**Roadmap:** Weeks 3–4 — Interface  
**Objective:** Replace ad-hoc document mounting and controls with a testable pane
layout and reusable token-based primitives.

### Phase 3.1: Pure pane-layout tree

**Created — core**

- `src/core/workspace/layout.ts` — recursive pane/split tree, tab activation,
  movement, edge splitting, empty-branch collapse, visible-tab calculation,
  four-pane cap, and divider clamping.
- `src/core/workspace/layout.test.ts` — 6 tests for hidden tabs, moves, branch
  collapse, close behavior, the pane cap, and divider limits.

### Phase 3.2: Workspace integration

**Modified — components / application state**

- `src/pages/Dashboard.tsx` — owns the layout tree, routes opened documents into
  panes, and renders only visible active tabs.
- `src/components/{DocumentPane,PaneHeader,DocumentsGrid,Header}.tsx` — pane
  chrome, drag targets, tab movement, closing, and active-document behavior.
- `src/components/grid-presets.css` — pane-grid styling and drop feedback.
- `src/lib/store.ts` — workspace/UI state shared by the shell.

### ⚡ Design Decision: keep hidden tabs in state, unmount their PDF viewers

> **Reasoning:** Tabs must retain identity and position, but an inactive PDF.js
> renderer consumes significant memory. The layout tree keeps all tabs while
> `visibleTabIds()` limits mounted viewers to the active tab in each pane.

### Phase 4.1: Token-based primitive set

**Created — components**

- `src/components/ui/Button.tsx` and `IconButton.tsx` — consistent button sizes,
  variants, focus states, icons, and disabled behavior.
- `ToolbarGroup.tsx`, `Popover.tsx`, `Tooltip.tsx`, and `Dialog.tsx` — reusable
  interaction/chrome primitives.
- `SegmentedControl.tsx` and `StrokeWidthControl.tsx` — shared compact tool
  options.
- `ResizablePanelGroup.tsx` — pointer- and keyboard-resizable panels.
- `VirtualizedList.tsx` — fixed-row windowing using pure range calculations.
- `src/core/ui/virtual-range.ts` and its 3 tests — visible range plus overscan,
  edge clamping, and invalid-dimension rejection.

### Phase 4.2: Toolbar and settings migration

**Modified — components**

- `Toolbar.tsx`, `ColorPicker.tsx`, `EraserOptions.tsx`,
  `HighlighterOptions.tsx`, `ImageOptions.tsx`, `SelectOptions.tsx`,
  `TextOptions.tsx`, and `SettingsModal.tsx` adopted the primitives and tokens.
- `src/main.tsx` and `src/index.css` load the common styling foundation.

### Testing

- 9 focused interface tests passed: 6 workspace-layout and 3 virtual-range.
- The combined Phase 3–6 checkpoint contained 42 tests overall.
- Keyboard/pointer pane behavior was manually exercised during the phase.

**Git checkpoint:** `b513719` — feat: complete workspace and ink quality phases

---

## Phase 5–6: Ink Quality and Unified Editing History

**Date:** September 9–15, 2026  
**Roadmap:** Weeks 5–6 — The ink  
**Objective:** Make live drawing responsive, committed strokes compact, erasing
geometrically correct, and all edits reversible through typed commands.

### Phase 5.1: Coordinate and stroke-processing core

**Created — core**

- `src/core/ink/coordinates.ts` — the single conversion boundary among screen,
  viewport, normalized page, and PDF coordinates.
- `src/core/ink/stroke-processing.ts` — Ramer–Douglas–Peucker simplification and
  cubic Bézier fitting for committed strokes.
- `src/core/ink/kalman.ts` — short-horizon pointer prediction used only for the
  temporary live preview.
- `src/core/ink/geometry.ts` — segment distance and swept-disc stroke splitting
  for the point eraser.

**Modified — rendering / tools**

- `src/lib/rendering/{annotation-renderer,stroke-smoother}.ts` — render fitted
  paths and preserve the common coordinate contract.
- `src/lib/tools/{pencil-tool,highlighter-tool,eraser-tool}.ts` — coalesced
  samples, processed stroke output, and exact partial erasure.
- `src/lib/annotations/pointer-handler.ts` — feeds the live and committed paths.

### Phase 5.2: Layered rendering and workers

**Created / modified — shell**

- `src/lib/workers/ink-render-worker.ts` and
  `ink-render-worker-manager.ts` — OffscreenCanvas-capable rendering boundary.
- `src/lib/workers/{stroke-worker,stroke-worker-manager}.ts` — background stroke
  processing.
- `src/components/AnnotationCanvas.tsx` — separates transient live ink from
  committed annotations and redraws only the affected layer.
- `src/lib/metrics/ink-debug.ts` and `benchmarks/ink/` — local latency/storage
  instrumentation and recorded gate definitions.

### ⚡ Design Decision: prediction never changes saved geometry

> **Reasoning:** Prediction hides one frame of pointer latency, but predicted
> points may be wrong. They are drawn on the transient layer and discarded when
> real input arrives; only captured samples feed the saved stroke.

### Phase 6.1: Exact partial erasure

The eraser computes the distance from its swept path to each stroke segment,
finds exact intersections, splits the stroke at the erased interval, and refits
the surviving pieces. A whole erase gesture becomes one batch command.

### ⚡ Design Decision: swept-disc geometry instead of captured-point hits

> **Reasoning:** A quick pointer movement can cross a stroke without producing
> a sample inside it. Segment-to-segment distance handles that case and makes
> erasure independent of input sampling density.

### Phase 6.2: Apply layer and shared command manager

**Created / modified**

- `src/core/annotations/apply.ts` — pure projection of operations onto visible
  annotation state.
- `src/lib/annotations/operation-manager.ts` — one document-aware undo/redo
  history and subscription boundary.
- `src/core/annotations/models.ts` and `operations.ts` — typed operation union
  and property-tested inverse semantics.
- `src/components/PDFViewer.tsx` — subscribes the React projection to command
  history and persists the resulting snapshot.

### Testing

- 13 focused ink tests passed: coordinates (3), exact geometry (4), Kalman
  prediction (3), and stroke processing/storage gate (3).
- 5 editing-history tests passed at this checkpoint: pure apply (2), operation
  manager (2), and an arbitrary-command-sequence inverse property test (1).
- All Phase 6 manual acceptance checks passed on September 22, 2026. The user
  specifically confirmed smooth drawing, smooth partial erasure, and working
  undo/redo.

**Git checkpoint:** `b513719` — feat: complete workspace and ink quality phases

---

## Phase 7: Stable Page Operations

**Date:** September 15–22, 2026  
**Roadmap:** Week 7 — Pages  
**Objective:** Give pages identities independent of position, then implement
reorder, rotate, insert, merge, extract, split, and undo on that model.

### Phase 7.1: Stable page domain

**Created — core**

- `src/core/pages/models.ts` — `PageRecord` and `PageDocument`; every page has a
  UUID, immutable source reference, source-page index, dimensions, and rotation.
- `src/core/pages/document.ts` — document construction, invariants, page moves,
  insertion/deletion, rotation normalization, and revision representation.
- `src/core/pages/annotations.ts` — one-time migration from legacy `pageNum` to
  `pageId`, derived page numbers, deletion filtering, and rotation transforms.

### ⚡ Design Decision: `pageId` is identity; `pageNum` is a projection

> **Reasoning:** Page 3 can become page 8 after reordering. An annotation tied
> only to `pageNum: 3` silently moves to the wrong content. A stable UUID follows
> the page; display position is recomputed from the current order.

### Phase 7.2: Page materialisation and command integration

**Created / modified — core and lib**

- `src/lib/pages/pdf-pages.ts` — describes imported PDF sources and materialises
  ordered/rotated/blank page records through pdf-lib.
- `src/lib/pages/storage.ts` — IndexedDB storage for immutable sources and page
  documents.
- `src/core/annotations/{models,operations,apply}.ts` — page commands join the
  annotation command union and apply path.
- `src/lib/annotations/operation-manager.ts` — page and annotation changes share
  the same undo/redo sequence.
- `src/lib/saving/{types,save-manager,file-save-controller,local-save-adapter}.ts`
  — saves use the current materialised PDF and carry page-document metadata.
- `src/types/editor-types.ts` — editor payload includes page workspace state.

### Phase 7.3: Page organiser

**Created / modified — components**

- `src/components/PageOrganizer.tsx` — selection, multi-selection, drag reorder,
  blank insertion, deletion, rotation, merge, extraction, split, and undo/redo
  controls.
- `src/components/PDFViewer.tsx` — owns page records, materialises the current
  document, reattaches annotations, and connects organiser actions to commands.

The original checkpoint displayed numbered placeholders. A September 22
working-tree follow-up now renders real PDF.js canvas thumbnails from the
materialised document. Thumbnails are observed lazily, capped to a small CSS
size, and rendered at device-pixel density. This follow-up is validated but is
not yet committed.

### ⚡ Design Decision: preview the materialised document lazily

> **Reasoning:** A preview must reflect merge, rotation, blank insertion, and
> reorder state, so it cannot read only the original PDF. Rendering every page
> eagerly would be expensive on large books; `IntersectionObserver` limits work
> to visible and near-visible cards.

### Testing

- 11 tests were added/extended for the page phase: page document behavior (7),
  annotation transforms (2), pdf-lib materialisation (1), and shared-history
  page undo (1).
- 53 tests passed at the Phase 7 checkpoint.
- All Phase 7 manual acceptance checks passed on September 22, 2026, including
  page operations, shared undo/redo, and the real page-preview follow-up.

**Git checkpoint:** `95227a1` — feat: add stable page operations  
**Uncommitted follow-up:** real lazy page previews in `PageOrganizer.tsx` and
the `pdfDoc` connection in `PDFViewer.tsx`

---

## Phase 8: Notes, Library, Search, and Portable PDF Annotations

**Date:** September 15–22, 2026  
**Roadmap:** Week 8 — Notes  
**Objective:** Link highlights to portable notes, expose a visual local library,
index document text locally, and emit standard PDF annotation objects.

**Acceptance status:** Not complete. The automated suite is green, but manual
testing found four product/integration defects listed in Phase 8.5.

### Phase 8.1: Highlight-anchored notes

**Created — core**

- `src/core/notes/notes.ts` — quote/context anchors, fallback geometry, document
  ordering, and Markdown export with `margin://` page-position links.
- `src/core/notes/notes.test.ts` — 3 tests for anchoring, ordering, and export.

**Created / modified — components and models**

- `src/components/NotesPanel.tsx` — virtualised document-order list,
  page-to-note/note-to-page focus, note editing, inline KaTeX preview, and `.md`
  download.
- `src/core/annotations/models.ts` — a highlight may carry quote, context, body,
  stable page ID, and page-space bounds.
- `src/components/PDFViewer.tsx` — creates the highlight note, focuses it, and
  updates it through the common command path.
- `src/components/AnnotationCanvas.tsx` — forwards text-aware highlight context.

### What “Markdown” means here

Markdown is plain text with lightweight markers: `# Heading`, `- list item`,
`**bold**`, and `[label](link)`. Margin exports note files in that portable
format so editors such as Obsidian can read them. The current in-app editor is a
plain textarea. It previews `$inline mathematics$` through KaTeX, but it does
not yet render headings, lists, bold, or links as formatted HTML. Therefore the
roadmap's “Markdown body” is only partially complete in the UI even though the
exported source is valid Markdown.

### ⚡ Bug caught by tests: ordering assumed every highlight had a note

The first ordering helper read note bounds directly. A newly created or legacy
highlight without note metadata could therefore sort incorrectly.

> **Fix:** Fall back to the union of highlight rectangles/path bounds. Ordering
> remains stable while a note anchor is being created or migrated.

### Phase 8.2: Local library grid

**Created / modified**

- `src/components/LibraryGrid.tsx` — import control, loading/empty states,
  responsive cover cards, pointer tilt, page count, and reopen behavior.
- `src/lib/library-preview.ts` — generates a first-page image using PDF.js.
- `src/lib/storage/library-db.ts` — stores preview, page count, last-opened time,
  and last-read page with each library record.
- `src/types/library.ts` — adds the corresponding optional metadata.
- `src/pages/Dashboard.tsx` — switches between library and workspace and opens
  stored library blobs as documents.
- `src/components/Header.tsx` — the Margin wordmark returns to the library.

### ⚡ Design Decision: ordinary Open and Library Import are separate paths

At the checkpoint, **Import** copies a PDF blob into `margin-library`, while
**Open PDF** registers a `FileSystemFileHandle` in the editor's local-file
database and opens it without creating a library record.

> **Reasoning at implementation time:** a copied blob can always be reopened
> without asking the OS for file permission, while a filesystem handle preserves
> write-back access. Manual testing shows the distinction is not understandable
> in the current UI and does not match the desired reference-library model.

### Phase 8.3: Browser-side full-text search

**Created — core and storage**

- `src/core/search/index.ts` — Unicode-aware tokenisation, inverted postings,
  all-term matching, phrase boost, snippets, and matching span bounds.
- `src/core/search/index.test.ts` — 3 tests for mathematical prose, multi-term /
  phrase ranking, and result geometry.
- `src/lib/search/storage.ts` — persisted extracted search pages in IndexedDB.

**Modified — shell**

- `src/lib/search/local-search.ts` — extracts native PDF.js text, merges unique
  OCR tokens, builds/loads the index, refreshes after OCR, and searches the
  current or all open documents.
- `src/components/PDFViewer.tsx` — registers the current materialised PDF with a
  revision derived from stable page IDs and rotations.
- `src/components/{SearchBar,Header}.tsx` — scope resolution, result navigation,
  and page highlighting.

### ⚡ Plan Deviation: IndexedDB inverted index instead of SQLite FTS5

The roadmap specified SQLite FTS5. The implemented application has no Node or
native application backend, and adding one only for search would reverse the
local browser architecture established in Phase 1.

> **Reasoning:** Keep tokenisation/ranking pure and persistence browser-local.
> This preserves the core/shell split and works in the static build. It does not
> claim feature or performance parity with SQLite FTS5; large-library
> benchmarking remains future work.

### Phase 8.4: Standard PDF annotation export

**Created / modified**

- `src/lib/pdf-annotations.ts` — maps Margin highlights, ink, text, and shapes to
  standard PDF annotation dictionaries and embeds the complete Margin model as
  a JSON attachment for lossless reopening.
- `src/lib/pdf-annotations.test.ts` — 2 pdf-lib round-trip tests.
- `src/lib/pdf-data-manager.ts` and
  `src/lib/saving/local-save-adapter.ts` — use editable annotation export in the
  save path.

### ⚡ Bug caught by tests: repeated export accumulated stale metadata

Saving an already exported document could retain an older Margin JSON
attachment and duplicate annotation names.

> **Fix:** Replace Margin metadata rather than append it, and enforce unique
> `/NM` annotation identifiers across repeated export round trips.

### Phase 8.5: Manual acceptance findings

The following results were reported on September 22, 2026.

**Passed**

- Inline `$...$` mathematics renders correctly in the note preview.
- Undo/redo works in the tested editing flow.

**Failed / redesign required**

1. **One highlight creates one note.** Repeating a highlight 1,000 times creates
   1,000 note cards. This follows the current model exactly:
   `PDFViewer.handleAnnotationSave()` attaches `createHighlightNote()` to every
   new highlight and opens the notes panel. It is not a rendering-only problem.
   The note model must allow one user-created note to own multiple highlight
   anchors, or highlights must remain unnoted until explicitly attached.

2. **Textbox interaction performs poorly.** The current implementation is
   concentrated inside the already large `AnnotationCanvas.tsx`: creation,
   editing, dragging, resizing, outside-click commit, style synchronization,
   selection conversion, and canvas rendering use several document-level mouse
   effects and mutable textarea behavior. The user requested a from-scratch
   rewrite rather than incremental patching.

3. **Opening a second PDF does not add it to the library.** Confirmed cause:
   `LibraryGrid.importFiles()` calls `libraryDB.importFile()`, but
   `Dashboard.handleOpenPDF()` only writes a filesystem record to
   `localFileDB`. The existing library also stores full blobs, whereas the
   desired feature is a folder hierarchy of references to PDFs. Folder CRUD
   methods already exist in `library-db.ts`, but no folder UI exists and records
   do not yet store a `FileSystemFileHandle` reference.

4. **Search fails after merging another PDF.** The symptom is confirmed by
   manual testing. Unit tests cover the pure index, but no integration test
   covers merge → materialise → re-register → search imported-page text. The
   registry is intended to re-index when the page-document revision and PDF.js
   document change, so the exact failing lifecycle must be reproduced and
   instrumented before assigning a root cause.

**Not yet reported**

- Large-note-list scrolling and note/page bidirectional focus at scale.
- Markdown download opened in an external Markdown editor.
- Reopen persistence for notes and real PDF annotations.
- Repeated native PDF export through the visible UI.

### Testing

- 8 tests were added in Phase 8: notes (3), search (3), and PDF annotation
  round trips (2).
- The repository suite now contains 61 tests in 16 test files.
- Automated tests, typecheck, core-boundary lint, and production build are
  green as of the validation recorded in Current Project State.
- Phase 8 remains **not accepted** because automated coverage did not exercise
  the four failed manual workflows above.

**Git checkpoint:** `7a058e9` — feat: complete notes library and search phase  
The commit subject records implementation completion; it should not be read as
manual acceptance of the phase.

---

## Phase 8R.1: Textbox Rewrite

**Date:** September 22, 2026  
**Objective:** Replace the textbox interaction from scratch without changing
the persisted `TextAnnotation` format or bypassing the shared undo/redo path.

### Phase 8R.1.1: Pure editor-session model

**Created — core**

- `src/core/text-editor/state.ts` — create/edit session identity, controlled
  draft state, frame fitting, clamped movement, bounded resizing, content
  growth, commit validation, and overlay-to-page coordinate conversion.
- `src/core/text-editor/state.test.ts` — 7 deterministic tests covering initial
  placement, editing identity, movement, resize limits, auto-growth, empty-text
  rejection, and normalized page geometry.

The editor session contains no React, DOM, storage, or PDF imports. Frame rules
can therefore be tested without simulating pointer events in a browser.

### Phase 8R.1.2: Dedicated text editor component

**Created — component**

- `src/components/TextAnnotationEditor.tsx` — controlled textarea, explicit
  commit/cancel actions, keyboard commit (`Ctrl/Cmd+Enter`), Escape cancellation,
  content-driven height growth, formatting preview, drag movement, and
  bottom-right resizing.

**Modified — components**

- `src/components/AnnotationCanvas.tsx` — reduced textbox responsibility to
  opening a session, loading an existing annotation's style, and converting a
  committed session back into `TextAnnotation` geometry. The previous textbox
  refs, uncontrolled textarea mutation, capture-phase outside-click commit, and
  document-level drag/resize listeners were removed.
- `src/components/FloatingFormatToolbar.tsx` — exposes an explicit pointer-down
  move handle and can render below a box placed too close to the top edge.

### ⚡ Design Decision: pointer capture instead of document mouse listeners

The former implementation installed separate `mousedown`, `mousemove`, and
`mouseup` listeners on `document` for every open textbox. Drag and resize state
was split across several refs and effects.

> **Reasoning:** Pointer capture keeps the interaction owned by the control that
> started it, continues receiving events outside the handle, supports mouse and
> pen input through one API, and cleans itself up at pointer end. No global drag
> listener remains in the textbox implementation.

### ⚡ Design Decision: explicit commit or cancel

Clicking outside no longer commits text in the capture phase. The editor stays
open until the check button / `Ctrl+Enter` commits it, Escape / the cancel button
discards it, or changing tools closes it.

> **Reasoning:** The previous outside-click handler could commit and remove the
> editor before the same click reached the canvas, allowing the event to create
> a second textbox. Explicit completion makes the state transition predictable
> and prevents accidental annotations.

### Compatibility and undo behavior

- Existing text annotations keep the same persisted model and can be reopened.
- Editing loads the annotation's color, background, font, and emphasis instead
  of silently replacing them with unrelated current-tool defaults.
- New and edited annotations still call `PDFViewer.handleAnnotationSave()`, so
  they become normal add/update commands on the shared undo/redo stack.
- Subscript and superscript character conversion remains available through the
  floating formatting toolbar.

### Testing

- Focused text-editor state tests: 7/7 passed.
- Typecheck: passed.
- Core-boundary lint: passed with zero warnings.
- Focused lint for the new editor and modified toolbar: passed.
- Full regression suite and production build are recorded in Current Project
  State below.
- Manual UI acceptance is pending; the exact checklist is provided with the
  phase hand-off.

**Git checkpoint:** `f390691` — feat: complete phase 8 repairs

---

## Phase 8R.2: Independent Notes with Multiple Highlight Anchors

**Date:** September 22, 2026  
**Objective:** Stop creating one empty note for every highlight. Make notes
independent document entities that can collect several highlight anchors while
remaining compatible with Phase 8 files and the shared undo/redo history.

### Phase 8R.2.1: Independent note and anchor model

**Created — core**

- `src/core/notes/models.ts` — defines `DocumentNote` and `NoteAnchor`.
  A note owns its text and timestamps; each anchor records the highlight ID,
  stable page ID, derived page number, quote context, and normalized bounds.

**Modified — core**

- `src/core/notes/notes.ts` — creates notes and anchors, adds/removes anchors,
  migrates the former `HighlightAnnotation.note` shape, synchronizes anchors
  after page operations, orders notes by their first anchor, filters anchors
  for extracted PDFs, applies note operations, and exports grouped Markdown.
- `src/core/annotations/models.ts` — adds lightweight text-selection context to
  highlights and adds typed add/update/delete note commands to `Operation`.
- `src/core/annotations/operations.ts` — supplies note command factories with
  complete inverse operations.
- `src/core/annotations/apply.ts` — leaves annotation projection unchanged for
  note-only commands while still applying mixed batches correctly.

New highlights now retain quote context without owning or implicitly creating a
note. An empty note can exist before its first anchor, and one note can collect
anchors from several pages.

### ⚡ Plan Deviation / Design Decision: an active note controls grouping

The original Phase 8 implementation treated the highlight itself as the note.
That made every highlighter action create another card, including hundreds of
empty cards during ordinary study marking.

> **Reasoning:** A note is now created only by the explicit **New note** action.
> Selecting it makes it active; subsequent highlights attach to that note until
> another note is selected. An existing focused highlight can also be attached
> explicitly. This follows the reported study workflow without making ordinary
> highlighting produce note data.

### Phase 8R.2.2: Notes panel and editor integration

**Modified — components**

- `src/components/NotesPanel.tsx` — replaces highlight-backed cards with note
  cards, adds **New note** and **Attach highlight**, shows every page anchor,
  supports anchor focus and detach, keeps inline mathematics preview, deletes a
  note without deleting its highlights, and exports grouped Markdown.
- `src/components/PDFViewer.tsx` — owns the note projection beside annotations,
  batches a new highlight with its active-note anchor, moves an explicitly
  attached highlight out of any previous note, removes stale anchors when a
  highlight or page is deleted, synchronizes page numbers after page moves, and
  routes note edits through the same operation manager used by annotations.
- `src/components/AnnotationCanvas.tsx` — records quote/prefix/suffix selection
  context on a text-aware highlight but no longer constructs a note.

Creating, editing, deleting, attaching, and detaching notes are undoable. A
highlight plus its automatic active-note attachment is one batch command, so a
single undo restores the state that existed before the gesture.

### Phase 8R.2.3: Persistence, migration, and portable export

**Modified — lib and shared types**

- `src/lib/annotations/storage.ts` — stores notes with annotations in the local
  IndexedDB sidecar and copies the complete document state when identity moves.
- `src/lib/annotations/operation-manager.ts` — recognizes note commands as
  projection-owned operations while retaining them in shared history.
- `src/lib/pdf-data-manager.ts` — writes a versioned `{ objects, notes }` JSON
  attachment, reads that format, and continues reading the former raw annotation
  array format.
- `src/lib/saving/local-save-adapter.ts` — includes notes in editable PDF
  packages rather than preserving them only in the separate JSON backup.
- `src/types/editor-types.ts` — adds notes to `AnnotationData` so backup,
  manual save, package export, and crash recovery share one payload contract.

Old Phase 8 highlights with an embedded `note` migrate deterministically to one
independent note with one anchor. Highlights that never had a note remain plain
highlights; migration does not recreate the original note explosion.

### ⚡ Bug: pdf-lib attachments are compressed after a save round trip

The new persistence test initially failed because extraction passed the raw
compressed PDF stream bytes directly to `JSON.parse`. The old extractor had the
same latent problem, but its earlier tests only counted attachment records and
never reopened their contents.

> **Reasoning:** Extraction now detects `PDFRawStream` and decodes its filter
> chain before UTF-8 and JSON decoding. Testing the actual recovered note model,
> rather than only the attachment dictionary, prevents a green test from hiding
> unreadable persisted data.

### Files created / modified

**Core**

- `src/core/notes/models.ts` — independent note and anchor contracts.
- `src/core/notes/notes.ts` — note lifecycle, migration, synchronization,
  ordering, filtering, history projection, and Markdown export.
- `src/core/notes/notes.test.ts` — seven grouped-note and migration tests.
- `src/core/annotations/models.ts`, `operations.ts`, and `apply.ts` — typed,
  reversible note commands inside the existing operation system.

**Library and shared data**

- `src/lib/annotations/storage.ts` and `operation-manager.ts` — sidecar and
  history integration.
- `src/lib/pdf-data-manager.ts` and `pdf-annotations.test.ts` — versioned PDF
  attachment round trip, legacy reading, and decoded stream handling.
- `src/lib/saving/local-save-adapter.ts` and `src/types/editor-types.ts` — note
  payload propagation through every local save form.

**Components**

- `src/components/NotesPanel.tsx` — grouped-note controls and rendering.
- `src/components/PDFViewer.tsx` — document-level note state, commands,
  persistence, and page/highlight lifecycle coordination.
- `src/components/AnnotationCanvas.tsx` — selection context without implicit
  note creation.

### Testing

- Seven note tests cover selection context, multi-anchor grouping and
  deduplication, legacy migration, document ordering, undo/redo, page-anchor
  synchronization, and grouped Markdown export.
- One new PDF round-trip test verifies that annotations and grouped notes are
  recovered from a saved attachment. It caught the compressed-stream bug above.
- Full suite: 73/73 tests passed in 17 files.
- Typecheck: passed.
- Core-boundary lint: passed with zero warnings.
- Focused `NotesPanel.tsx` lint: passed with zero warnings.
- Production build: passed with the existing non-fatal PDF.js asset,
  mixed-import, Browserslist-age, and chunk-size warnings.
- Manual UI acceptance is intentionally pending at the user's request.

**Git checkpoint:** `f390691` — feat: complete phase 8 repairs

---

## Phase 8R.3: Library References and Folders

**Date:** September 22, 2026  
**Objective:** Make the visible library and the document-opening path use one
identity and one folder model. Persist references to PDFs where the browser
supports file handles, while retaining an explicit stored-copy fallback.

### Phase 8R.3.1: Reference identity and folder paths

**Created — core**

- `src/core/library/references.ts` — deterministic file identity from name,
  size, and modification time; cycle-safe folder breadcrumb construction; and
  library-name normalization.
- `src/core/library/references.test.ts` — five tests for identity stability and
  replacement detection, root-to-current folder paths, corrupt-cycle safety,
  and name normalization.

**Modified — shared types**

- `src/types/library.ts` — distinguishes handle-backed references from
  blob-backed compatibility copies and records the source fingerprint used for
  deduplication.

### Phase 8R.3.2: IndexedDB reference storage and compatibility

**Modified — lib**

- `src/lib/storage/library-db.ts` — upgrades `margin-library` to schema version
  2 with a separate structured-clone file-handle store; adds handle reference
  creation, source deduplication, permission-aware reopening, missing-source
  results, file movement, and complete handle cleanup during deletion.
- Existing version-1 entries remain valid. An entry without `storageMode` is
  interpreted as a blob-backed record, so the upgrade does not require a
  destructive data migration.

When the same disk PDF is chosen again, the existing library identity is
reused. If an older stored-copy entry matches the selected file, choosing it
through the File System Access picker upgrades that entry to a handle reference
and removes Margin's redundant blob.

### ⚡ Plan Deviation / Design Decision: store handles separately from metadata

The file row records whether its source is a handle or a blob, but the actual
`FileSystemFileHandle` lives in its own IndexedDB object store.

> **Reasoning:** Folder and recent-document listings should read small metadata
> records only. Keeping browser capability objects behind the storage adapter
> also prevents UI components and pure library logic from depending on handle
> serialization details.

### Phase 8R.3.3: Visible folder library

**Modified — components**

- `src/components/LibraryGrid.tsx` — replaces the flat all-files shelf with
  folder-scoped contents, breadcrumbs, folder creation/rename/recursive delete,
  reference rename/removal, folder movement, source-mode labels, and an explicit
  explanation of reference versus stored-copy behavior. Cover generation reads
  through the same permission-aware source resolver and never prompts in the
  background.
- `src/components/Header.tsx` — renames the ambiguous **Open** action to
  **Open & add**, making its library effect visible before the picker opens.

Deleting a handle-backed entry or folder removes only Margin's reference and
metadata. It does not delete the original disk file. Moving a card changes only
its Margin folder.

### Phase 8R.3.4: One open/add workflow

**Modified — page integration**

- `src/pages/Dashboard.tsx` — both the header picker and the library's
  folder-specific add action now create/reuse a library entry before opening a
  tab. The library entry ID becomes the session document ID, preventing a tab
  and card for the same selected file from silently becoming unrelated records.
- Opening a handle-backed card requests read permission again when the browser
  no longer grants it, then restores the handle to the local save pipeline.
- Browsers without `showOpenFilePicker` use the hidden file input, clearly label
  the action **Import PDF copies**, store the fallback blob in the selected
  folder, and still reuse the library entry as the tab identity.

### ⚡ Bug / Design Correction: opening a PDF bypassed the library

Before this repair, `LibraryGrid` imports called `libraryDB.importFile()`, but
the header's `Dashboard.handleOpenPDF()` path only created a local editor record
and a random tab ID. A PDF could therefore be open and editable without ever
appearing in the library, exactly matching the reported missing-second-PDF
behavior.

> **Reasoning:** The library entry is now created first and its ID is used by
> the editor. This makes “open,” “add to Margin,” reopen, save metadata, reading
> progress, and deduplication one lifecycle instead of parallel systems.

### Files created / modified

**Core**

- `src/core/library/references.ts` — pure reference identity, breadcrumb, and
  name rules.
- `src/core/library/references.test.ts` — five deterministic library tests.

**Library and shared data**

- `src/lib/storage/library-db.ts` — version-2 handle/blob persistence,
  permission-aware source resolution, deduplication, movement, and cleanup.
- `src/types/library.ts` — persisted source mode and fingerprint fields.

**Components and integration**

- `src/components/LibraryGrid.tsx` — navigable folder/reference library.
- `src/components/Header.tsx` — explicit open-and-add wording.
- `src/pages/Dashboard.tsx` — unified picker, library, fallback, tab, and local
  editor identity flow.

### Testing

- Five new pure tests cover reference identity and folder path rules.
- Full suite: 78/78 tests passed in 18 files.
- Typecheck: passed.
- Core-boundary lint: passed with zero warnings.
- Focused `LibraryGrid.tsx` lint: passed with zero warnings.
- Production build: passed with the existing non-fatal PDF.js asset,
  mixed-import, Browserslist-age, and chunk-size warnings.
- Handle permission prompts, folder visuals, and browser restart behavior need
  real UI/browser interaction, so manual acceptance remains pending.

**Git checkpoint:** `f390691` — feat: complete phase 8 repairs

---

## Phase 8R.4: Merged-Document Search Lifecycle

**Date:** September 22, 2026  
**Objective:** Reproduce the reported merge-then-search failure with real PDF
materialisation, fix the registration lifecycle rather than masking the
symptom, and prevent stale asynchronous index work from replacing newer state.

### Phase 8R.4.1: Reproducible merged-PDF integration test

**Created — lib test**

- `src/lib/search/local-search.test.ts` — creates two one-page PDFs with
  different searchable terms using `pdf-lib`, materialises the first document,
  appends the second source through the real page model, opens both outputs with
  PDF.js, registers each revision, and verifies that the imported term is found
  on page 2. A second controlled test delays the old PDF extraction and confirms
  that its late result and cleanup cannot replace or unregister the newer
  generation.

The test uses an injected in-memory index store. PDF creation, page copying,
PDF.js text extraction, registry generation, and full-text search remain real;
only browser IndexedDB is replaced so the test can run in the Node CI boundary.

### Phase 8R.4.2: Revision-aligned registration

**Modified — core**

- `src/core/pages/document.ts` — adds one canonical page-document revision
  function based on stable page IDs, order, and rotation.
- `src/core/pages/document.test.ts` — verifies that reordering or rotating a
  page changes that revision.

**Modified — component integration**

- `src/components/PDFViewer.tsx` — records the revision only after the
  corresponding materialised PDF.js document wins the render-generation check.
  Search registration therefore receives a matched `(PDF.js document,
  page-document revision)` pair rather than a new revision with the previous
  rendered PDF. Every accepted PDF.js document also publishes its actual
  fingerprint to the dashboard.

### ⚡ Bug: React state exposed the new revision before the new PDF existed

`pageDocument` changed as soon as a merge command was applied, but `pdfDoc`
changed only after asynchronous materialisation and PDF.js loading. The search
effect depended on both, so it could register the old PDF with the new revision
between those two events.

> **Reasoning:** Revision state now belongs to the accepted rendered document,
> not the requested page model. This preserves the invariant that a cache key
> describes the exact PDF whose pages are being extracted.

### Phase 8R.4.3: Generation-owned asynchronous indexing

**Modified — lib**

- `src/lib/search/local-search.ts` — exports an injectable registry, assigns a
  monotonically increasing generation to every registration/rebuild, returns a
  generation-scoped disposer, rejects late page extraction, filters search
  results whose registration changed while awaiting readiness, and exposes a
  small read-only registration snapshot for deterministic diagnostics.
- `src/lib/search/storage.ts` — opens IndexedDB lazily so the registry can be
  tested in Node, and replaces only the requested revision's cached rows rather
  than deleting every revision for the same fingerprint.

An old React effect cleanup can no longer unregister a newer document with the
same tab ID. Likewise, an extraction that began before a merge cannot publish
its index after the merged generation becomes current.

### ⚡ Bug: current-document search was keyed by a changing PDF fingerprint

Materialising a merged PDF produces a new PDF fingerprint. `SearchBar` captured
the old fingerprint when it expanded, while the registry correctly registered
the merged document under the new fingerprint. Searching the current document
then filtered out the only valid registration.

> **Reasoning:** Open-tab document IDs are stable across merge, reorder, and
> rotation. Search scope now uses that ID; fingerprints remain result metadata
> for cross-document matching and cache identity, not UI scope identity.

### Phase 8R.4.4: Stable scope resolution

**Modified — core and component**

- `src/core/search/index.ts` — adds pure resolution of current, explicit, and
  all-document scopes to stable document IDs.
- `src/core/search/index.test.ts` — verifies all three scope cases.
- `src/components/SearchBar.tsx` — removes captured-fingerprint scope state and
  delegates scope resolution to the pure helper. Current-document search now
  follows the current open tab, and an explicitly selected PDF remains locked
  by its tab ID.

### Files created / modified

**Core**

- `src/core/pages/document.ts` and `document.test.ts` — canonical page revision
  plus reorder/rotation coverage.
- `src/core/search/index.ts` and `index.test.ts` — stable search-scope IDs and
  regression coverage.

**Library**

- `src/lib/search/local-search.ts` — generation-safe registration, disposal,
  readiness, diagnostics, and injected persistence.
- `src/lib/search/storage.ts` — lazy database creation and revision-specific
  replacement.
- `src/lib/search/local-search.test.ts` — real merge/materialise/PDF.js/search
  integration and controlled stale-generation race tests.

**Components**

- `src/components/PDFViewer.tsx` — accepted-render revision and fingerprint
  publication.
- `src/components/SearchBar.tsx` — stable document-ID scoping.

### Testing

- The new integration test finds the second PDF's unique word on merged page 2.
- The race test confirms that an old delayed build and disposer cannot affect
  the current registration.
- Two pure assertions cover page revision changes; one pure test covers all
  search-scope modes.
- Full suite: 82/82 tests passed in 19 files.
- Typecheck: passed.
- Core-boundary lint: passed with zero warnings.
- Focused search registry and `SearchBar.tsx` lint: passed with zero warnings.
- Production build: passed with the existing non-fatal PDF.js asset,
  mixed-import, Browserslist-age, and chunk-size warnings.
- The visible merge → immediate search interaction remains a manual browser
  checkpoint because timing, focus, and result navigation are UI behavior.

**Git checkpoint:** `f390691` — feat: complete phase 8 repairs

---

## Phase 8R.5: Phase 8 Repair Acceptance

**Date:** September 22, 2026  
**Objective:** Re-run every deterministic gate for the four Phase 8 repair
subphases and define one reproducible browser acceptance pass. Do not declare
Phase 8 accepted until the user reports the UI results.

### Automated acceptance

The complete working tree from Phase 8R.1 through Phase 8R.4 was first
validated together rather than validating each repair only against its focused
tests. The first manual textbox attempt then exposed a render loop, so Phase
8R.5 also contains the acceptance fix and its regression coverage.

- TypeScript project-reference build passed.
- Core-boundary ESLint passed with zero warnings.
- `git diff --check` passed; the reported messages are Git's existing LF/CRLF
  conversion notices, not whitespace errors.
- Full regression suite passed: 83/83 tests in 19 files.
- Production build passed with the already documented non-fatal PDF.js asset,
  mixed-import, Browserslist-age, and large-chunk warnings.

### Text-tool selection crash found during manual acceptance

The first textbox check did not reach the page-click or typing steps. Merely
selecting the Text tool caused React to throw `Maximum update depth exceeded`;
the stack ended at the text editor's layout measurement.

> ⚡ **Bug — auto-growth could update forever at a size limit**
>
> `TextAnnotationEditor` measured `scrollHeight` while its textarea was forced
> to fill the current editor height, then requested another 18 pixels. At the
> page boundary — or before measurable page bounds were available — the resize
> was clamped back to the existing geometry but returned a new session object.
> The component treated that new identity as a change and updated React state
> again on every layout pass.
>
> **Reasoning:** Fix both sides of the loop. The component now temporarily
> collapses the textarea to measure intrinsic content height, while the pure
> state helper returns the original session when clamping cannot change its
> dimensions. The second guard is intentional defense in depth: selection must
> remain safe even if page geometry is temporarily zero during mounting.

**Files modified — component**

- `src/components/TextAnnotationEditor.tsx` — measures intrinsic textarea
  content height instead of adding padding to the already stretched element.

**Files modified — core**

- `src/core/text-editor/state.ts` — makes content growth idempotent when the
  requested size is already satisfied or page bounds prevent further growth.
- `src/core/text-editor/state.test.ts` — covers repeated growth at the page edge
  and the zero-bounds mounting case. The focused suite now has 8 tests.

### Manual acceptance protocol

Use text-based PDFs rather than scanned images for the search checks. The two
merge PDFs should contain different easily recognized words.

**Textbox rewrite — Phase 8R.1**

1. Create a textbox, enter several lines, drag it, resize it, change formatting,
   and commit with `Ctrl+Enter`.
2. Reopen it, edit the text, and commit with the check button.
3. Reopen it again, make a change, and press Escape. The previous committed
   text must remain.
4. Undo and redo the committed edit. Position, size, text, and formatting must
   follow the same history entry without creating a second textbox.

**Grouped notes — Phase 8R.2**

1. Create one note and make three highlights. The panel must show one note with
   three anchors, not three notes.
2. Create a second note and highlight another passage. The new anchor must
   belong to the second active note.
3. Focus an earlier highlight and attach it to the second note. It must move
   from the first note rather than appear in both.
4. Enter inline mathematics such as `$e^{i\\pi}+1=0$`, detach and reattach an
   anchor, then undo and redo those changes.
5. Delete a note. Its highlights must remain on the PDF.

**Reference library and folders — Phase 8R.3**

1. Create and rename a folder, enter it, and add two PDF references.
2. Confirm both cards say **Reference**, open as tabs, and remain in the folder
   when returning to the library.
3. Move one card to another folder and confirm it appears only there.
4. Use **Open & add** on the same disk PDF again. It must reuse the existing
   card/tab identity rather than creating a duplicate.
5. Reload Margin and reopen the reference, granting read permission if asked.
6. Remove a reference and delete a test folder. The original disk PDFs must
   remain untouched.

**Merged-document search — Phase 8R.4**

1. Search the first PDF for its unique word using **Current PDF**.
2. Merge the second PDF, then immediately search for its unique word using the
   same scope. The result must point to the appended page.
3. Select the result and confirm the viewer scrolls to that page.
4. Move or rotate the imported page and search again.
5. Undo the merge and confirm the imported word disappears; redo it and confirm
   the word returns.

### Acceptance status

- Automated: **passed**.
- Manual textbox acceptance: **crash repaired; pending user retest**.
- Manual grouped-notes acceptance: **pending user report**.
- Manual library/folder acceptance: **pending user report**.
- Manual merged-search acceptance: **pending user report**.
- Overall Phase 8: **not yet accepted**.

**Git checkpoint:** `f390691` — feat: complete phase 8 repairs  
The checkpoint records the implemented repair set and green automated gates;
the manual browser acceptance status above remains pending.

---

## Phase 8R.6: Native Keyword Search and Header Repair

**Date:** September 26, 2026
**Objective:** Remove the unfinished semantic-search surface and replace the
existing ranked PDF/OCR index with predictable literal search over native PDF
text only. Recompose the header so search has a stable home and no longer
pushes document tabs and actions around when opened.

### Native PDF keyword search rebuilt from scratch

**Modified — core**

- `src/core/search/index.ts` — replaces token postings, AND-term ranking, and
  phrase boosting with case-insensitive literal matching. Results preserve
  document/page order and carry only the PDF text spans overlapping each hit.
- `src/core/search/index.test.ts` — covers whitespace/case normalization,
  literal phrase behavior, repeated occurrences, span bounds, and stable scope
  IDs.

**Modified — library and integration**

- `src/lib/search/local-search.ts` — extracts PDF.js native text once per
  accepted document revision and searches the in-memory pages. It has no OCR
  input, refresh hook, ranking, embedding call, or persistent search cache.
- `src/lib/search/local-search.test.ts` — exercises a real merged PDF, stale
  asynchronous generation protection, and the intentionally OCR-free API.
- `src/components/PDFViewer.tsx` — registers only the accepted native PDF.js
  document; OCR completion no longer rebuilds search.
- `src/lib/search/storage.ts` — removed. Search no longer persists a second,
  potentially stale IndexedDB copy of page text.

> ⚡ **Plan Deviation / Design Decision — semantic search is removed for now**
>
> The roadmap left semantic search behind an undeployed service milestone. The
> dedicated search API, ranking script, and compose file have been deleted.
> Embedding and Qdrant code that still serves the separate assistant retrieval
> path remains; it is no longer described or exposed as document search.
>
> **Reasoning:** A small, deterministic Ctrl+F-style search is useful now and
> testable locally. An unavailable semantic mode and OCR-derived matches made
> result behavior harder to explain and coupled a basic reader feature to
> optional services. Scanned pages therefore return no keyword matches until a
> later phase explicitly designs an OCR-search contract.

### Header composition

**Modified — components**

- `src/components/Header.tsx` — separates the product/search/action row from a
  dedicated document-tab row, gives the brand a compact local-workspace mark,
  keeps the search field at a stable width, and adds clearer active-tab and
  empty-workspace states.
- `src/components/SearchBar.tsx` — remains visible instead of expanding into
  the tab strip, adds an explicit Search action, labels results as literal PDF
  text matches, and states that OCR text is excluded.

### Semantic-search files removed

- `ingest-pipeline/search.py` — removed hybrid vector/ranking implementation.
- `ingest-pipeline/search_api.py` — removed undeployed semantic-search route.
- `ingest-pipeline/docker-compose.search.yml` — removed standalone search
  service definition.

### Testing

- Focused keyword/search presentation suite: 15/15 tests passed.
- Full suite: 184/184 tests passed in 31 files.
- Typecheck and focused/core lint passed with zero warnings.
- Normal production build and static demo build passed.
- Demo bundle audit passed: 90 normal assets and 92 demo assets.
- Manual header appearance, result navigation, and scanned-PDF exclusion checks
  are pending user review.

**Git checkpoint:** `9e79ffa`, committed together with the F8R.2 chrome
redesign. The header and search-bar layout described above were superseded by
F8R.2 (see `docs/frontend_implementation_log.md`); the literal native-text
search core is unchanged. Manual acceptance is still pending.

---

## Roadmap Revision: ML Track Replaces Weeks 9–17

**Date:** October 1, 2026
**Plan:** `docs/IMPLEMENTATION_PHASES.md` (rewritten)

The remaining roadmap weeks (version history, cache policies, OCR escalation,
layout and reading order, knowledge bundles) are replaced by an ML track,
ML1–ML7. PDF question answering stays. Its context comes from an OKF knowledge
bundle per PDF plus hybrid search, and three project-owned models decide what
goes in: a block classifier, a learned ranker, and an optional answerability
gate.

> ⚡ **Design Decision: own the ML instead of wiring pretrained tools**
>
> Every ML part so far was an off-the-shelf component (PaddleOCR, llama.cpp,
> a web-trained cross-encoder) with no modelling decisions, datasets or
> evaluation in the repo.
>
> **Reasoning:** the new track has a defined problem, a dataset built here,
> baselines, grouped splits and statistical evaluation, and the product depends
> on it: without the classifier there is no knowledge bundle. A custom OCR
> pipeline was considered first and postponed; it needed weeks of material not
> yet studied and put the first demo too late in placement season.

> ⚡ **Plan Deviation: custom OCR, reading order and math OCR postponed**
>
> Scanned PDFs stay out of the ML track. They are kept in the manifest as
> `scan-slice` for a later OCR phase.

---

## Phase ML1: Dataset and Block Extraction

**Date:** October 1–6, 2026
**Objective:** Build the document dataset and turn every text PDF into blocks
with layout features and weak labels taken from formal headings
("Definition 2.1", "THEOREM 1.25", "Proof.", "Algorithm 7 …"), as training data
for the block classifier.

### ML1.1: Dataset manifest

**Created**

- `Test PDFs/manifest.csv` — 57 PDFs with `group` (independent source:
  author, course or template), `category`, `text_layer`, `use` and notes. 47
  are `main` (text layer), 6 `scan-slice` (no or scanner-only text), 4
  `other` (non-maths). PDFs themselves are git-ignored.

> ⚡ **Design Decision: the unit of splitting is the source group**
>
> The 11 MA3204 slide decks share an author and a Beamer template; two
> side-channel papers share authors; a thesis and an SoK paper share an author.
> Splitting by file would let the model pass a test by recognising a template.
> 37 groups were defined; train/dev/test splits will be drawn by group.

Curation removed four PDFs (two handwritten, one image-only report, an 88%
duplicate) and a byte-identical duplicate paper; arXiv mathematics and
statistics papers were added to supply theorem-dense, prose-style text.

### ML1.2: Block extraction pipeline

**Created**

- `ml/data/extract_blocks.py` — PyMuPDF spans → visual rows → columns → lines
  → blocks → features, JSONL output, per-file report and overlay images.
- `ml/data/heading_rules.py` — pure heading detection, label mapping, heading
  removal, table-of-contents detection.
- `ml/tests/test_heading_rules.py`, `ml/tests/test_layout.py` — 68 tests.
- `ml/README.md` — usage and output schema.
- `.gitignore` — `ml/out/` (copyrighted extracted text) and `!ml/data/`.

Each block records its text, the text without the heading, the visual lines,
a normalised bounding box, font size relative to the page, bold/italic/mono and
maths-character ratios, indent, gap above, the weak label and subtype, heading
number and evidence, and flags.

> ⚡ **Design Decision: unlabelled is not "other"**
>
> A block without a heading gets `weak_label = null`. Definitions written as
> prose are exactly what the classifier must find, so absence of a heading
> cannot be treated as a negative label.

> ⚡ **Design Decision: train on heading-free text**
>
> `text_without_heading` removes the matched heading. A model trained on the
> full text would learn the regex that produced its labels.

### Bugs found while validating on five diverse PDFs

Validation used one Beamer deck, one arXiv paper, an older Ghostscript paper,
NIST FIPS 203 and 48 pages of Sipser, checked with overlay images, a full label
audit, and a word-order metric (share of word pairs in a block that also occur
consecutively in PyMuPDF's raw page text).

> ⚡ **Bug: the reader's own annotations leaked in as paper text**
>
> `boneh franklin ibe.pdf` carries 30 typed notes; on one page they contributed
> more characters than the paper. Spans covered ≥ 50% by FreeText, Text,
> Stamp, Widget or Caret annotations are now dropped (391 spans).

> ⚡ **Bug: single-column maths pages were read as two columns**
>
> Columns were decided by counting individual spans either side of the page
> centre. Maths pages consist of hundreds of tiny spans, so lines were cut in
> half and words interleaved. Rows are now built for the whole page first, and a
> page is two-column only if a gap wider than a word space is free of text at
> the same x in ≥ 75% of rows (`detect_gutter`).

> ⚡ **Bug: tall glyphs merged neighbouring lines**
>
> A big bracket, an operator with limits, or the rotated arXiv stamp stretched
> a row's height until it swallowed the lines above and below. Only
> ordinary-height body-size spans may widen a row; rotated text is dropped;
> rows of small text (subscripts, limits) are attached to the nearest full line.

> ⚡ **Bug: wrapped references became headings**
>
> A line starting "Lemma 4.6 excludes …" after a line that did not end a
> sentence split the block and was labelled as a lemma. Heading evidence now
> comes from the keyword's own span (bold, or a font different from the page
> body font) and from whether the previous line ended a sentence. A keyword and
> number followed by a lowercase word without a terminator is a sentence, not a
> heading. This also removed every theorem-and-proof merge.

> ⚡ **Bug: double-spaced documents fell apart**
>
> In a double-spaced paper the ordinary line gap exceeded the fixed block
> threshold, giving 17.9 blocks per page. The threshold now grows with the
> page's median line gap, and paragraphs are split at a short last line ending
> a sentence (5.7 blocks per page).

Smaller fixes: "Algorithm B creates …" and section titles such as "DEFINITION
OF A FINITE AUTOMATON" are not headings; appendix numbers ("Lemma B.1") and
"Proof of Theorem 4.1." keep their full numbers; spaced function names from
text extraction ("wots _ sign (") are accepted as algorithm names; contents
pages without dot leaders are detected.

> ⚡ **Bug: `.gitignore` silently ignored the pipeline source**
>
> A Docker-era `data/` rule matched `ml/data/`. `!ml/data/` was added before
> the first ML commit.

### Results of the full run

51 PDFs (main + other) → 12,407 blocks, 1,131 weak labels:

| Label | Count |
|---|---|
| theorem (theorem, lemma, corollary, proposition, claim) | 347 |
| proof | 252 |
| example (example, exercise, problem) | 245 |
| algorithm | 122 |
| definition | 114 |
| other (remark, note) | 46 |
| notation | 5 |

- NIST algorithms found: FIPS 203 21/21, FIPS 204 49/49, FIPS 205 23/25.
- Word order: 5.6% of blocks with 12+ words fall below 0.8 agreement with the
  raw text, mostly diagram-heavy slides and a few two-column papers.
- Label audit: 28 of 30 randomly sampled labels correct (one heading-only
  block, one lemma merged with an inline "PROOF").
- Sipser and the MA3204 slides hold 64% of the weak labels; 10 groups have
  none.

### Testing

- `python -m pytest ml/tests`: 68 passed.
- Frontend suite unchanged: 185 tests in 31 files.

**Git checkpoint:** `a11f5a9`.

### ML1.4.1: Grouped split proposal

**Date:** October 6, 2026

**Objective:** reserve independent sources for evaluation before sampling hand
labels or training a model. This deliverable is implemented and tested; the
split is still a proposal pending the user's decision.

### Files created / modified

**Data plumbing**

- `ml/data/make_splits.py` — validates manifest/extraction agreement, reserves
  seven coverage groups, then fills three places using a seeded shuffle of
  sorted eligible sources. Writes group membership and aggregate counts.
- `ml/splits.json` — seed `20261006`, status `proposed`, train/test/excluded
  memberships, per-group and per-split counts, and an explicit coverage warning.
  Contains filenames and numbers, no extracted PDF text.

**Tests and documentation**

- `ml/tests/test_make_splits.py` — 14 cases for disjoint and exhaustive source
  membership, multiple files sharing a source, input-order-independent
  reproducibility, coverage warnings, invalid extraction inputs and agreement
  between the generated proposal and the local full extraction. The last case
  skips on checkouts without the private extraction.
- `ml/README.md` — command, selection policy, overwrite protection, review/freeze
  procedure and evaluation limitations.
- `docs/IMPLEMENTATION_PHASES.md` — records the split as implemented but awaiting
  freeze; ML1 acceptance remains open.
- `docs/implementation_log.md` — this entry and refreshed ML status.

### Proposed membership and counts

| Split | Groups | PDFs | Blocks | Weak-labelled |
|---|---:|---:|---:|---:|
| Train, including future development folds | 22 | 38 | 9,009 | 923 |
| Test, proposed | 10 | 13 | 3,398 | 208 |
| Excluded, scan-only | 5 | 6 | 0 | 0 |

| Proposed test group | PDFs | Blocks | Weak-labelled |
|---|---:|---:|---:|
| arxiv-boussard-identifiability | 1 | 252 | 39 |
| arxiv-resende-recirc | 1 | 395 | 13 |
| atangana-offline-cbdc | 2 | 1,184 | 26 |
| bayes-sampling | 1 | 169 | 6 |
| boneh-franklin | 1 | 205 | 31 |
| data-licence | 1 | 25 | 0 |
| design-brief | 1 | 29 | 0 |
| fte-guidelines | 1 | 37 | 0 |
| nist-fips | 3 | 897 | 93 |
| rafiee-cbdc-pki | 1 | 205 | 0 |

Train retains all remaining eligible groups, including Sipser and all eleven
MA3204 decks. Excluded groups: Burton, Chong-Zak, MA401 exam, PQC gateways and
QR banking security. No source is split by file or block.

> ⚡ **Plan conflict / pending decision: no eligible test textbook**
>
> The handoff asks for a test textbook while reserving Sipser for train.
> Sipser is the only eligible textbook; Burton and Chong-Zak are scan-slice.
> All other requested coverage is present: slides, two arXiv maths/statistics
> sources, an older paper, NIST, payments/systems and non-maths sources.
>
> **Reasoning:** moving Sipser would violate the explicit train reservation;
> using a scan-only book would change ML1's native-text scope. The proposal
> records the gap rather than claiming full coverage. The user must accept
> the limitation or add an eligible textbook before freezing the test set.

> ⚡ **Design Decision: explicit coverage plus seeded spare places**
>
> Seven groups are selected for interpretable source coverage; three additional
> groups come from a seeded shuffle, without optimising model results. This is
> a constrained source holdout, not a representative random sample of all PDFs.
>
> **Reasoning:** the dataset is small and heterogeneous. A completely random
> split can omit required document types. Source grouping prevents template
> leakage; train includes later grouped development folds rather than a separate
> development set chosen during ML1.

Test label counts: definition 4, theorem 47, proof 27, example 6, notation 4,
algorithm 114, other 6; 3,190 blocks remain unlabelled. Train counts: definition
110, theorem 300, proof 225, example 239, notation 1, algorithm 8, other 40;
8,086 blocks remain unlabelled. NIST contributes most test algorithms, leaving
only eight heading-labelled algorithms in train. The split meets the 60-label
minimum but does not guarantee strong per-class estimates; four weak definitions
are especially sparse. Independent hand labels, including prose definitions,
remain necessary. No classifier or retrieval score was used to choose groups.

> ⚡ **Design Decision: refuse routine overwrite of the split**
>
> The CLI opens output in exclusive-create mode. A second run cannot silently
> replace a reviewed or frozen test set. It also rejects incomplete extractions,
> duplicate files/blocks, unknown labels, manifest disagreement and mixed
> eligible/scan-only groups.
>
> **Reasoning:** a reproducible seed alone does not prevent later dataset edits
> from changing membership. Review proposals can use a different output path;
> the accepted artifact must remain fixed for subsequent evaluation.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **82 passed**, including
  14 new split cases. Cache writing is disabled because the inherited local
  `.pytest_cache` directory is inaccessible.
- Full extraction reconciliation: all 51 eligible PDFs represented; 12,407
  blocks and 1,131 weak labels conserved across train/test. Excluded PDFs
  contribute zero blocks.
- CLI rerun against the existing proposal: refused with `FileExistsError`;
  output bytes unchanged. `git diff --check` reports only three pre-existing
  trailing-whitespace lines in this log's header; those were preserved.
- Frontend files were untouched; frontend checks were not rerun. Existing
  frontend green results below are earlier checkpoints, not fresh verification.
- No UI check is required for this script. User review of the coverage gap and
  proposed membership is pending. No new bug was discovered by this test run.

**Git checkpoint:** not committed (user has not requested a commit); base
`a11f5a9` — `feat(ml): PDF block extraction with weak heading labels`.

**Remaining in ML1:** accept/freeze the split, then hand-labelling tooling and
300 independent test labels, evaluation-question format and 200 user questions,
and the current retrieval baseline with document-bootstrap intervals.

---

### ML1.4.1 follow-up: independent textbook and revised proposal

**Date:** October 6, 2026

**Objective:** resolve the missing test textbook identified during split review,
as requested by the user, and improve algorithm coverage in train before freeze.

### Files created / modified

**Dataset and extraction**

- `Test PDFs/Levin_Discrete_Mathematics_3rd_ed.pdf` — downloaded from the author's
  website; local, Git-ignored. Oscar Levin, *Discrete Mathematics: An Open
  Introduction*, third edition, fifth printing (January 7, 2021), CC BY-SA 4.0.
- `Test PDFs/manifest.csv` — adds source group `levin-discrete`, category
  `textbook`, use `main`, 414 pages and 214 extracted weak-labelled blocks.
  Records author, edition, licence and download URL.
- `ml/out/levin/` — ignored extraction: 1,830 blocks, report and three overlay
  images. Original `ml/out/full/` is preserved; the combined corpus is now
  52 eligible PDFs, 14,237 blocks and 1,345 weak labels. Manifest totals:
  58 PDFs, 38 source groups (48 main, 4 other, 6 scan-slice).

**Split plumbing and verification**

- `ml/data/make_splits.py` — reserves Levin for test and Atangana for train;
  reads multiple extraction JSONLs and requires actual test textbook coverage.
- `ml/splits.json` — replaces the unfrozen proposal with the revised membership,
  per-source statistics and empty coverage warnings. Status stays `proposed`.
- `ml/tests/test_make_splits.py` — updates textbook expectations and adds two
  cases: missing textbook rejection and loading multiple extraction files.
  There are now 16 split cases and 84 ML tests total.
- `ml/README.md` — reproducible download/extraction provenance, PDF hash,
  updated split policy and instructions for separate or combined extraction files.
- `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md` — current corpus,
  revised proposal, checks and limitations. Earlier proposal entries remain as history.

Source: [author's third-edition page](https://discrete.openmathbooks.org/dmoi3.html).
Download: https://discrete.openmathbooks.org/pdfs/dmoi3-tablet.pdf
SHA-256: `9baf67f2ec90cf5020430bc502aa5aacad1cf482df47b1bb7495c02d3c9bf99e`.
Licence confirmed both on the author page and PDF copyright page. The local PDF
has extractable text on 410 of 414 pages; 398 pages contain over 100 characters.
A rendered set-notation page was inspected for layout; this was document
inspection, not browser/UI testing. Extraction removed 51 furniture lines and
identified three contents pages; no user annotations were present.

> ⚡ **Design Decision: independent openly licensed textbook**
>
> Levin covers sets, functions, counting, logic, proofs and graph theory, giving
> the test corpus textbook-style prose and boxed concepts from an independent
> author/template. The third edition's explicit CC BY-SA 4.0 licence and direct
> author-hosted PDF make provenance reproducible. The PDF remains ignored by Git.
>
> **Reasoning:** the earlier source constraints were impossible with only Sipser
> eligible. Adding this source closes the coverage gap without moving Sipser,
> introducing OCR or splitting a book between train and test.

> ⚡ **Design Decision: retain Atangana's source in train**
>
> The earlier random spare place put its thesis/paper group in test. Reserving
> that entire source for train increases heading-labelled training algorithms
> from eight to 26. All three NIST standards still stay together in test.
>
> **Reasoning:** this is pre-freeze dataset coverage, not a change selected from
> model performance. Class balance remains imperfect. Adding the textbook and
> train reservation also changes the seeded spare places; memberships are
> explicitly re-presented for review rather than silently called frozen.

### Revised proposal

| Split | Groups | PDFs | Blocks | Weak-labelled |
|---|---:|---:|---:|---:|
| Train/dev | 23 | 40 | 10,010 | 885 |
| Test, proposed | 10 | 12 | 4,227 | 460 |
| Excluded scans | 5 | 6 | 0 | 0 |

Test groups: `arxiv-boussard-identifiability`, `arxiv-huang-resolving`,
`arxiv-resende-recirc`, `arxiv-wang-tuza`, `bayes-sampling`, `boneh-franklin`,
`design-brief`, `levin-discrete`, `nist-fips`, `rafiee-cbdc-pki`.
Compared with the earlier proposal, Atangana, data-licence and FTE guidelines
move to train; Levin, Huang and Wang-Tuza enter test. Train retains Sipser and
MA3204. Excluded sources are unchanged.

| Weak label | Train | Test |
|---|---:|---:|
| definition | 109 | 5 |
| theorem | 271 | 87 |
| proof | 194 | 112 |
| example | 239 | 150 |
| notation | 4 | 2 |
| algorithm | 26 | 96 |
| other | 42 | 8 |

Train has 9,125 unlabelled blocks; test has 3,767. Levin contributes 144 examples,
54 proofs, 11 theorem-type blocks, four remarks/notes and one notation block;
1,616 blocks remain unlabelled.

> ⚡ **Observed limitation: textbook definitions use named boxes**
>
> The textbook supplies no detected literal Definition headings. A simple
> phrase screen finds 111 unlabelled blocks containing `is called`, `we say`,
> `define` or `denote`; these are candidates, not 111 verified definitions.
>
> **Reasoning:** the classifier's purpose includes definitions expressed as
> prose. Changing weak-label rules on the held-out source would obscure that
> evaluation. Keep labels unchanged and obtain independent human labels in
> ML1.4.2; five weak test definitions alone are insufficient for a strong recall
> estimate. No test labels or model metrics were used here.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **84 passed**.
  The first attempt passed 83 but encountered a permission error setting up
  pytest's temporary-directory fixture. The approved rerun outside the sandbox
  passed all 84; this was an environment failure, not a product bug.
- Proposal equals recomputation from manifest plus both extraction files;
  duplicates and source disagreement are rejected. All eligible PDFs are
  represented and counts conserve all 14,237 blocks / 1,345 labels.
- Git ignore check confirms both the downloaded PDF and extraction are ignored.
- Frontend untouched; no frontend checks rerun. No UI manual check required.
- User review/freeze of the revised groups remains pending; ML1.4.2 has not begun.

**Git checkpoint:** not committed (no commit requested); base `a11f5a9` —
`feat(ml): PDF block extraction with weak heading labels`.

---

### ML1.4.1 acceptance: split frozen

**Date:** October 6, 2026

**Objective:** record the user's explicit acceptance: "Accept and freeze the
revised split." ML1.4.1 is now complete; the rest of ML1 remains open.

### Files created / modified

- `ml/splits.json` — changes status to `frozen`, adds `accepted_on: 2026-10-06`
  and the user's confirmation. All groups, counts and seed remain identical
  to the revised proposal. Train/dev: 23 groups, 40 PDFs, 10,010 blocks and
  885 weak labels; test: 10 groups, 12 PDFs, 4,227 blocks and 460 weak labels;
  excluded: five groups, six scan PDFs.
- `ml/tests/test_make_splits.py` — validates frozen acceptance metadata and
  compares dataset content with recomputation separately from lifecycle metadata.
- `ml/README.md` — records acceptance and the rule that model tuning uses only
  train/development sources. The generator continues to create proposals and
  refuse overwrite; later consumers must use the frozen artifact.
- `docs/IMPLEMENTATION_PHASES.md` — marks grouped-split deliverable complete.
- `docs/implementation_log.md` — acceptance entry and updated current-state tail.

The user accepts the documented limitations: five heading-labelled test
definitions and 26 training algorithms versus 96 test algorithms. These remain
limitations, not reasons to change test membership after inspecting model scores.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **84 passed**.
- Before/after comparison confirms that only lifecycle/acceptance metadata
  changed in the split artifact; memberships and all counts are unchanged.
- No frontend files changed; no frontend checks or UI manual checks required.

**Git checkpoint:** not committed (no commit requested); base `a11f5a9` —
`feat(ml): PDF block extraction with weak heading labels`.

**Next:** ML1.4.2 hand-labelling sample and offline labelling page. Implementation
of that deliverable has not started. ML1 is not yet complete.

---

### ML1.4.2: Independent sample and offline hand-labelling page

**Date:** October 6, 2026

**Objective:** prepare 300 held-out blocks for independent human labels and an
offline interface to record them. Tooling is implemented and non-UI checks pass;
manual page acceptance and the 300 human labels remain pending.

### Files created / modified

**Data plumbing**

- `ml/data/sample_for_labelling.py` — deterministic selection from frozen test
  groups only. Filters short blocks, furniture flags, TOC entries and inferred
  TOC pages; stratifies weak-labelled, definition-like prose and other unlabelled
  blocks; cycles source queues to reduce domination by a large PDF. Exports only
  `block_id`, `file`, `page`, `text` and refuses to overwrite an existing sample.
- `ml/labels/to_label.jsonl` — generated local sample, 300 unique blocks,
  Git-ignored. No weak label, heading evidence or stratum fields.
- `ml/out/labelling_sample_report.json` — ignored numeric sampling audit:
  seed, eligibility, selected strata, group counts and weak-class counts.
- `.gitignore` — ignores `ml/labels/*.jsonl`, including human exports.

**Offline interface**

- `ml/labels/label.html` — one vanilla HTML/CSS/JS file opened directly from
  disk. File picker, one block at a time, physical PDF page, seven label buttons
  and numeric shortcuts, skip/back/next, progress counts, label guide,
  localStorage autosave, export and backup import. No server/build/runtime
  dependencies, network requests or external fonts. Content Security Policy
  blocks network connections; document text is inserted through `textContent`.

**Tests and documentation**

- `ml/tests/test_sampling.py` — eight cases for exact size, hidden labels,
  deterministic order/seed, source/filter exclusions, TOC page context, shortage
  backfill, unfrozen input, duplicate IDs and insufficient data.
- `ml/tests/label_session.test.cjs` — seven Node cases execute the actual inline
  script in a VM without a DOM. Cover sample parsing, weak-field removal,
  malformed/empty/duplicate input, editing, skips, final-index bounds, save/restore,
  changed-dataset separation, export schema, invalid imports and atomic restore.
- `ml/README.md` — commands, enrichment caveat, label definitions/usage, browser
  storage limitations, export placement and exact manual acceptance checks.
- `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md` — tooling status
  separate from pending user labelling and browser acceptance.

### Actual sample

Seed: `20261006`. Eligible after filters: 452 weak-labelled, 362 unlabelled
prose candidates, 2,952 other unlabelled. Selected exactly 100 from each.
All ten frozen test groups occur; no train or excluded source occurs.

| Source group | Selected blocks |
|---|---:|
| arxiv-boussard-identifiability | 46 |
| arxiv-huang-resolving | 42 |
| arxiv-resende-recirc | 38 |
| arxiv-wang-tuza | 9 |
| bayes-sampling | 16 |
| boneh-franklin | 43 |
| design-brief | 10 |
| levin-discrete | 51 |
| nist-fips | 33 |
| rafiee-cbdc-pki | 12 |

The 100 weak-labelled inputs contain four weak definitions, 35 theorem-type
blocks, 30 proofs, 11 examples, two notation blocks, ten algorithms and eight
remarks/notes. These counts are a sampling audit, not gold labels. The labeller
should not consult them while assigning independent labels.

> ⚡ **Design Decision: remove automatic labels from the input itself**
>
> The page receives just text, file, physical page and block identity. Even the
> JSONL omits weak labels and sampling strata; the UI discards extra input fields.
>
> **Reasoning:** hiding a visual field alone still exposes the label when opening
> the input file. Independent hand labels must come from reading the block. The
> original text retains its heading where present; no automatic prediction is
> displayed. PDF provenance allows the user to consult context.

> ⚡ **Design Decision: equal target strata, balanced source queues**
>
> Unlabelled prose candidates are deliberately enriched to one third of the
> sample. Selection cycles sources; weak queues also distinguish class. Rare
> stratum shortages backfill from unused eligible blocks without replacement.
>
> **Reasoning:** a uniform block sample would mostly contain background and
> examples from dominant documents, yielding little evidence about prose
> definitions. This sample supports a diagnostic evaluation; its metrics must
> not be presented as population-wide accuracy. Phrase matches are candidates,
> not asserted definitions. Furniture missed upstream can still require review.

> ⚡ **Design Decision: dataset-specific progress plus export/import backups**
>
> Cache identity uses the complete ordered sample content. A compact hash is
> verified with the full signature on restore; changed datasets cannot silently
> inherit answers. Invalid cache/import data is validated before mutation.
>
> **Reasoning:** block IDs alone cannot distinguish changed text. Browser storage
> for local files may be disabled or cleared. Save failures show a warning;
> exported JSONL is a separate backup. Import is an addition to the handoff,
> providing recovery if localStorage fails. Exports include labelled rows only;
> skipped rows remain unresolved. Correcting a label replaces it without adding
> a second answer. Skipping a labelled block removes that answer.

> ⚡ **Design Decision: standalone accessible page**
>
> Local UI guidance informed visible focus, labelled inputs, 44-pixel controls,
> high-contrast text and responsive layout. An initial design-system search
> returned a commercial landing-page pattern, which was not used. A focused
> keyboard/focus search supplied relevant interaction guidance.
>
> **Reasoning:** this is an offline annotation utility. System fonts and vanilla
> code meet its purpose without adding a frontend build or dependency. The user
> performs browser interaction and visual judgement, as required by the workflow.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **92 passed** (eight new).
- `node --test ml/tests/label_session.test.cjs`: **7 passed**. Executes/imports
  the actual inline script, not just syntax checking. Does not test DOM handlers,
  file-picker wiring, browser storage, download behaviour or rendering.
- First Node attempt was blocked by sandbox worker spawning (`EPERM`); the
  approved rerun passed. No product bug was discovered by these tests.
- Generated sample audit: exactly 300 unique IDs and four permitted fields;
  all three target strata met. Both sample and hand-label paths are Git-ignored.
- Frontend application files untouched; app build/typecheck/core-boundary checks
  were not rerun. Their earlier green checkpoints are not new verification.
- **Manual checks pending:** open offline/load, keyboard and button labelling,
  back/edit, skip/revisit, reload/resume, export/import, malformed input and
  narrow-window/keyboard focus. Exact steps and expected results: `ml/README.md`.
- Human labels: **0 reported completed**. User should export after each session
  and move the downloaded file to `ml/labels/hand_labels.jsonl`. The browser
  cannot write that repository path directly without the user's file operation.

**Git checkpoint:** not committed (no commit requested); base `a11f5a9` —
`feat(ml): PDF block extraction with weak heading labels`.

**Remaining:** user manual acceptance and hand labels. Next tooling deliverable
is ML1.4.3 (evaluation-question schema and validator), on the user's go-ahead.
ML1 as a whole remains in progress; ML2 has not started.

---

### ML1.4.3: Evaluation-question format and validator

**Date:** October 6, 2026

**Objective:** define the human-authored retrieval evaluation set and validate
its evidence against native PDF text. Tooling complete; the real 200 questions
remain user work. No retrieval measurement is claimed by this phase.

### Files created / modified

**Evaluation plumbing**

- `ml/eval/__init__.py` — evaluation package, separate from extraction and models.
- `ml/eval/questions.schema.md` — JSONL fields, physical page convention,
  question types, answerability rules, own-word questions, supporting quote
  instructions and train/test restrictions. Includes one format-only negative
  example, explicitly not a verified gold item.
- `ml/eval/validate_questions.py` — read-only validator with injectable page-text
  lookup. Checks schema, unique IDs, manifest identity, frozen source partition,
  eligible native-text sources, actual PDF page bounds and supporting quote
  presence. Caches native text once per referenced PDF. Prints counts by type,
  filename, split and answerability; errors carry physical JSONL line numbers.
  An optional completeness flag checks the planned collection distribution.
- `.gitignore` — ignores `ml/eval/questions.jsonl`, because supporting evidence
  can quote private or copyrighted documents. No real question file created.

**Tests and documentation**

- `ml/tests/test_questions.py` — 24 cases: whitespace-sensitive versus
  whitespace-insensitive evidence, derived test routing, malformed fields,
  wrong group/split/file/page, duplicate pages/IDs, excluded sources,
  answerability consistency, empty input, frozen partition, missing inputs and
  a real two-page native-text PDF fixture exercising the CLI and collection gate.
- `ml/README.md` — authoring and partial/complete validation commands, evidence
  semantics, limits and pending human work.
- `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md` — tooling status
  and refreshed current-state counts. Earlier UI acceptance remains pending.

> ⚡ **Design Decision: derive split and reject conflicting supplied values**
>
> The schema adds optional `split`, absent from the handoff's sample object.
> The validator derives it from the frozen source group and rejects an incorrect
> explicit value. It does not rewrite the question file.
>
> **Reasoning:** a held-out question must never silently become training data
> because someone typed the wrong split. Reports explicitly count test items
> even when the optional field is omitted; future consumers must use the same
> frozen membership rather than trusting an arbitrary annotation.

> ⚡ **Design Decision: match evidence after removing whitespace only**
>
> A quote must occur contiguously on at least one listed physical PDF page.
> All listed pages are checked for valid bounds. Case, punctuation, hyphens and
> maths symbols are preserved; quotes spanning pages are not accepted.
>
> **Reasoning:** whitespace changes from line wrapping are harmless, whereas
> silently repairing symbols or punctuation can accept inaccurate evidence.
> Quote presence cannot establish semantic relevance or that every listed
> page answers the question. Unanswerability remains a human judgment.

> ⚡ **Design Decision: partial validation plus explicit collection gate**
>
> Default validation permits incremental work. `--require-complete` additionally
> requires 200 questions, 13–17 PDFs, 8–15 per PDF, 35–45 unanswerable and both
> train/test sources. These numerical ranges implement the plan's approximate
> “15 PDFs” and “40 unanswerable”; they are documented rather than implicit.
>
> **Reasoning:** blocking a partial collection would prevent early feedback.
> No placeholder gold questions or invented supporting quotes were created.

> ⚡ **Bug found by dependency inspection: missing PDFs bypassed OSError**
>
> PyMuPDF's `FileNotFoundError` inherits `RuntimeError`, not Python's built-in
> file error. Catching `OSError` alone would crash rather than report a bad line.
> The validator now catches the PyMuPDF-specific error; a regression case
> asserts the missing PDF becomes a line error and no valid item is emitted.
>
> **Reasoning:** missing local PDFs are expected on incomplete checkouts. This
> issue was identified during API inspection before the regression test was
> added; the test did not discover it through a failing suite run.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **116 passed**, 24 new.
- Real-corpus smoke validation used an actual native excerpt from physical
  page 43 of Levin and an empty-evidence negative-schema item for design-brief:
  two valid items, both test; one answerable, one unanswerable. These in-memory
  items were plumbing checks, not saved or asserted as a gold question set.
- CLI integration checks physical page bounds, native quote match, complete-set
  rejection, safe reports without quote text and unchanged input bytes.
- `ml/eval/questions.jsonl` does not yet exist. Therefore no user question
  collection has been validated and the 200-question acceptance remains open.
- Ignore check confirms the future real question file is excluded from Git.
- No frontend changes; previous seven JS-session tests were not rerun. No new
  UI check needed. User must manually judge question/evidence quality and
  unanswerability; ML1.4.2 page checks and human labels are still pending.

**Git checkpoint:** not committed (no commit requested); base `a11f5a9` —
`feat(ml): PDF block extraction with weak heading labels`.

**Next:** ML1.4.4, reproducing the existing retrieval baseline with document-level
bootstrap intervals. It has not started; do not mark ML1 complete.

---

### ML1.4.4: Existing retrieval baseline and document-bootstrap intervals

**Date:** October 6, 2026

**Objective:** reproduce the current retrieval mechanism in process, without
Docker or Qdrant service, and establish a measured starting point. The user
also authorised creating a question file. Five starter questions were authored
and evidence-validated; this is a smoke measurement, not the planned full set.

### Files created / modified

**Evaluation plumbing**

- `ml/eval/baseline_current_rag.py` — loads the actual legacy `chunk_spans`
  through importlib; native PyMuPDF words become page-provenanced spans. Embeds
  full-document chunks with all-MiniLM-L6-v2 on CPU, exact cosine top eight in
  the question's PDF, cross-encoder reranking, gold-page Recall@5/MRR@10 and
  separate train/test aggregate intervals. Model functions are injectable for
  deterministic tests; actual models were used in the smoke run.
- `ml/eval/stats.py` — handwritten seeded document-cluster bootstrap, 2,000
  resamples and interpolated 95% percentile bounds. Repeated files repeat all
  their questions; estimates remain question-weighted.
- `ml/eval/requirements.txt` — existing dependencies needed for offline evaluation;
  no new package installation was performed.
- `ml/eval/questions.example.jsonl` — five own-word starter questions with
  checked native-text quotes: NIST, Levin, Boneh–Franklin (test), and the Cao
  and Hashimoto papers (train). One question per file; all answerable. No claim
  of balanced or complete evaluation. Small quotations only, no private profile.
- `ml/eval/questions.jsonl` — the same five starter questions as the user-editable
  real file, created at the user's request and Git-ignored. Expand/review this
  file before using it as the 200-question gold collection.
- `ml/results/baseline_current_rag.json` — committable aggregate numbers and
  configuration only, including `example_only: true`; no question, quote,
  document text or filenames. Results from the explicit example command.

**Shared legacy mechanism**

- `local-llm/rag-api/ingest.py` — replaces eager Qdrant construction with a
  lazy reused client and moves embedder import to actual ingestion. No chunking
  functions/constants were copied, replaced or modified.

**Tests and documentation**

- `ml/tests/test_baseline.py` — eight cases for whole-file bootstrap versus
  independent-question sampling, degenerate intervals, metric cutoffs,
  stable cosine ranking/zero vectors, reranking and unanswerable exclusion,
  real native-text PDF chunking, empty candidates, invalid reranker output and
  lazy reused Qdrant construction without connecting.
- `ml/README.md` — execution/dependencies, smoke/full distinction, metrics,
  confidence intervals and differences from the running service.
- `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md` — measured status
  and pending full-data acceptance. No earlier user work was discarded.

> ⚡ **Design Decision: import existing chunking without startup services**
>
> Importing the old ingestion module eagerly constructed a Qdrant client and
> imported a service-local embedder. Client creation and embedding import now
> happen only on service use; the baseline imports the original chunk function.
>
> **Reasoning:** AST extraction or copying the chunker would disconnect the
> measurement from the implementation it measures. Lazy setup is a small
> shared-module change, verified with native-PDF and singleton-factory tests.
> Service request flow still obtains the same client; no live service test ran.

> ⚡ **Design Decision: exact search with the existing eight-candidate budget**
>
> Exact cosine substitutes for Qdrant HNSW. Queries search the named PDF's full
> chunk index, not only gold pages. Vector and reranked rankings contain at most
> eight candidates; Recall@5 uses the first five, while MRR@10 uses the full
> available ranking, so ranks nine and ten cannot score.
>
> **Reasoning:** searching ten candidates would change the current top-eight
> mechanism. Reporting MRR using only five would conceal improvements in ranks
> six through eight. The depth limitation is explicit in code, output and docs.

> ⚡ **Inherited issues observed: chunk cap and page field mismatch**
>
> The chunker appends entire paragraphs, so 800 characters is not a hard cap.
> NIST produced 93 chunks, 57 above 800 characters, maximum 3,465. Also, ingestion
> stores `page` but the old retriever reads `pageNumber`.
>
> **Reasoning:** preserve chunking to measure existing behaviour; long chunks
> may be truncated by pretrained model token limits. Offline evaluation uses
> correct chunk `page`. The live retriever mismatch remains unfixed and this
> run must not be described as validating live citations. Native word spans
> also replace OCR tokens, so the run is a mechanism baseline, not an exact
> end-to-end deployment reproduction. No model tuning followed test results.

### Validation and measured smoke results

- `python -m ml.eval.validate_questions`: **5 valid, 0 invalid**, two train,
  three test; one definition, four explanation questions; five answerable.
- The example file separately validates with the same counts.
- `--require-complete`: **correctly rejects the starter as incomplete** (five
  questions and no unanswerable items). This is an expected acceptance failure,
  not a broken validator or completed 200-question dataset.
- `python -m ml.eval.baseline_current_rag --questions ml/eval/questions.example.jsonl --local-only`:
  actual CPU inference over **746 chunks / five PDFs**, existing cached models,
  no downloads, Docker or running service needed.
- Installed runtime versions: NumPy 2.2.4, sentence-transformers 5.2.0,
  PyTorch 2.9.1, qdrant-client 1.16.2. No dependency version was changed.

| Split | Method | Recall@5 [95% interval] | MRR@10 [95% interval], 8 candidates |
|---|---|---|---|
| Train, 2 files/questions | Vector | 1.000 [1.000, 1.000] | 0.375 [0.250, 0.500] |
| Train, 2 files/questions | Vector + cross-encoder | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| Test, 3 files/questions | Vector | 0.667 [0.000, 1.000] | 0.400 [0.000, 1.000] |
| Test, 3 files/questions | Vector + cross-encoder | 0.667 [0.000, 1.000] | 0.667 [0.000, 1.000] |

These intervals resample entire files with seed `20261006`. A perfect interval
on two successful questions does not imply population certainty. The test set
is tiny, gold pages are starter evidence references, and questions were authored
for a smoke run. Results establish execution and a reproducible initial table;
they do not establish general retrieval quality or reranker superiority.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **124 passed**, eight new.
- `node ml/tests/label_session.test.cjs`: **7 passed**; rerun of existing non-UI
  session tests, no browser interaction.
- Actual cached embedding/reranking inference completed; deterministic tests
  are not a substitute for that run. No new product bug was discovered by a
  failing test; the inherited limits above were found by code/data inspection.
- Frontend unchanged; its build/typecheck/core-boundary checks not rerun.
- Manual labelling-page acceptance and 300 human labels still pending.

**Git checkpoint:** not committed (no commit requested); base `a11f5a9` —
`feat(ml): PDF block extraction with weak heading labels`.

**Remaining in ML1:** review/expand the starter to 200 questions (~40
unanswerable), obtain 300 independent block labels, accept the offline UI and
rerun the full baseline with intervals. ML1 is not complete; ML2 has not started.

---

### ML1 tooling Git checkpoint

**Date:** October 6, 2026

The user requested a commit before starting ML2. Staged only ML code, the
manifest, Git exclusions, implementation plan/log and the lazy ingestion import
change. PDF files, extracted text, real question/label JSONLs, handoff/agent files
and unrelated frontend documentation remained outside the commit.

**Git checkpoint:** `13d5106` — `feat(ml): freeze dataset split and add labelling and retrieval evaluation`.

This checkpoints ML1 tooling, not completed hand labels, full question
benchmark or manual page acceptance. The SHA is recorded in this follow-up
entry because a commit cannot contain its own final SHA.

---

## Phase ML2: Block Classifier v1 — ML2.1 Training Data Preparation

**Date:** October 6, 2026

**Objective:** prepare heading-free weak supervision and source-isolated
development folds before implementing a classifier. The user requested only
ML2.1, starting early relative to the planned October 13–19 week. No classifier
or gold evaluation was run; ML1 human-data acceptance remains pending.

### Files created / modified

**Data plumbing**

- `ml/data/prepare_training.py` — filters to frozen train sources before
  examining labels/text; never maps unlabelled to `other`. Requires heading-free
  text, drops bodies shorter than 30 characters, cycles classes to cap each
  source at 200 rows, and assigns whole groups to five development folds.
  Carries existing layout measurements without designing classifier features.
- `ml/out/ml2/train_blocks.jsonl` — ignored generated training rows: identity,
  physical page, heading-free text, weak label, category, layout values and fold.
- `ml/out/ml2/training_report.json` — ignored counts, exclusions, fold membership
  and missing-class warnings. The generator refuses to overwrite training rows.

**Tests and documentation**

- `ml/tests/test_training_data.py` — seven cases for held-out source exclusion,
  heading-free input, source cap and rare-class retention, deterministic input
  order, disjoint group folds, unlabelled/short-body exclusion, unfrozen/overlap
  rejection, missing heading-free body and duplicate block ID rejection.
- `ml/README.md` — preparation command, fold usage, vocabulary-fit restrictions,
  weak-label caveats, actual counts and pending user-written classifier work.
- `docs/IMPLEMENTATION_PHASES.md` — introduces sequential ML2 substeps. The
  original plan had no ML2.1 numbering; this step explicitly covers data plumbing.
- `docs/implementation_log.md` — checkpoint, this entry and updated current state.

### Results and limits

548 rows from 14 sources with usable labels; all 23 train sources are assigned
to folds, including nine with zero usable weak labels. Discarded: 9,125
unlabelled blocks, 73 short heading-free bodies and 264 above the source cap.

| Weak label | Training rows |
|---|---:|
| definition | 92 |
| theorem | 130 |
| proof | 123 |
| example | 131 |
| notation | 4 |
| algorithm | 26 |
| other | 42 |

Fold sizes: **200, 200, 57, 46, 45**. Sipser and MA3204 each occupy one
200-row fold, the assignment source occupies the 57-row fold, and smaller
sources share the last two. Zero-labelled groups remain assigned as sources,
not fabricated negatives. Every fold lacks at least one class; several folds
lack definitions or proofs. Notation has only four weak training examples.

> ⚡ **Design Decision: fixed source cap with within-source class cycling**
>
> Cap each source at 200 rows, selecting in seeded class cycles. Rare labels
> remain represented when their source is capped. All selection uses train data.
>
> **Reasoning:** weak labels concentrate in two sources. The cap limits absolute
> contributions, but those sources still supply 400/548 rows (73%). It is not
> equal source weighting or natural class frequency. The value is a documented
> pre-training choice, not tuned against test scores.

> ⚡ **Design Decision: heading-free input is mandatory**
>
> Missing `text_without_heading` fails validation instead of falling back to
> the full block. A short or empty body is dropped. Unlabelled is not `other`.
>
> **Reasoning:** fallback would let a classifier learn the same heading rule
> that created its training label. Assigning negatives to unlabelled prose
> would teach it to reject the definitions the project wants to discover.

> ⚡ **Design Decision: source folds before any fitted preprocessing**
>
> Whole source groups are assigned greedily by retained row count, with stable
> tie-breaking. For each future CV run, one fold is development and the others
> training; vocabulary/scalers must be fit only on those training folds.
>
> **Reasoning:** splitting large groups to make equal folds would leak templates.
> Source isolation is more important than artificial fold balance. Missing-class
> warnings are explicit; later evaluation must not pretend every fold can
> estimate every class. No test source, test label or model score was consulted.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **131 passed**, seven new.
- Preparation command executed on the actual corpus, yielding the counts above.
- No UI change or manual interaction check needed for this script. Frontend and
  JS session suites were not rerun; previous checkpoints remain historical.
- No failing test exposed a new bug. Imbalanced folds and sparse classes were
  found in the generated training audit and documented rather than concealed.
- ML1 human labels/UI acceptance and full 200-question benchmark remain pending.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next:** review ML2.1, then ML2.2 baseline contracts and the first classifier
with user ownership. No further ML2 substep has been implemented.

---

### ML2.2: First-classifier contracts and user exercise

**Date:** October 6, 2026

**Objective:** prepare the majority and heading baseline contracts plus the
first heading-free TF-IDF/logistic-regression classifier exercise. This entry
records scaffold preparation, not a completed or trained classifier.

### Files created / modified

- `ml/models/__init__.py` — user-owned classifier package.
- `ml/models/first_classifier.py` — three documented unimplemented contracts:
  `majority_label`, `heading_prediction`, `fit_tfidf_classifier`. An explicit
  `IMPLEMENTED=False` flag identifies their pending state; calls raise
  `NotImplementedError` rather than return fabricated predictions.
- `ml/models/README.md` — ordered implementation guide, starter parameters,
  train-only vocabulary rules, abstention semantics and commands for review.
- `ml/tests/test_classifier_exercise.py` — six prospective acceptance cases:
  majority/ties, invalid labels, heading abstention, pipeline predictions,
  held-out vocabulary isolation and invalid fitting inputs.
- `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md`
  — exercise status and explicit distinction between scaffold and completed model.

> ⚡ **Design Decision: preserve the user's model-code ownership**
>
> HANDOFF.md section 5 says ML2+ model/evaluation code is written by the user
> with review; assisted work may supply data plumbing. Therefore this step
> supplies contracts, instructions and checks, not model implementations.
>
> **Reasoning:** a request to continue the phase does not erase its ownership
> rule. The user starts with counting a majority class, then heading abstention,
> then a Pipeline tying TF-IDF fitting to training data. No scores or trained
> artifacts can be claimed until these functions are implemented and checked.

> ⚡ **Design Decision: explicit pending tests, no fabricated green model gate**
>
> The six exercise cases skip with a named unimplemented reason while the flag
> is false. Setting it true activates all assertions. Their purpose is to test
> future user implementation; current tooling success is not classifier success.
>
> **Reasoning:** scoring a heading baseline against its own generated labels
> would be circular; scoring a placeholder classifier would be misleading.
> Independent hand labels and later grouped evaluation remain required.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **131 passed, 6 skipped**.
  All skips are the pending classifier contracts, not environment failures.
- Python imports of the new model scaffold succeed through test collection.
- No model fitted, no CV/evaluation run, no test source inspected, no UI change.
- scikit-learn 1.6.1 is already installed; no dependency installation performed.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Remaining:** user implements the three functions and activates/passes six
tests; then review before grouped evaluation. ML2.2 is not complete.

---

### ML2.2 follow-up: Baselines and first classifier implemented

**Date:** October 6, 2026

**Objective:** complete the model functions after the user explicitly asked,
"Can you write it for me?" This supersedes the earlier user-implementation
restriction for these functions. Scope remains ML2.2, not grouped evaluation.

### Files created / modified

- `ml/models/first_classifier.py` — implements validated majority-class counting
  with alphabetical ties; heading baseline returning a known label or abstaining
  with `None`; heading-free TF-IDF plus logistic-regression fitting. Every call
  creates a fresh Pipeline. Rejects invalid label containers, unknown classes,
  missing/empty text, mismatched lengths and single-class fitting data.
- `ml/tests/test_classifier_exercise.py` — removes the skip gate, strengthens
  the prediction test to require actual toy-example learning, and adds malformed
  label-container and independent-vocabulary cases. Ten active tests now pass.
- `ml/models/requirements.txt` — records scikit-learn 1.6.1, already installed;
  no package installation was performed.
- `ml/models/README.md`, `ml/README.md` — replaces pending exercise instructions
  with actual mechanism, parameters, checks and limits.
- `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md` — implementation
  completion, authorization and refreshed current-state tail.

### Model mechanism

The vectoriser learns word and bigram features (`ngram_range=(1, 2)`,
`min_df=1`) from supplied training text. Logistic regression uses `C=1.0`,
`max_iter=1000`, `random_state=20261006` and default class weighting. Vocabulary
fit and classifier fit are tied together by a Pipeline; prediction only
transforms new text. Model features come from heading-free input prepared in
ML2.1; callers must retain that contract rather than passing original headings.

> ⚡ **Design Decision: straightforward fixed baseline before tuning**
>
> Standard scikit-learn algorithms implement TF-IDF and logistic regression.
> Parameters match the earlier scaffold and are fixed without reading test
> labels or selecting settings against performance. Counting and input
> validation remain explicit and small.
>
> **Reasoning:** this establishes a readable baseline before Naive Bayes,
> LightGBM or feature experiments. Class balancing, custom feature design and
> hyperparameter search belong to later comparisons, not this implementation.

> ⚡ **Design Decision: no persistent model or claimed quality score**
>
> A disposable training-only fit used the 548 prepared rows: seven classes,
> 15,169 vocabulary features. The majority label is `example` (131 rows).
> No training accuracy, grouped development score or test performance is reported.
>
> **Reasoning:** successfully fitting verifies data/model compatibility, not
> generalisation. Later CV must instantiate a fresh model for each fold, fitting
> its vocabulary only on the other four. Independent labels remain required
> for final quality acceptance.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **141 passed, no skips**.
- All six previously pending tests now execute; four additional cases check
  malformed containers and separate vocabularies across fitting calls.
- Toy texts are correctly classified; a held-out-only token does not enter
  vocabulary during prediction. Actual training-data smoke fit completed.
- No new failing-test bug discovered. No UI, held-out evaluation or service
  interaction; previous JS/frontend checkpoints were not rerun.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next:** grouped train/development evaluation as a separate ML2 step. ML2.2
implementation is complete, but ML2 phase acceptance remains open.

---

### ML2.3: Grouped train/development evaluation

**Date:** October 6, 2026

**Objective:** measure the first classifier on unseen training-source groups,
comparing it with a fold-specific majority predictor. Only the 548 prepared
train rows were used. This is development against weak supervision, not final
gold evaluation. The user explicitly requested this evaluation implementation.

### Files created / modified

- `ml/eval/classifier_cv.py` — validates train membership and whole-source fold
  identity, fits a fresh TF-IDF/logistic model on four folds and predicts the
  fifth. Repeats five times, recording exactly one prediction per row. Computes
  majority baselines from each run's training portion. Handwritten confusion
  matrix, per-class precision/recall/F1, accuracy and fixed-seven-class macro F1;
  file-cluster bootstrap recomputes metrics over 2,000 seeded resamples.
- `ml/results/classifier_cv.json` — numerical aggregate result, label-axis order,
  counts, fold gaps and intervals; no source text, row identity or filenames.
- `ml/out/ml2/cv_predictions.jsonl` — ignored audit of row identity, filename,
  fold, weak gold and predictions; no source text. No model weights persisted.
- `ml/tests/test_classifier_cv.py` — eight cases for hand-checked metrics,
  fit/predict isolation, one prediction per row, held-out rejection,
  cross-fold source/duplicate/missing-fold rejection, deterministic bootstrap
  and empty-bootstrap rejection.
- `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`, `docs/implementation_log.md`
  — commands, measured development state, output semantics and limitations.

> ⚡ **Design Decision: fresh vocabulary and majority per fold**
>
> Each run fits only the four training folds, including its vocabulary and
> most frequent label. Development rows never enter feature fitting. Every
> source stays in one fold; frozen test groups are rejected as inputs.
>
> **Reasoning:** fitting one vocabulary or selecting one majority from all
> rows would allow development information into the baseline. Model settings
> remain those fixed in ML2.2; no search or adjustment followed the results.

> ⚡ **Design Decision: aggregate metrics with explicit rare-class gaps**
>
> Macro F1 averages all seven classes, undefined ratios use zero, and support
> and missing-class lists are explicit. Confusion rows are gold, columns are
> predicted, both using `label_order`. Bootstrap resamples 27 complete files,
> then recomputes metrics; file clustering does not fully account for correlation
> between related PDFs within a source group.
>
> **Reasoning:** unequal development folds and absent classes make an unweighted
> mean of fold scores misleading. Aggregate out-of-fold predictions describe
> this enriched/capped weak-labelled dataset. Intervals do not correct weak-label
> error or establish performance on prose definitions. The heading predictor is
> deliberately not scored against its own labels; it needs independent gold.

### Actual development results

| Method | Accuracy [95% interval] | Macro F1 [95% interval] |
|---|---|---|
| Fold-specific majority | 0.2153 [0.1536, 0.2475] | 0.0702 [0.0505, 0.0869] |
| TF-IDF + logistic | 0.4033 [0.3369, 0.4846] | 0.2362 [0.1925, 0.2967] |

Logistic class metrics:

| Class | Precision | Recall | F1 | Weak support |
|---|---:|---:|---:|---:|
| definition | 0.8571 | 0.1957 | 0.3186 | 92 |
| theorem | 0.3713 | 0.4769 | 0.4175 | 130 |
| proof | 0.3687 | 0.6504 | 0.4706 | 123 |
| example | 0.4296 | 0.4656 | 0.4469 | 131 |
| notation | 0 | 0 | 0 | 4 |
| algorithm | 0 | 0 | 0 | 26 |
| other | 0 | 0 | 0 | 42 |

The model beats the majority predictor here, but misses most weak definitions
and fails three classes. All five folds lack some development classes. This
is an initial development result, not a usable concept extractor or a claim of
prose-definition recall. No test-set inspection or model tuning was performed.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **149 passed, no skips**.
- Actual five-fold run: 548 out-of-fold predictions from 27 training PDFs;
  numeric report and ignored row audit written. Real sklearn fitting succeeded.
- Deterministic test fitters assert fit/dev texts are disjoint in every run.
- Frozen groups were unchanged; no human-labelled test file was loaded.
- No UI/frontend changes or rerun. No new bug was discovered by a failing test.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Remaining:** later model comparisons and independent human-label acceptance.
ML1's 300 labels/UI acceptance and full 200-question baseline are still pending.
No later ML2 model was implemented in this step.

---

### ML2.4: Multinomial Naive Bayes comparison

**Date:** October 6, 2026

**Objective:** compare multinomial Naive Bayes with logistic regression on the
same 548 heading-free rows and five source-isolated train/development folds.
The user authorised this step; no gold test or later model was evaluated.

### Files created / modified

- `ml/models/first_classifier.py` — adds `fit_tfidf_naive_bayes`; shares input
  validation and fresh TF-IDF fitting through `_fit_tfidf`. Logistic settings
  stay unchanged. NB uses `MultinomialNB(alpha=1.0)` and empirical class priors.
- `ml/eval/classifier_cv.py` — allows multiple fitters on each fold. The optional
  `--with-naive-bayes` compares both on identical train/development rows and
  identical file-bootstrap resamples. Default logistic-only mode remains.
- `ml/results/classifier_nb_cv.json` — aggregate majority/logistic/NB metrics,
  per-class precision/recall/F1, confusion matrices, F1/accuracy/macro intervals
  and fold warnings. The ML2.3 result file is preserved.
- `ml/out/ml2/cv_nb_predictions.jsonl` — ignored row audit with both predictions;
  no source text or persistent model. Original audit remains separate.
- `ml/tests/test_naive_bayes.py` — eight cases for toy learning, fixed alpha,
  prediction vocabulary immutability, independent fit vocabularies, invalid
  inputs and identical train/dev exposure for both injected fitters.
- `ml/README.md`, `ml/models/README.md`, `docs/IMPLEMENTATION_PHASES.md`,
  `docs/implementation_log.md` — command, comparison, fixed settings and limitations.

> ⚡ **Design Decision: same representation before introducing layout**
>
> Both models use word/bigram TF-IDF with min_df=1; only the classifier changes.
> Each fit has its own vocabulary learned from the same training portion.
> NB receives nonnegative TF-IDF weights with fixed Laplace smoothing alpha=1.
>
> **Reasoning:** this isolates the model comparison. TF-IDF is nonnegative and
> usable with multinomial NB, although not literal counts. Representation,
> smoothing and class-prior experiments are not performed in this step.

> ⚡ **Design Decision: preserve earlier reports and avoid winner claims**
>
> Comparison has its own report and audit. Original logistic metrics, intervals
> and fold metadata were checked for exact equality with the new run.
>
> **Reasoning:** the small macro F1 change and lower definition recall do not
> justify choosing NB as the extractor. These are weak-label development
> estimates; no paired statistical superiority test or gold evaluation is claimed.

### Results

| Method | Accuracy [95% interval] | Macro F1 [95% interval] |
|---|---|---|
| Majority | 0.2153 [0.1536, 0.2475] | 0.0702 [0.0505, 0.0869] |
| Logistic | 0.4033 [0.3369, 0.4846] | 0.2362 [0.1925, 0.2967] |
| Multinomial NB | 0.4215 [0.3439, 0.4985] | 0.2373 [0.1918, 0.3030] |

NB class scores:

| Class | Precision | Recall | F1 | Weak support |
|---|---:|---:|---:|---:|
| definition | 0.8000 | 0.1304 | 0.2243 | 92 |
| theorem | 0.3467 | 0.6000 | 0.4394 | 130 |
| proof | 0.4179 | 0.6829 | 0.5185 | 123 |
| example | 0.5327 | 0.4351 | 0.4790 | 131 |
| notation | 0 | 0 | 0 | 4 |
| algorithm | 0 | 0 | 0 | 26 |
| other | 0 | 0 | 0 | 42 |

Accuracy rises but macro F1 changes by about 0.001. Definition recall falls
from logistic's 0.1957 to 0.1304; notation/algorithm/other still fail. These
models are not yet reliable concept extractors. The same sparse-class/fold
limitations and file-level interval caveats from ML2.3 remain.

### Testing

- `python -m pytest ml/tests -p no:cacheprovider`: **157 passed, no skips**.
- Actual five-fold comparison completed with 548 predictions per learned
  method across 27 train PDFs. Both use the same training and development rows.
- Earlier logistic report/fold equality confirmed; no test groups or hand
  labels loaded, no hyperparameter tuning, no new dependencies installed.
- No new product bug found by a failing test. No UI/frontend change or checks.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next goal to achieve:** separately implement a LightGBM/layout-feature
comparison on these same train-only source folds, exposing definition recall
and rare-class failures. Independent human-label acceptance remains pending.

---

## Phase ML2.5: Layout-only LightGBM Comparison

**Date:** October 6, 2026
**Objective:** compare a fixed layout-feature classifier with the existing text
models on exactly the same train-only source folds, without touching gold data.

### Model and feature boundary

The model accepts five existing numeric measurements: bold ratio, relative font
size, relative indent, maths-character ratio and relative gap above. Document
category is one-hot encoded. The allowlist excludes text, filenames, source IDs,
page numbers, labels and additional feature keys. Missing/non-finite measurements,
boolean measurements, malformed categories and invalid labels are rejected.

Each fold fits a new DictVectorizer and native LightGBM multiclass booster.
Category vocabulary is learned from training rows only; an unseen development
category contributes zero category columns without refitting. Class strings map
to sorted training-only numeric IDs. A class missing from that training fold
cannot be predicted. The settings were fixed before observing the scores:
100 rounds, learning rate 0.05, 15 leaves, minimum 10 rows per leaf, two threads,
seed 20261006, deterministic column-wise training. No class weighting or tuning.

⚡ **Design Decision — layout only, not a text/layout ensemble.**

**Reasoning:** the roadmap asks for LightGBM with layout features. Adding text
now would confound whether layout alone transfers between source groups. The
comparison is deliberately narrower; it does not test a combined model.

⚡ **Design Decision — specialized learner in a local environment.**

**Reasoning:** LightGBM was absent. An ignored `.venv-ml` reuses installed
scientific packages and adds only LightGBM 4.7.0, leaving global packages alone.
The first sandboxed virtual-environment setup failed at ensurepip; approved
execution succeeded. Native LightGBM avoids a redundant sklearn estimator
wrapper; the small adapter exposes only prediction and train-fitted encoding.
Verbosity -1 removes repetitive tree informational messages, not Python warnings
or input errors. No learner was hand-written and no trained artifact was saved.

### Same-fold comparison and measured results

The runner adds row-based fitters alongside text-based fitters. Both receive the
same source-isolated train/development partitions. The layout option writes a
new aggregate report and ignored row audit, preserving the two earlier reports.
There are 548 out-of-fold predictions per model across 27 training PDFs.

| Method | Accuracy | Accuracy 95% file CI | Macro F1 | Macro F1 95% file CI |
|---|---:|---|---:|---|
| Majority | 0.2153 | [0.1536, 0.2475] | 0.0702 | [0.0505, 0.0869] |
| TF-IDF logistic | 0.4033 | [0.3369, 0.4846] | 0.2362 | [0.1925, 0.2967] |
| TF-IDF NB | 0.4215 | [0.3439, 0.4985] | 0.2373 | [0.1918, 0.3030] |
| Layout LightGBM | 0.2974 | [0.1970, 0.3509] | 0.1646 | [0.0913, 0.1885] |

| Layout class | Precision | Recall | F1 | Weak support |
|---|---:|---:|---:|---:|
| definition | 0 | 0 | 0 | 92 |
| theorem | 0.4433 | 0.3308 | 0.3789 | 130 |
| proof | 0.5000 | 0.4715 | 0.4854 | 123 |
| example | 0.2067 | 0.4733 | 0.2877 | 131 |
| notation | 0 | 0 | 0 | 4 |
| algorithm | 0 | 0 | 0 | 26 |
| other | 0 | 0 | 0 | 42 |

Nineteen predicted definitions are all incorrect against the weak labels.
Layout is worse on aggregate than either text model and is not selected for
production. Why it fails is not established by these scores; source/layout
variation and weak-label noise require an audit, not an invented explanation.
Intervals reuse the same 2,000 whole-file draws and fixed seven-class macro
denominator. They do not fully capture shared-source correlation. No significance
test, prose-definition measurement or independent gold evaluation is claimed.

### Files created / modified

- **Models (created):** `ml/models/layout_classifier.py` — feature allowlist,
  finite-input validation, train-fitted category encoding and boosted-tree adapter.
- **Models (modified):** `ml/models/requirements.txt` — pins LightGBM 4.7.0;
  `ml/models/README.md` — settings, input boundary and dependency rationale.
- **Evaluation (modified):** `ml/eval/classifier_cv.py` — row fitter support,
  optional layout comparison, model configuration and independent output paths.
- **Tests (created):** `ml/tests/test_layout_classifier.py` — 17 cases covering
  forbidden fields, malformed/finite inputs, class validation, toy learning,
  reproducibility, unseen categories, source-fold equivalence and method collisions.
- **Results (created):** `ml/results/classifier_layout_cv.json` — numerical scores,
  per-class metrics, confusion matrices, intervals, fold counts and fixed settings.
- **Local outputs (ignored):** `ml/out/ml2/cv_layout_predictions.jsonl` — row IDs,
  file identities, weak labels and out-of-fold predictions; no text. `.venv-ml/`
  holds the dependency environment and is also ignored.
- **Documentation / hygiene (modified):** `.gitignore` excludes `.venv-ml/`;
  `ml/README.md` gives reproduction commands; `docs/IMPLEMENTATION_PHASES.md`
  records ML2.5 and the next audit; this log records decisions and current state.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`:
  **174 passed, no skips**, including 17 new layout-classifier cases.
- Actual five-fold run completed. Earlier text-model summaries and fold metadata
  exactly equal ML2.4; no frozen-test or hand-label data loaded.
- Seven non-UI labelling-session JavaScript tests passed.
- `npx tsc -b`, `npm test -- --run` (185 tests / 31 files),
  `npx eslint src/core --max-warnings 0` and `npm run build`: all green.
  Existing non-fatal build warnings remain, including outdated Browserslist data,
  PDF.js image URLs, mixed import modes and large chunks. No UI was operated.
- Git ignore checks confirm both the local environment and row audit are excluded.
  No new product bug was exposed by a failing test. Unrelated frontend edits kept.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next goal to achieve:** ML2.6 — a reproducible 50-mistake development audit.
Independent human labels, gold per-class intervals and prose-definition recall
remain required for final ML2 acceptance. No commit requested for this substep.

---

## Phase ML2.6: Development Error Audit and Controlled Text Improvements

**Date:** October 6, 2026
**Objective:** review 50 train-development mistakes and, at the user's request,
test a small improvement to the low classifier scores without touching test data.

### Reproducible audit of 50 mistakes

The original logistic classifier makes 327 errors against 548 weak labels.
`error_audit.py` joins the existing out-of-fold predictions to training rows by
block ID. It rejects held-out sources, duplicate/unknown IDs, mismatched labels,
file/fold identities and invalid predictions. A seeded round-robin sample over
weak-class/fold buckets covers 50 unique errors and all seven classes/five folds.
This selection is for diagnostic coverage; its proportions are not error prevalence.

All 50 full extracted texts were inspected and given local provisional notes:

| Primary diagnostic reason | Cases |
|---|---:|
| Semantic/class-role confusion | 19 |
| Incomplete extracted statement or argument | 11 |
| Surrounding context required | 6 |
| Sparse cross-source training support | 5 |
| Suspect weak-label association | 4 |
| More than one role in the same block | 3 |
| PDF text ordering/footer noise | 2 |

Notes are bound to a SHA-256 digest of the ordered sample IDs; stale/incomplete
or invalid notes are rejected before any row is modified. Neither notes nor
diagnoses change training labels. All source text, file/page references and
per-case notes remain in ignored local outputs. The aggregate summary is public-safe.

⚡ **Design Decision — provisional text review, not new gold labels.**

**Reasoning:** a timing-results table is visibly not pseudocode, but deciding
whether its algorithm label came from a caption, misplaced heading or merged
block requires the original page. Two such table cases were found. Another
theorem block explicitly includes its proof; several statements stop before
their equations or conclusions. These are evidence for a data-quality repair,
not authority to silently relabel or claim independently verified truth.
No PDF-page/UI acceptance or human review is claimed here.

### Two fixed improvement candidates

⚡ **Plan Deviation — the user added an accuracy-improvement request.**

**Reasoning:** ML2.6 was proposed as an audit only. The user asked to try to
raise accuracy, so this substep adds two bounded, documented candidates rather
than starting later roadmap phases or an unrestricted parameter search.

1. **Balanced word/bigram logistic:** the original representation, C=1,
   max_iter=1000 and seed remain unchanged; only training-derived inverse
   class-frequency weighting is added.
2. **Balanced word-plus-character logistic:** the same weighted learner adds
   within-word character 3–5-grams, min_df=2, alongside word/bigrams through
   an equal-weight FeatureUnion. This tests whether fragments transfer better
   across PDF sources; it cannot reconstruct missing mathematical statements.

Both were specified before running the comparison. Vocabularies and class
weights are fitted independently inside each training fold. The same 548 rows,
27 files, five source folds and 2,000 file-bootstrap draws are retained. There
is no new dependency, saved model, data relabelling, test-set evaluation or
production-model selection. Earlier reports are preserved.

### Measured outcome and limitations

| Method | Accuracy | 95% file CI | Macro F1 | 95% file CI | Definition recall |
|---|---:|---|---:|---|---:|
| Original logistic | 0.4033 | [0.3369, 0.4846] | 0.2362 | [0.1925, 0.2967] | 0.1957 |
| Naive Bayes | 0.4215 | [0.3439, 0.4985] | 0.2373 | [0.1918, 0.3030] | 0.1304 |
| Balanced logistic | 0.4124 | [0.3477, 0.4749] | 0.2700 | [0.2400, 0.3046] | 0.3913 |
| Balanced word+character | 0.3814 | [0.3273, 0.4762] | 0.2598 | [0.2315, 0.3134] | 0.3478 |

Balanced logistic finds 36 of 92 weak-labelled definitions rather than the
original 18. Definition F1 improves from 0.3186 to 0.4706, but precision drops
from 0.8571 to 0.5902: recovering more definitions also produces more false
positives. Accuracy improves only 0.91 percentage points over original logistic
and does not beat NB. Character features lower accuracy and macro F1 relative
to balanced words and are not preferred. Notation and algorithm F1 remain zero;
other F1 rises only to 0.0706. All per-class metrics/confusion matrices are saved.

⚡ **Design Decision — keep the failed experiment and stop tuning here.**

**Reasoning:** removing an unsuccessful candidate would hide evidence. The
balanced candidate is useful for development because it improves class balance
and definition recall, but it is not an accuracy breakthrough. The audit reveals
missing content and label ambiguity that feature changes cannot resolve. Further
repeated optimization on these same folds would make their scores increasingly
selection-biased. These intervals are descriptive file-bootstrap intervals, not
proof of statistical superiority or unbiased independent performance.

### Files created / modified

- **Evaluation (created):** `ml/eval/error_audit.py` — validated train-only join,
  deterministic 50-error sampling, provisional-review digest binding and aggregate counts.
- **Models (created):** `ml/models/improved_classifier.py` — fixed balanced-word
  and balanced word/character logistic fits with lazy dependency imports.
- **Models (modified):** `ml/models/first_classifier.py` — optional vectorizer
  injection into the shared input-validated fitter; original defaults unchanged.
- **Evaluation (modified):** `ml/eval/classifier_cv.py` — optional two-candidate
  run, bootstrap summaries and settings, separate improved report/audit paths.
- **Tests (created):** `ml/tests/test_error_audit.py` — nine cases for sampling,
  identity/source integrity, empty-error handling and atomic review binding;
  `ml/tests/test_improved_classifier.py` — nine cases for toy learning, fixed
  balancing, invalid inputs, vocabulary isolation and bootstrap inclusion.
- **Results (created):** `ml/results/error_audit_summary.json` — numeric sample
  and provisional diagnosis counts; `ml/results/classifier_improved_cv.json` —
  numerical baseline/candidate comparisons and fixed settings.
- **Local outputs (ignored):** `ml/out/ml2/error_audit.jsonl` — full sample with
  text and notes; `error_audit_review.json` — 50 digest-bound provisional notes;
  `cv_improved_predictions.jsonl` — development prediction audit, no text.
- **Documentation (modified):** `ml/README.md` — commands, results and caveats;
  `ml/models/README.md` — feature/weight mechanics and official versioned references;
  `docs/IMPLEMENTATION_PHASES.md` — substep state and proposed next repair; this log.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`:
  **192 passed, no skips**; 18 new audit/candidate cases.
- Actual five-fold candidate comparison completed; previous logistic/NB summaries
  and fold metadata exactly match ML2.4. The frozen test set remains untouched.
- Audit regeneration applies all 50 notes to the exact sample; Git ignore checks
  confirm source texts and review artifacts remain excluded.
- Typecheck, 185 frontend tests in 31 files, pure-core lint and production build
  re-run green. Existing non-fatal build warnings remain; no frontend edits/UI test.
- No new product bug was caught by a failing test. The diagnostic data issues
  above were found by text inspection, not a test failure; page verification remains pending.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next goal to achieve:** ML2.7 — a narrow training-data quality repair focused
on fragments and heading/table associations, preserving frozen memberships and
baseline reports. Independent gold labels and prose-definition recall remain pending.

---

## Phase ML2.7: Training Block and Heading-Association Repair

**Date:** October 7, 2026
**Objective:** verify the ML2.6 data-quality diagnoses against source pages,
repair general extraction rules, and regenerate training data without changing
the frozen split, original source folds or previous baseline artifacts.

### Source-page verification

The PDF skill guided Poppler rendering and inspection of six physical pages
from five local PDFs: the two timing tables, the lemma/proof page, the Newton
proof slide, the derivative example slide and the convex-set theorem page.
This was file-based document inspection, not browser/UI interaction. Original
PDFs were not edited. Rendered images remain ignored under `ml/out/ml27/pages/`.

The evidence confirms that the algorithm keyword belongs to a timing-table
column, not a procedure heading. The lemma and its proof are visibly distinct.
Both slide fragments have their missing displayed mathematics on the same page.
The convex-set theorem was not wrongly labelled: the extractor had separated
its final conclusion from the assumptions and set definition. This revises the
earlier provisional diagnosis rather than silently replacing its historical note.

### Extraction changes and boundaries

- Recognize formatted unnumbered `PROOF Let/Assume/Suppose/We/By/First/For...`
  openings without requiring a period. Ordinary references and lowercase
  starts remain rejected; the heading removed from model input is only `PROOF`.
- Reject unnumbered algorithm headings containing repeated time units. A
  table-header variable followed by `(ms)` had matched the existing function-name
  pattern. Numbered algorithms and actual named-function headings remain valid.
- Require three rows containing prose on both sides before declaring a gutter.
  The derivative slide's sparse, aligned equation spans had mimicked two columns,
  placing the function definition after several subsequent lines.
- Mark equality-heavy, low-prose lines as displayed mathematics without requiring
  a high Greek-symbol ratio. A long Taylor equation had otherwise remained prose.
- Keep nearby displayed maths and immediate Then/Hence/Thus/Because conclusions
  with a labelled block. Do not cross another heading, page, column or a gap over
  four line heights. Lone-heading merging also cannot consume the next heading.

⚡ **Design Decision — preserve uncertain blocks as unlabelled.**

**Reasoning:** the timing tables should lose false algorithm supervision, not
become invented `other` examples. Rules use formatting, geometry and text structure,
not a list of audited block IDs, filenames or desired prediction labels. Unlabelled
still means unknown. Cross-page propagation and general paragraph merging are
deferred because they can attach unrelated prose to a mathematical role.

⚡ **Bug — equation merging could swallow the next heading.**

**Reasoning:** a new regression test failed when an unformatted `Proof.` followed
an unfinished theorem sentence. Context-sensitive heading detection rejected it
as a wrapped reference, allowing the new merger to consume it. The merger now
checks the next block's heading independently of the preceding sentence before
joining. The test protects the heading/page/column/gap boundaries.

⚡ **Bug — overlap diagnostics collapsed repeated identical rows.**

**Reasoning:** a later fixture uses repeated text on the same page. Set-based
content overlap counted eight signatures instead of 80 unchanged row occurrences.
The summary now intersects Counters, preserving multiplicity while ignoring
block-ID shifts caused by merges. The full suite was re-run after this failure.

### Regeneration and frozen-fold hygiene

`repair_training.py` reads only the 40 PDFs assigned to frozen training groups.
Original training-report memberships supply all 23 source-to-fold assignments,
including groups with no usable weak labels. The runner rejects incomplete,
duplicate or held-out memberships and existing output datasets. No frozen-test
PDFs or independent hand labels were re-extracted or used for this work.

The verified run is `ml/out/ml27/verified/`. It contains 9,360 blocks and 938 weak
labels before the unchanged 200-row source cap and 30-character body filter.
The capped dataset has 549 rows / 27 PDFs: definition 92, theorem 130, proof 123,
example 135, notation 4, algorithm 24 and other 41. Original source memberships
are identical; fold row counts become 200/200/57/49/43. Earlier ML2.1 rows remain
at 548 in their original location. Intermediate local repair runs are not the
accepted evaluation snapshot and remain ignored.

The selected-row unfinished-introduction heuristic falls from five to zero.
It only checks endings such as given-by/yields/expressed-as/linear-map/compute;
it cannot prove semantic completeness. Exactly 385 rows match on file, page,
text and weak label across snapshots. The remaining changes include block
merging and deterministic cap re-selection as block IDs shift. No old question,
labelling sample, prediction audit or baseline report was rewritten.

⚡ **Design Decision — changed data receives a separate evaluation revision.**

**Reasoning:** changed bodies, label associations and source-cap selection mean
that a before/after accuracy subtraction is not an identical-row model comparison.
The runner now records `dataset_revision: ML2.7`, an explicit comparison warning
and a separate local row-audit path. No hyperparameters changed in this substep.

### Repaired-dataset results

| Model | Accuracy | 95% file CI | Macro F1 | 95% file CI | Definition recall |
|---|---:|---|---:|---|---:|
| Original logistic settings | 0.4026 | [0.3302, 0.4783] | 0.2321 | [0.1942, 0.2867] | 0.1848 |
| Naive Bayes | 0.3716 | [0.2947, 0.4310] | 0.2102 | [0.1711, 0.2651] | 0.1304 |
| Balanced logistic | 0.4080 | [0.3362, 0.4703] | 0.2638 | [0.2337, 0.2984] | 0.4022 |
| Balanced word+character | 0.4007 | [0.3426, 0.4842] | 0.2641 | [0.2365, 0.3018] | 0.3370 |

Balanced logistic recovers 37 of 92 weak-labelled definitions, precision 0.6066
and definition F1 0.4837. Algorithm and notation F1 remain zero. There is no
accuracy breakthrough or production-model selection. The data fixes are justified
by source-page structure, not by scores. Intervals still use 2,000 file-cluster
resamples and seven-class macro F1; they do not remove source correlation, weak-label
noise or development-selection bias. Full metrics/confusion matrices are saved.

### Files created / modified

- **Data (modified):** `ml/data/heading_rules.py` — formatted proof openings and
  timing-table rejection; `ml/data/extract_blocks.py` — prose-backed gutter evidence,
  display-math detection and bounded heading/equation/conclusion grouping.
- **Data (created):** `ml/data/repair_training.py` — train-only regeneration,
  original-fold validation and fresh-output protection.
- **Data (modified):** `ml/data/prepare_training.py` — optional explicit source
  folds; default preparation remains deterministic and unchanged in policy.
- **Evaluation (created):** `ml/eval/training_quality.py` — aggregate class/row
  counts, unfinished-intro heuristic and multiset content overlap with fold checks.
- **Evaluation (modified):** `ml/eval/classifier_cv.py` — dataset revision/warning
  and independent row-audit path for regenerated training inputs.
- **Tests (created):** `ml/tests/test_training_repair.py` — 16 cases covering
  formatted proof starts/references, table headers, ASCII/long equations, false
  gutters, merge boundaries, lone headings, preserved folds and repeated content.
- **Results (created):** `ml/results/training_repair_summary.json` — numerical
  before/after data diagnostics; `ml/results/classifier_repaired_cv.json` — separate
  repaired-row metrics, intervals, class supports and model settings.
- **Local outputs (ignored):** `ml/out/ml27/verified/` — extracted blocks,
  training rows/report and predictions; `ml/out/ml27/pages/` — inspection PNGs.
- **Documentation (modified):** `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`
  and this log — reproduction, changed-data caveats, limits and next unit.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`:
  **208 passed, no skips** after both failing regression cases were repaired.
- Verified source outputs: both timing tables are unlabelled; lemma and proof
  are separate; the Newton proof includes its equation; the derivative example
  includes its function and displayed derivation; the convex theorem includes
  its conclusion. Source-page inspection covered six pages, not the entire corpus.
- Training-only regeneration and five-fold evaluation completed; fold-membership
  comparison and ignored-artifact checks passed. Original baselines retained.
- Typecheck, 185 frontend tests / 31 files, core-boundary lint and production build
  re-run green. Existing non-fatal build warnings remain. No UI was operated.
- Remaining extraction limits: imperfect fraction/subscript order, unlabelled
  continuation paragraphs, cross-page role boundaries and possible genuine
  equation-only two-column pages rejected by the conservative prose rule.

**Git checkpoint:** `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.

**Next goal to achieve:** ML2.8 — accept the repaired training snapshot and build
a small independently reviewed, train-only label set with more rare-class examples.
Independent frozen-test labels and final gold acceptance remain pending.

---

## Phase ML2.8: Scoring Scheme — Merged Labels and Estimable Classes

**Date:** October 7, 2026

**Goal:** make the development score measure what the classifier can learn
from these sources. No model, feature, hyperparameter or training row changed.

### Why the old macro F1 was misleading

Seven-class macro F1 averaged two zeros that no model could avoid:

- `notation` has 4 rows in the 549-row snapshot.
- 23 of the 24 `algorithm` rows sit in fold 3 (18 from one thesis). When fold 3
  is held out, the training folds contain one algorithm row, so recall is zero
  by construction.
- `other` (remarks, notes) is not something the product extracts, yet it counted
  as one seventh of the score.

### What changed

⚡ **Design Decision — merge at scoring time, never in the labels.**

**Reasoning:** hand labels and weak labels keep all seven classes, and
`ml/labels/label.html` still offers keys 1–7. `ml/eval/label_scheme.py` maps
`notation → definition` only when training and scoring, so the finer label can
be recovered later. Notation statements define symbols, which is what the OKF
bundle needs from them.

⚡ **Design Decision — a class enters macro F1 only if it is estimable.**

**Reasoning:** a class is estimable when it appears in at least 3 training
sources **and** at least 3 development folds. Requiring folds as well as sources
catches `algorithm`: it has 4 sources but only 2 folds. Non-estimable classes are
still trained, predicted and reported per class; they are only left out of the
average and listed as `not_estimable`. `other` stays a training class (useful
negative evidence) but is never averaged.

Coverage on the ML2.7 snapshot after merging:

| Class | Rows | Sources | Folds | In macro F1 |
|---|---:|---:|---:|---|
| definition (incl. 4 notation) | 96 | 5 | 5 | yes |
| theorem | 130 | 7 | 5 | yes |
| proof | 123 | 6 | 4 | yes |
| example | 135 | 8 | 5 | yes |
| algorithm | 24 | 4 | 2 | no — not estimable |
| other | 41 | 6 | 4 | no — unscored by design |

### Results (same 549 rows, same folds, same models as ML2.7)

| Model | Accuracy | Macro F1 (4 classes) | 95% file CI | Definition P / R / F1 |
|---|---:|---:|---|---|
| Majority | 0.2259 | 0.1037 | [0.080, 0.125] | 0 / 0 / 0 |
| Logistic | 0.4044 | 0.4114 | [0.349, 0.489] | 0.65 / 0.21 / 0.31 |
| Naive Bayes | 0.3752 | 0.3742 | [0.299, 0.470] | 0.67 / 0.15 / 0.24 |
| Layout LightGBM | 0.2204 | 0.1860 | [0.120, 0.241] | 0.11 / 0.02 / 0.03 |
| Balanced logistic | 0.4098 | 0.4444 | [0.388, 0.497] | 0.59 / 0.39 / 0.47 |
| Balanced word+character | 0.4007 | 0.4537 | [0.385, 0.505] | 0.50 / 0.38 / 0.43 |

**Read this honestly.** The rise in macro F1 from about 0.26 to 0.44 is a change
in what is averaged, not a better model: accuracy moved by at most 0.004 and the
same kind of predictions are being scored. What the new number does show is that
on the four learnable classes the text models are clearly above the majority
baseline (non-overlapping intervals), while layout-only features are not.
Definition recall below 0.4 remains the main weakness.

### Files created / modified

- **Evaluation (created):** `ml/eval/label_scheme.py` — merge map, unscored
  classes, coverage and the estimability rule.
- **Evaluation (modified):** `ml/eval/classifier_cv.py` — `labels`/`scored`
  arguments for metrics, bootstrap and fold checks (defaults reproduce the old
  seven-class reports); `--merged` flag records `label_scheme` in the report.
- **Tests (created):** `ml/tests/test_label_scheme.py` — 5 cases.
- **Results (created):** `ml/results/classifier_merged_cv.json`.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`:
  **213 passed** (208 + 5).
- Earlier reports were not regenerated; the default runner output is unchanged.

### Test-sample labels: assistant draft, human review pending

At the user's request the assistant labelled all 300 frozen-test blocks from
`to_label.jsonl` alone (text, file, page; weak labels never consulted), using the
seven-class guide in `label.html`. Output, both git-ignored:

- `ml/labels/assistant_labels.jsonl` — 300 rows in the page's export format;
  verified to import through the page's own validator (300/300).
- `ml/labels/assistant_review.jsonl` — 61 blocks the assistant marked uncertain
  (mostly mixed blocks: prose that defines a term inside discussion or a proof,
  statement fragments, slide tables).

Counts: other 104, proof 57, theorem 41, definition 40, notation 22, example 24,
algorithm 12. Rules applied: exercises and solutions are `example`; claims and
statement fragments are `theorem`; references, captions, headings, front matter
and remarks are `other`; a block that introduces a named concept is `definition`
even inside discussion; symbol tables and "we denote" conventions are `notation`.

⚡ **Design Decision — these are not human gold labels until reviewed.**

**Reasoning:** an LLM annotator is independent of the weak labels and of the
trained classifiers, but it is not the human labeller the plan specifies. The
user restores the file in `label.html`, reviews at least the 61 uncertain blocks
plus a random 50 of the rest, and exports `hand_labels.jsonl`. Agreement on the
random 50 (Cohen's kappa) is reported with any gold result.

**Next goal to achieve:** hand labels; then a gold evaluation script that applies
the same `label_scheme` to the frozen test sample and reports prose-definition
recall separately. Data expansion (more independent sources) follows.

---

## Phase ML2.9: Gold Evaluation Script (built, not yet run on the test set)

**Date:** October 7, 2026

`ml/eval/gold_eval.py` evaluates three systems on the labelled frozen-test sample:

- heading rule (weak label or abstain);
- classifier, fitted once on all training rows, applied to heading-free text;
- two-stage system (the product): heading rule if a heading exists, else classifier.

It reports, with file-cluster bootstrap intervals:

- heading-rule coverage and its accuracy when it fires;
- accuracy, per-class metrics and macro F1 for the classifier and the two-stage system;
- **prose-definition recall and precision**, i.e. on blocks without a heading;
- two-stage accuracy per sampling stratum (weak / prose candidate / unlabelled);
- Cohen's kappa between two label files (`--compare`), e.g. the reviewed
  `hand_labels.jsonl` against `assistant_labels.jsonl`.

⚡ **Design Decision — reading the test set needs an explicit flag.**

**Reasoning:** the rules say the frozen test set is read only at milestones. The
script refuses to evaluate models without `--frozen-test-milestone`; `--kappa-only`
compares label files without any model output. It has been unit-tested on toy
data only. It has **not** been run against the test sample.

`ml/eval/stats.py` gained `cluster_bootstrap(rows, statistic)`, a generic
file-resampling interval that skips resamples where a statistic is undefined
(for example recall with no positives) and reports how many were skipped.

```powershell
# after the user's review exports hand_labels.jsonl
.\.venv-ml\Scripts\python.exe -m ml.eval.gold_eval --compare ml/labels/assistant_labels.jsonl --kappa-only
# milestone only, once a model is chosen on development data
.\.venv-ml\Scripts\python.exe -m ml.eval.gold_eval --model balanced_logistic --frozen-test-milestone
```

---

## Phase ML2.10: Cue, Context and Layout Features; Three-Way Definition Detector

**Date:** October 7, 2026

**Goal:** add hand-designed evidence that TF-IDF misses, and test the reframed
task the product needs (definition / theorem-like statement / neither).

### Features (`ml/models/definition_features.py`)

- **Cue phrases:** 22 named regular expressions grouped by role: definition
  ("we say", "is called", "define", "denote", `:=`), statement ("Let … then",
  "there exists", "for all"), proof ("hence", "by Lemma", "since", ∎/□), exercise
  ("Find", "Compute", "how many", "?"), algorithm (Input/Output, numbered steps,
  `←`), other (citations, figure/table captions). Plus length, sentence count and
  digit ratio.
- **Context:** heading label of the previous block in (file, page, block_index)
  reading order, or "none". At inference the heading rule provides this.
- **Layout:** the five ML2.5 measurements plus category.

Two models use them:

- `cue_logistic`: one balanced logistic regression over TF-IDF words plus the
  standardised hand features. `coefficients()` returns each hand feature's
  weight per class for inspection.
- `stacked_lightgbm`: LightGBM over the balanced text model's class probabilities
  plus the hand features. Training-row probabilities come from an inner 4-fold
  source-grouped cross-fit, so LightGBM never sees probabilities from a text model
  trained on the same rows.

Both accept `sample_weight`, so they work with the parallel `--source-weighted`
option in `classifier_cv.py`.

`label_scheme.py` gained the coarse map: notation → definition; theorem stays
(statement); proof, example, algorithm, other → other (neither). Macro F1 averages
definition and theorem. Existing label names are reused so validators are unchanged.

### Leakage check on context

Previous-block labels for training rows: proofs follow a theorem block in 91 of
123 cases and never follow their own lone "Proof." heading (0 cases). The signal
is real document structure and is available at inference. Caveat: the training
rows all had headings; for unheaded prose the previous block is more often
unlabelled ("none"), so the gain may be smaller on the real target.

### Results (same 549 rows and folds; no tuning)

Merged scheme, macro F1 over definition/theorem/proof/example:

| Model | Accuracy | Macro F1 | 95% file CI | Definition P / R / F1 | Proof F1 |
|---|---:|---:|---|---|---:|
| Balanced logistic (reference) | 0.410 | 0.444 | [0.388, 0.497] | 0.59 / 0.39 / 0.47 | 0.49 |
| Cue logistic | 0.379 | 0.446 | [0.215, 0.526] | 0.58 / 0.48 / 0.53 | 0.54 |
| Stacked LightGBM | 0.412 | 0.445 | [0.378, 0.533] | 0.67 / 0.17 / 0.27 | 0.75 |

Coarse 3-way scheme, macro F1 over definition/theorem:

| Model | Accuracy | Macro F1 | 95% file CI | Definition P / R / F1 |
|---|---:|---:|---|---|
| Majority | 0.588 | 0.000 | — | 0 / 0 / 0 |
| Balanced logistic | 0.641 | 0.420 | [0.336, 0.483] | 0.67 / 0.35 / 0.46 |
| Cue logistic | 0.630 | 0.432 | [0.111, 0.544] | 0.55 / 0.48 / 0.51 |
| Stacked LightGBM | 0.667 | 0.353 | [0.141, 0.468] | 0.64 / 0.19 / 0.29 |

**Verdict:** no overall gain that the intervals support. Two specific effects:
context lifts proof F1 from 0.49 to 0.75 in the stacked model, and cue phrases
raise definition recall from 0.39 to 0.48 in the logistic model. Both cue-model
intervals are very wide: the effect depends on which sources are held out. With
14 sources this cannot be settled; the comparison is re-run unchanged on the
expanded arXiv training set. No model was selected and nothing was tuned.

### Files created / modified

- **Models (created):** `ml/models/definition_features.py`.
- **Evaluation (created):** `ml/eval/gold_eval.py`.
- **Evaluation (modified):** `ml/eval/label_scheme.py` (coarse scheme),
  `ml/eval/stats.py` (`cluster_bootstrap`), `ml/eval/classifier_cv.py`
  (`--coarse`, `--with-features`, `--context-blocks`).
- **Tests (created):** `ml/tests/test_gold_eval.py` (5),
  `ml/tests/test_definition_features.py` (10).
- **Results (created):** `ml/results/classifier_merged_features_cv.json`,
  `ml/results/classifier_coarse_features_cv.json`.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`:
  **252 passed** (includes the parallel source-expansion tests).
- `gold_eval` without `--frozen-test-milestone` exits with an error, as intended.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.classifier_cv --rows ml/out/ml27/verified/train_blocks.jsonl --dataset-revision ML2.7 --merged --with-improved --with-features --audit ml/out/ml210/cv_merged_features_predictions.jsonl
.\.venv-ml\Scripts\python.exe -m ml.eval.classifier_cv --rows ml/out/ml27/verified/train_blocks.jsonl --dataset-revision ML2.7 --coarse --with-improved --with-features --audit ml/out/ml210/cv_coarse_features_predictions.jsonl
```

**Next goal to achieve:** re-run both commands on the expanded training rows
(with `--source-weighted` and `--context-blocks` pointing at the expanded blocks),
then pick one model on development data before the milestone gold run.

---

## Phase ML2.E1: Training-only arXiv Expansion and Source-balanced Fits

**Date:** October 7, 2026
**Objective:** add 100–150 independent paper groups without changing the frozen
test set, replace source caps with weights, and check weak labels against about
20 corresponding LaTeX sources. PDF collection and weighting are complete;
the 20-source audit is **not complete** because the source service rate-limited
downloads. This entry records partial acceptance, not a finished audit.

### Collection and provenance

Collected and extracted **120 papers**, 20 per requested category: math.CO,
math.PR, math.OC, stat.TH, cs.DS and theory-oriented cs.LG. The existing
`process_pdf()` is called unchanged; neither `extract_blocks.py` nor
`heading_rules.py` was edited for this expansion. There is no OCR step.

Selection precedes extraction. Queries use the fixed 2025 submission window
and descending submission order, cache 80 candidates per category, deduplicate
base arXiv IDs across cross-listings, and reject existing embedded PDF titles.
Exact PDF SHA-256 matches against the original corpus and previously downloaded
papers are rejected before extraction. These checks reduce overlap; they do
not prove that differently titled or revised PDFs contain no shared text.

⚡ **Design Decision — category quotas and a title filter, not label-yield selection.**

**Reasoning:** choosing papers because the extractor found many headings would
bias the collection toward the extractor's easiest cases. The cs.LG query uses
theory/theoretical/convergence/generalization title terms; this is a reproducible
theory-oriented filter, not a manual guarantee that every selected paper is
pure theory. Paper identity is the fold group; shared authors are not deduplicated.

⚡ **Plan Deviation — canonical category and an unavailable source replacement.**

**Reasoning:** arXiv's taxonomy identifies stat.TH as an alias for math.ST;
the literal stat.TH API query returned zero entries. The collector queries
math.ST but records the requested stat.TH bucket. `2512.24042v2` returned 404
and its abstract page confirmed withdrawal. It was replaced by `2512.23643v1`,
the next unused cached statistics candidate. The replacement is recorded locally
and was not chosen by label count or classifier performance. Policy and taxonomy:
[arXiv access terms](https://info.arxiv.org/help/api/tou.html),
[bulk access guidance](https://info.arxiv.org/help/bulk_data.html),
[category taxonomy](https://arxiv.org/category_taxonomy),
[withdrawn paper](https://arxiv.org/abs/2512.24042).

### Dataset yield, frozen boundary and fold coverage

The new papers produce **19,804 blocks / 3,665 automatic labels**. The existing
heading-free body-length filter retains **3,624 new training rows**. Adding the
uncapped repaired ML2.7 corpus gives **4,477 rows**, rather than 549 capped rows.
The repaired original corpus contributes 853 usable rows: **304 rows recovered**
relative to its capped snapshot. That is not the 264-row difference from the
older extraction snapshot in the request; extraction repairs changed the count.
No row is now dropped by a source cap. Unlabelled and short-body filters remain.

| Original weak class | Usable rows | Sources containing it |
|---|---:|---:|
| definition | 403 | 60 |
| theorem | 1,946 | 102 |
| proof | 1,458 | 99 |
| example | 284 | 34 |
| notation | 15 | 10 |
| algorithm | 86 | 33 |
| other | 285 | 63 |

The extension assigns 143 training groups (23 original + 120 papers), of which
124 have usable labels. It preserves the original ten test and five excluded
groups. `ml/splits.json` is byte-for-byte unchanged; its SHA-256 is recorded in
the aggregate report. No test-source text was extracted, no test predictions
were made, and no test labels were used to select papers, folds or weights.
Only metadata titles and file hashes were read for duplicate screening.

⚡ **Design Decision — rebalance training folds, preserve the actual test freeze.**

**Reasoning:** old development folds contained 200/200/57/49/43 capped rows.
Adding 120 groups while keeping those training-fold memberships is not required
by the frozen test contract. The new group-isolated folds contain
**896/896/895/895/895 rows**, and every original class appears in every fold.
Historical rows, reports and fold snapshots remain in their original directories.
The new training-only split and manifest are separate ignored files.

### Sample weighting instead of discarding rows

Each usable row stores `1 / usable_rows_from_its_source`, so each labelled
source contributes total weight one. CV recomputes this from its **training
portion only**, then scales all weights by training rows / contributing sources
to give mean weight one. The weighted majority baseline uses those same weights.
The text and layout model fitters accept positive finite sample weights.

⚡ **Design Decision — mean-one normalization at fit time.**

**Reasoning:** feeding raw source totals of one into logistic regression changes
the overall loss scale relative to fixed regularization; it also changes the
effective strength of NB's smoothing. A common scaling preserves relative
source influence without that accidental change. In balanced candidates, class
weights are additional multipliers. TF-IDF vocabulary/document frequencies are
still row-based: source weighting balances supervised loss, not every stage.
The historical repair command explicitly retains cap 200 for reproduction.

### Source-weighted development comparison

Logistic and NB were fitted independently on each new training fold using
heading-free text. ML2.8 notation-to-definition merging and estimability checks
are preserved. All five scored classes are now estimable, including algorithm;
`other` is trained but excluded from macro F1. Results are in the separate
`ml/results/classifier_expanded_cv.json`; row predictions stay ignored.

| Method | Accuracy | Macro F1, 5 classes | Accuracy 95% file interval |
|---|---:|---:|---|
| Source-weighted majority | 0.4347 | 0.1212 | [0.399, 0.470] |
| Source-weighted logistic | 0.6813 | 0.4609 | [0.639, 0.721] |
| Source-weighted NB | 0.6589 | 0.3870 | [0.609, 0.704] |

This is a changed population, changed folds and a five-class macro denominator,
not an identical-row improvement over earlier four-class reports. Logistic
definition precision is 0.8723 but recall only **0.0981**; example recall is
0.0035. More data helps common theorem/proof recognition but does not fix these
rare-role failures. Accuracy is row-pooled; fit weights do not make that metric
source-macro accuracy. File-bootstrap intervals are development diagnostics,
not a final independent-label evaluation. Nothing is deployed.

### LaTeX audit: tooling verified, collection still blocked

The 20-paper audit selection is fixed before labels are inspected: category
round-robin over the selected corpus, rather than the first 20 combinatorics
papers. Archives are read in memory, never extracted or compiled. Bounds apply
to member counts and decompressed source size; symlinks, hardlinks and unsafe
paths are rejected. `.tex`, `.sty` and `.cls` declarations define environment
aliases. Eight-word prose anchors near the PDF block start must identify exactly
one source environment; nested, repeated or conflicting matches abstain.

⚡ **Bug — a later proof paragraph could determine a statement's audit label.**

**Reasoning:** the first real archive exposed two propositions incorrectly
matched to proof environments via appended discussion. Restricting anchors to
the block prefix and reading theorem aliases from style files removes that
false disagreement. A regression test now confirms a tail-only proof match
stays unresolved. The extractor was not changed to improve audit numbers.

⚡ **Plan Deviation — only 2 of 20 archives downloaded; HTTP 429 stops collection.**

**Reasoning:** sequential requests are spaced at least 3.1 seconds, with an
additional 30-second delay for source archives after an initial rate-limit
response. A later source request still returned 429 without `Retry-After`.
The collector stores the failure and refuses requests during a 15-minute
fallback cooldown. It does not switch endpoints or repeatedly retry the limit.
Cached PDFs, blocks and successful archives are retained for resumption.

The **partial** report checks 90 automatic labels from two archived papers:
48 uniquely resolved, 48 agreeing with the source environment, 42 unresolved.
That is 100% agreement **on the resolved subset**, with **53.3% coverage**.
It is not a 20-paper precision estimate, not overall label precision and not
independent human gold. Only one paper contributes resolved matches, so the
bootstrap interval is intentionally absent; zero observed mismatches does not
prove perfect population precision. Remaining 18 archives and review of
unresolved/mixed blocks are required before quoting a meaningful audit result.

### Files created / modified

- **Data collection (created):** `ml/data/arxiv_corpus.py` — cached metadata,
  category selection, rate-limited downloads, recorded unavailable-paper
  replacements, duplicate screening and unchanged extraction calls.
- **Data assembly (created):** `ml/data/expand_training.py` — training-only split
  extension, uncapped rows, source weights, new folds and aggregate coverage.
- **Data assembly (modified):** `ml/data/prepare_training.py` — no-cap default
  and stored per-source weights; `ml/data/repair_training.py` — explicit legacy
  cap so historical repair reproduction does not silently change.
- **Models (modified):** `ml/models/first_classifier.py`,
  `ml/models/improved_classifier.py`, `ml/models/layout_classifier.py` — validate
  weights and pass them into majority, logistic, NB and LightGBM fits.
- **Evaluation (modified):** `ml/eval/classifier_cv.py` — source-weighted fitting
  and explicit split/manifest inputs; concurrent scoring/feature work preserved.
- **Evaluation (created):** `ml/eval/latex_audit.py` — bounded source reader,
  environment aliases, conservative block alignment, coverage and precision.
- **Tests (created):** `ml/tests/test_source_expansion.py` — 24 deterministic
  cases covering uncapped retention, group-weight totals, all existing base
  fitters, train-only CV weights, split immutability, metadata deduplication,
  cooldowns, unavailable-paper replacement, ambiguous/prefix alignment and
  unsafe archives. No test performs a network download.
- **Aggregate results (created):** `ml/results/arxiv_expansion_summary.json`,
  `ml/results/classifier_expanded_cv.json`, `ml/results/arxiv_label_audit.json` —
  counts/folds, the new baseline comparison and explicitly partial source audit.
- **Documentation (modified):** `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`
  and this log — reproducible commands, boundaries, status and remaining work.
- **Local only (ignored):** `ml/out/arxiv_expansion/` — 120 PDFs, two archives,
  metadata/provenance, block text, extension split/manifest and row-level audits.

### Testing

- Full current Python suite: **252 passed**, including 24 new expansion tests
  and concurrent gold/feature tests. No frozen-test evaluation was run.
- Typecheck (`npx tsc -b`), core-boundary lint, 185 frontend tests, seven Node
  labelling-session tests and production build: **green**. Initial sandbox
  `spawn EPERM` prevented Node/Vite startup; reruns with process access passed.
- Existing non-fatal build warnings remain: Browserslist age, PDF.js image
  URLs, mixed static/dynamic imports and large chunks. Full-shell ESLint and
  live CI were not newly verified; no UI check is required for this data change.
- `git diff` confirms extractor, heading rules and frozen split unchanged;
  `git check-ignore` confirms downloaded sources and data stay out of Git.

**Remaining/manual check:** resume the 18 source archives after cooldown, finish
the category-spread audit and review unresolved matches before an overall
precision claim. Human approval of the 300 draft test labels remains separate.
Re-run existing definition-focused candidates on the expanded training data
before choosing a classifier; do not tune on the frozen test set.

**Git checkpoint: pending — no commit requested for this follow-up.**

---

## Phase ML2.E2: Expanded-data Definition-focused Comparison and Audit Integrity

**Date:** October 7, 2026
**Objective:** resume the remaining LaTeX sources and compare the existing
definition-focused models on expanded training. The comparison is complete;
the 20-source audit remains incomplete because of truncated downloads and a
renewed HTTP 429. No new model architecture or test evaluation was introduced.

### Training context and fixed candidates

Reused all **4,477 rows**, their source-isolated folds, merged label scheme and
source weights from ML2.E1. Repeated plain-logistic predictions match the
previous run exactly. Four existing ML2.6/ML2.10 candidates are compared:
balanced word logistic, balanced word+character logistic, cue/context/layout
logistic, and the stacked LightGBM model. No settings were tuned on these results.

`expand_training` now writes an ignored catalogue of **29,164 training blocks**
for context attachment. This includes unlabelled neighbouring blocks: filtering
to labelled rows would invent adjacency and pass the wrong preceding heading.
Every non-training group is excluded before the catalogue is written. The
regression checks that a labelled block after an unlabelled block gets `none`
context, and that test/excluded blocks cannot enter the catalogue.

The existing stack uses inner source-grouped out-of-fold text probabilities for
its training matrix, not predictions from a text model fitted on those same
rows. Outer source weights are inherited by those inner fits. Previous-block
heading labels are available at inference, but they are correlated with weak
supervision; human-labelled evaluation is still needed to establish real benefit.

### Same-row development results

Five classes enter macro F1: definition (including notation), theorem, proof,
example and algorithm. `other` remains trained but unscored in that average.

| Model | Accuracy | Macro F1 | Definition precision | Definition recall |
|---|---:|---:|---:|---:|
| Plain logistic | 0.6813 | 0.4609 | 0.8723 | 0.0981 |
| Balanced word logistic | 0.7000 | 0.6167 | 0.5725 | 0.5670 |
| Balanced word+character | 0.7208 | 0.6825 | 0.5451 | 0.5933 |
| Cue/context/layout logistic | 0.7161 | 0.6922 | 0.6228 | 0.5885 |
| Stacked LightGBM | 0.8043 | 0.7591 | 0.7275 | 0.6196 |

The stack is the strongest measured development candidate here. Its example
recall is 0.4401 and algorithm recall 0.8488. Its weak-label accuracy interval
from the existing file-bootstrap runner is [0.7717, 0.8357]. This is not an
80.4% real-world/gold accuracy claim, and nothing is deployed.

⚡ **Design Decision — paired source-group differences, not overlapping standalone intervals.**

**Reasoning:** each model predicts the same rows. The new comparison first
rejects changed row IDs, files, folds, gold labels or repeated baseline outputs.
It then aggregates correctness and definition hits by source and bootstraps
**124 source groups**, with 2,000 draws and the fixed seed. Multiple PDFs from
one original source stay together. The estimates remain row-pooled; source
groups are the uncertainty unit, not a change to source-macro scoring.

Against plain logistic, the stack gains **0.1231 accuracy** (95% paired interval
[0.1010, 0.1466]) and **0.5215 definition recall** ([0.4611, 0.5877]). Balanced
word logistic gains 0.0188 accuracy but its interval [-0.0066, 0.0455] includes
zero; its definition-recall gain is supported. Word+character and cue models
have small positive accuracy-difference intervals. These are development
comparisons between already development-informed candidates, not final selection
proof or independent gold results.

### Archive collection and honest partial audit

Collection resumed after the saved cooldown and downloaded three more archives.
There are now **five downloaded archives**, but only **three readable sources**.
Two files, `2512.25037v1.source` and `2601.00107v1.source`, end at 1 MiB and
2 MiB respectively and fail gzip completeness checks. Another request returned
429 without `Retry-After`; the collector stopped and saved a new cooldown.
No endpoint switching or repeated rate-limit retries were performed.

⚡ **Bug — downloaded bytes were mistaken for a complete source archive.**

**Reasoning:** parsing real archives raised `EOFError`; checking existence alone
would skip these broken files on every resume. Gzip data is now read through its
footer under the decompression bound before parsing TeX. Partial HTTP responses
and mismatched `Content-Length` are rejected. Newly downloaded source data must
pass the archive check before caching. On a subsequent permitted resume, corrupt
cached files are renamed to `.invalid-*` for diagnosis and re-requested, not
deleted or overwritten. Those renames have not yet occurred during this run.

⚡ **Design Decision — unreadable sources remain in the audit denominator.**

**Reasoning:** dropping a corrupt archive could make coverage look better.
The report instead includes its automatic labels as unresolved, records the
source error, and reports downloaded/readable counts separately. Archives with
no readable TeX are not accepted as LaTeX sources. A regression verifies that
a corrupt source's predicted label remains counted, not silently omitted.

The partial audit covers **246 automatic labels** in those five papers:
**103 uniquely aligned and agreeing**, **143 unresolved**, or **41.9% alignment
coverage**. Conditional agreement is 100% on those matches, not overall precision.
There are no observed mismatches, so a boundary-only bootstrap interval is not
reported as proof of perfection. **17 valid archives still needed**: 15 not
downloaded and two truncated downloads needing replacement/refetch. The
category-spread 20-paper audit is not accepted or complete.

### Files created / modified

- **Data (modified):** `ml/data/expand_training.py` — generates a train-only
  full-block context catalogue without changing selected rows, folds or weights.
- **Collection (modified):** `ml/data/arxiv_corpus.py` — response status/length
  checks, archive validation before caching and recoverable handling of invalid
  cached source files.
- **Evaluation (modified):** `ml/eval/latex_audit.py` — full bounded gzip check,
  readable-source accounting, per-source errors and conservative unresolved counts.
- **Evaluation (created):** `ml/eval/compare_expanded.py` — identical-run guards
  and paired source-group bootstrap differences for accuracy/definition recall.
- **Tests (modified/created):** `ml/tests/test_source_expansion.py` — seven new
  context/integrity cases; `ml/tests/test_expanded_comparison.py` — seven cases
  for arithmetic, reproducibility and changed-comparison rejection.
- **Results (created):** `ml/results/classifier_expanded_features_cv.json` and
  `ml/results/expanded_paired_comparison.json` — aggregate same-row model results
  and paired intervals; `ml/results/arxiv_label_audit.json` refreshed as partial.
- **Local only (ignored):** full context catalogue, candidate row predictions,
  five archives and refreshed download/audit diagnostics under `ml/out/`.
- **Documentation (modified):** `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`
  and this log — commands, measured results and remaining audit work.

### Testing

- **266 Python tests pass**, including seven new context/integrity cases and
  seven paired-comparison tests; all tests remain network-free/toy-data checks.
- Typecheck, core-boundary lint, **185 frontend tests** and production build
  are green. Existing non-fatal production warnings remain unchanged.
- Frozen split and extractor/heading-rule files are unchanged. Both reports
  explicitly record that the test set was not evaluated. Unrelated frontend,
  gold-evaluation and prior model work was preserved. No UI check is required.

**Remaining/manual check:** finish the source transfers and inspect unresolved
source matches before quoting automatic-label precision. Human review of the
300 independent test labels remains necessary before a gold acceptance run.
The stacked classifier is a development candidate, not an accepted product model.

**Git checkpoint: pending — no commit requested for this follow-up.**

---

## Phase ML2.E3: Fixed-sample Source-audit Accounting and Download Handoff

**Date:** October 12, 2026
**Objective:** resume the remaining 17 valid LaTeX archives and complete the
source audit. The service returned HTTP 429 again, so collection is still
incomplete. This follow-up corrects audit accounting and supplies a reproducible
manual handoff; it does not claim that the 20-source audit has been achieved.

### Resume outcome and recoverable cache handling

The saved cooldown had elapsed. One sequential source request was attempted
after the configured delay; it returned HTTP 429 without `Retry-After` and
collection stopped. No alternative endpoint or aggressive retry was used.
The known truncated `2512.25037v1.source` was renamed, with its bytes intact,
to `.source.invalid-1791798214015224600`. It can be recovered from that file;
nothing was deleted. The other truncated archive remains cached for diagnosis.
The state is still five previously downloaded papers, three readable sources,
15 papers not downloaded and two needing a valid replacement transfer.

### Correcting the audit denominator

⚡ **Bug — missing or quarantined sources disappeared from the selected sample.**

**Reasoning:** ML2.E2 kept corrupt `.source` files in the denominator, but
renaming one to `.invalid-*` removed it from the next audit. Papers without any
download were omitted as well. That made coverage depend on download success,
although the 20-paper sample was meant to be fixed before looking at labels.

The collector and auditor now share a category-round-robin selection function.
All 20 selected papers contribute their automatic labels. Missing, unreadable
or quarantined sources contribute unresolved labels, with an explicit error.
Downloaded and readable paper counts are separate. Completing collection can
no longer shrink or silently change this denominator.

| Fixed audit sample | Count |
|---|---:|
| Selected papers | 20 |
| Previously downloaded papers, including invalid caches | 5 |
| Readable sources | 3 |
| Automatic labels in selected papers | 742 |
| Uniquely aligned labels agreeing with source environments | 103 |
| Unresolved labels | 639 |
| Alignment coverage | 13.9% |

The 41.9% in ML2.E2 was coverage among the five downloaded papers. **13.9% is
the corrected fixed-sample coverage**, not a decline in label correctness.
Conditional agreement remains 103/103, but neither that ratio nor the
verified fraction is an overall precision estimate. A 20-paper precision claim
remains unsupported; no gold-test accuracy was measured here.

### Exact-version manual handoff

⚡ **Design Decision — offline manifest instead of repeated blocked requests.**

**Reasoning:** waiting and retrying has repeatedly failed at the source service.
The existing selected versions and cached PDFs must remain aligned. An offline
manifest lists all 20 paper IDs, category/title, version-specific abstract and
source URLs, absolute cache filenames and whether the source is still needed.
It does not change paper selection or make a network request.

`python -m ml.data.arxiv_corpus --list-sources` creates the ignored
`ml/out/arxiv_expansion/audit_downloads.json`; **17 entries are marked needed**.
If the source service is accessible to the user, download the LaTeX archive for
the exact listed version, keep its bytes unchanged, and save it to the listed
`.source` path. Do not download another PDF or overwrite `.invalid-*` diagnosis
files. Running `python -m ml.eval.latex_audit` then validates and measures the
available sources without requesting more downloads.

### Files created / modified

- **Collection (modified):** `ml/data/arxiv_corpus.py` — common fixed sample
  selection and an offline exact-version download-manifest command.
- **Evaluation (modified):** `ml/eval/latex_audit.py` — includes all selected
  papers, recognizes quarantined downloads, and counts their labels unresolved.
- **Tests (modified):** `ml/tests/test_source_expansion.py` — four new cases:
  missing source, quarantined source, category round-robin sample and manual
  manifest version/path preservation. Tests make no network requests.
- **Aggregate result (refreshed):** `ml/results/arxiv_label_audit.json` — fixed
  20-paper counts and the explicit partial status; no PDF/LaTeX prose included.
- **Local only (ignored):** `audit_downloads.json`, refreshed row audit, cooldown
  diagnostic and recoverable invalid cache under `ml/out/arxiv_expansion/`.
- **Documentation (modified):** `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`
  and this log — corrected coverage, manual instructions and blocker status.

### Testing

- **270 Python tests pass**, including the four new audit/handoff regressions.
- Typecheck, core-boundary lint, **185 frontend tests** and production build
  are green on October 12. Non-fatal build warnings remain unchanged.
- Original extractor, heading rules and frozen split are unchanged. No model
  was retrained and no frozen-test prediction was made in this follow-up.
- Only assistant draft labels are present; there is no human-approved
  `hand_labels.jsonl`. Gold evaluation is therefore still not run.

**Remaining/manual check:** acquire the 17 valid sources using the exact-version
manifest if the service is accessible, then inspect unresolved source matches.
Otherwise the external source-service blocker must clear first. Human review
of the independent test labels remains required before gold acceptance.

**Git checkpoint: pending — no commit requested for this follow-up.**

---

## Phase ML2.E4: Built-in Browser Source-download Verification

**Date:** October 12, 2026
**Objective:** test the user's claim that source downloads work through the
Codex built-in browser, instead of equating automated HTTP failures with paper
unavailability. One source download and its local ingestion are verified; the
full 20-source audit remains incomplete.

### Browser result and archive validation

The computer-use skill guided selection of the already-open arXiv tab and
interaction with its observed **TeX Source** link. No native Codex UI automation,
alternate guessed endpoint, source compilation or unrelated UI testing was used.
The browser downloaded `2601.00107v1` via the page's `arxiv.org/src/` link and
returned the actual local download path. The transfer completed, although the
browser tool call took much longer than its requested timeout; it is not a
verified fast collection mechanism yet.

The file is **8,471,681 bytes** and passes bounded gzip-footer and archive
validation. It contains one readable TeX file and 15 recognized environments.
The old **2,097,152-byte** truncated cache is preserved intact as
`2601.00107v1.source.invalid-browser-replacement`; no file was deleted. The
complete browser download was copied into the existing source-cache filename,
and the original download remains available.

⚡ **Design Decision / Correction — transport failure is not source unavailability.**

**Reasoning:** the script's `export.arxiv.org/e-print/` requests returned 429,
while the browser's actual source link succeeded. The earlier broad wording
that source collection was unavailable was therefore not justified. This
establishes a working browser route for this paper, not a diagnosis of why the
script route failed or proof that every remaining paper will download.

### Audit refresh and files affected

The fixed sample remains the same 20 papers and 742 automatic labels. There
are now **four readable sources**, **113 uniquely aligned agreeing labels**,
**629 unresolved labels** and **15.2% coverage**. Conditional agreement is still
not overall precision. **16 valid sources remain** before collection acceptance.

- **Aggregate result (refreshed):** `ml/results/arxiv_label_audit.json` — the
  new readable-source count and fixed-sample coverage, still marked partial.
- **Local only (ignored):** complete source cache, recoverable truncated cache,
  regenerated audit rows and `audit_downloads.json` now marking 16 needed.
- **Documentation (modified):** `ml/README.md`, `docs/IMPLEMENTATION_PHASES.md`
  and this log — successful browser verification and corrected availability claim.
- No extractor, classifier, source-code test, split or human-label file changed.

### Testing

- Browser download completion and its returned file path were observed.
- Full archive validation passed; regenerated audit uses the intact source.
- Download/cache SHA-256 equality and ignored-cache status were checked.
- The latest code gates remain the October 12 **270 Python tests**, **185
  frontend tests**, typecheck, core lint and production build from ML2.E3.
  They were not rerun for this data-only follow-up; no new green-gate claim is made.
- Frozen split and extractor/heading rules remain unchanged. No test-set
  evaluation, source execution or model retraining occurred.

**Remaining:** collect the remaining 16 selected source versions through the
working browser route and validate them individually. Keep unresolved labels
visible; independent human-label acceptance still remains separate.

**Git checkpoint: pending — no commit requested for this follow-up.**

---

## Phase ML2.E5: Complete the Remaining Source Downloads

**Date:** October 13, 2026
**Objective:** download and validate the remaining 16 exact-version LaTeX sources.

### Collection complete

The browser-control skill guided use of each observed TeX Source link. All
16 archives downloaded (22,231,565 bytes total), passed bounded archive validation,
and matched their cached copies byte-for-byte. No LaTeX was compiled or executed.
Original downloads and invalid caches remain recoverable. All **20 selected
sources are readable**, and the refreshed manifest has zero downloads remaining.
The temporary browser tab was closed after collection.

### Automatic audit and limitations

The fixed sample has 742 labels: 448 uniquely aligned, 446 agreeing, two
disagreeing and 294 unresolved. Conditional agreement is **99.55%**, with a
paper-bootstrap interval [98.90%, 100%] and **60.4% alignment coverage**. Two
readable papers have no recognized environments. No paper was replaced based
on audit outcomes. This is not overall precision or independent gold accuracy.

⚡ **Bug / Design Limitation — the two disagreements have different causes.**

**Reasoning:** `2601.00084v1`, page 16, has a fragmented reference to Definition 1
inside a remark, incorrectly weak-labelled definition. `2512.25033v4`, page 27,
has a legitimate claim environment inside a proof; custom problem-name macros
prevent its correct token alignment, so the auditor matches proof text instead.
The latter is an alignment artefact, not a confirmed wrong theorem label. Neither
the extractor nor training labels were changed during this download step.

### Files created / modified

- **Result (refreshed):** `ml/results/arxiv_label_audit.json` — complete collection
  and qualified automatic agreement/coverage.
- **Local only (ignored):** 16 source caches, row audits, download checklist and
  `browser_downloads_20261013.json` recording versions, routes, sizes and hashes.
- **Documentation:** this log, roadmap and ML README record completion.

### Testing

All archive/hash checks pass. **270 Python tests**, **185 frontend tests**,
typecheck, core-boundary lint and production build pass on October 13. Python's
initial sandbox temp-fixture setup failed; a fresh ignored workspace `--basetemp`
resolved the setup errors, without code changes or skipped tests. Existing build
warnings remain. Frozen split, extractor and heading rules are unchanged; no
model retraining or frozen-test prediction occurred.

**Remaining/manual check:** review the 294 unresolved labels and the documented
heading/alignment issues; approve the 300 draft test labels before gold evaluation.
There are no remaining downloads.

**Git checkpoint: pending — no commit requested for this follow-up.**

---

## Phase ML2.11: Model Choice Frozen Before the Gold Run

**Date:** October 13, 2026

**Goal:** choose one classifier on development data only, check it on the kinds
of documents the test set contains, and make the gold script train it exactly
as it was selected.

### Check on non-arXiv sources

After the expansion about 80% of training rows are arXiv papers, while the frozen
test set is a textbook, slides, NIST standards, a cryptography paper and a payments
paper. The expanded cross-validation predictions were therefore re-scored on the
**14 original non-arXiv sources only** (855 rows: textbook, slides, assignments,
thesis, notes), with intervals that resample source groups. Numbers below are
after the ML2.12 regeneration; the pre-regeneration check gave the same ranking.

| Model | Accuracy | 95% CI | Macro F1 (4 classes) | 95% CI | Definition P / R / F1 |
|---|---:|---|---:|---|---|
| Balanced logistic | 0.536 | [0.466, 0.600] | 0.533 | [0.385, 0.581] | 0.54 / 0.59 / 0.56 |
| Word + character | 0.556 | [0.501, 0.682] | 0.569 | [0.498, 0.624] | 0.51 / 0.63 / 0.56 |
| Cue logistic | 0.454 | [0.364, 0.759] | 0.497 | [0.208, 0.750] | 0.69 / 0.41 / 0.51 |
| **Stacked LightGBM** | **0.654** | [0.610, 0.712] | **0.678** | [0.619, 0.699] | **0.84 / 0.60 / 0.70** |

On these 14 sources the ML2.7 models trained on 549 rows reached about 0.41
accuracy; the added arXiv sources lift them to 0.54–0.65 without any test data.

⚡ **Design Decision — stacked LightGBM is the frozen model for the gold run.**

**Reasoning:** it is the best candidate on all expanded sources (accuracy 0.799,
paired gain over plain logistic +0.120 [0.099, 0.142]) and on the non-arXiv
subset, where its lower interval bound is above every other model's point
estimate. Its definition precision (0.73 overall, 0.84 non-arXiv) also suits a
knowledge bundle where a wrong "definition" is worse than a missed one. The
choice uses development data only; the test set has not been read.

### `gold_eval.py` now matches the selected training setup

- defaults: `--model stacked_lightgbm`, training rows
  `ml/out/arxiv_expansion/train_blocks.jsonl`, context catalogue
  `ml/out/arxiv_expansion/context_blocks.jsonl`;
- source weights (1 / rows from that source, mean one), as in the selection
  runs; `--unweighted` exists only for ablation;
- refuses to run if any training row belongs to a frozen test group.

A smoke fit on training data only (4,254 rows, three held-out training sources)
completed in 18 s. The test sample has still not been evaluated.

---

## Phase ML2.12: LaTeX Audit Alignment, Heading-rule Fixes and Training Regeneration

**Date:** October 13, 2026

**Goal:** close item 1 of the remaining work: explain the 294 unmatched audit
labels and fix the heading and alignment issues they reveal.

### Why labels were unmatched

| Reason | Labels |
|---|---:|
| 8-word anchor found in several LaTeX environments (repeated phrasing, restated results) | 123 |
| Body under 8 words (formula-heavy statements) | 88 |
| No 8-word match (maths tokenised differently: `\exp`, `\operatorname{LCS}`, inline `$…$`) | 80 |
| Anchor only after word 24 | 3 |

### Alignment changes (`ml/eval/latex_audit.py`)

The exact 8-word anchor stays the first method. Fallbacks run only when it fails,
and each must leave a single source label:

- **nested:** several anchored environments, one nested in the others (a claim
  inside a proof) → innermost;
- **label:** several anchored environments that all carry the same label;
- **short:** bodies under 8 words use exact 5-word anchors, unique environment;
- **overlap:** no anchor at all, ≥ 80% of the first 40 words in one environment,
  ≥ 0.2 ahead of the runner-up.

LaTeX operator commands (`\exp`, `\lim`, `\sup`, …) keep their names so they match
the PDF text. Each decision records its method, and the report gives
per-method counts so no fallback can hide errors.

### Heading-rule fixes (`ml/data/heading_rules.py`)

| Issue found in review | Fix | Training rows affected |
|---|---|---:|
| "(see Definition 1) in the setting…" wrapped onto a new line read as a definition heading (hyperref colour gave font-change evidence) | number followed by an unbalanced `)` is rejected | 1 |
| Name with nested brackets, "Lemma 16 (… Hall et al. (2014))", cut at the inner `)`; `) .` left in the body | one level of nesting in heading names | 32 |
| "Proof of Lemma B.3." stopped at "B."; `3 .` left in the body | appendix-number lookahead in the proof-of pattern | 27 |
| "Proof sketch." left "sketch" in the body | "sketch" is part of a proof heading | 6 |

Seven regression tests cover these cases. Frozen test-set blocks were **not**
re-extracted: `to_label.jsonl` block IDs depend on them, so the gold run uses the
heading labels as originally extracted (no test block contains the
cross-reference bug).

### Regeneration (training data only)

All 120 arXiv PDFs and the 40 original training PDFs were re-extracted
(`repair_training --out ml/out/ml212`; `expand_training --base-blocks
ml/out/ml212/blocks.jsonl`). Previous outputs are kept in
`ml/out/arxiv_expansion/pre_ml212/`. Row count stays 4,477; arXiv weak labels
change by −1 definition, −1 proof and +2 theorem. Block IDs are positional, so a
removed false heading shifts later IDs in that paper; labels are preserved.

### Results

LaTeX audit, 20 papers, 740 automatic labels:

| | Before (ML2.E5) | After |
|---|---:|---:|
| Matched to a LaTeX environment | 448 (60.4%) | **619 (83.6%)** |
| Agreeing | 446 | 616 |
| Precision on matched labels | 0.996 | **0.995**, paper-bootstrap 95% CI [0.984, 1.000] |
| Unmatched | 294 | 121 |

By method (agreeing / matched): anchor 449/450, nested 13/13, label 113/115,
short 27/27, overlap 14/14. All three mismatches are statements that sit inside a
LaTeX `proof` environment (a restated "Theorem 5" twice, a bold "Claim 27" with
no claim environment). The heading rule's "theorem" describes those blocks
better; they are reported as mismatches anyway. The 121 still unmatched were
reviewed by heading and opening text: all are genuine headings with the correct
role; they fail alignment because bodies are formula-only, results are restated
in appendices, or macros differ. No recall is measured: LaTeX environments that
the heading rule missed are not counted.

Expanded development comparison on the regenerated rows (5 scored classes):

| Model | Accuracy | Macro F1 | 95% CI | Definition P / R / F1 |
|---|---:|---:|---|---|
| Plain logistic | 0.679 | 0.458 | [0.429, 0.491] | 0.87 / 0.11 / 0.19 |
| Balanced logistic | 0.703 | 0.630 | [0.583, 0.675] | 0.58 / 0.58 / 0.58 |
| Word + character | 0.721 | 0.683 | [0.643, 0.724] | 0.55 / 0.58 / 0.56 |
| Cue logistic | 0.718 | 0.694 | [0.655, 0.726] | 0.63 / 0.60 / 0.61 |
| **Stacked LightGBM** | **0.799** | **0.755** | [0.725, 0.789] | **0.73 / 0.64 / 0.68** |

Paired against plain logistic (124 source groups): stack +0.120 accuracy
[0.099, 0.142], +0.528 definition recall [0.460, 0.589]. Changes from ML2.E2 are
within 0.013 for every model; the ranking is unchanged.

Remaining boundary issue, not fixed: a block sometimes absorbs a following
footnote or section heading ("Claim 27 … 10 A vertex is called universal…").

### Files created / modified

- **Data:** `ml/data/heading_rules.py` (four fixes), `ml/data/expand_training.py`
  (`--base-blocks`).
- **Evaluation:** `ml/eval/latex_audit.py` (fallback alignment, operators,
  per-method report), `ml/eval/gold_eval.py` (expanded weighted training,
  test-group guard, frozen default model).
- **Tests:** `ml/tests/test_heading_rules.py` (+5), `ml/tests/test_source_expansion.py`
  (+1, one expectation updated: identical same-label environments now resolve).
- **Results (regenerated):** `arxiv_label_audit.json`, `arxiv_expansion_summary.json`,
  `classifier_expanded_cv.json`, `classifier_expanded_features_cv.json`,
  `expanded_paired_comparison.json`.

### Testing

- `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider`: **276 passed**.
- Regeneration log: `ml/out/ml212_regenerate.log` (about 6 minutes end to end).

**Next goal to achieve:** user approval of the 300 draft test labels, then the
single milestone gold run with the frozen stacked LightGBM.

---

## Phase ML2.13: Test-label Review and the First Milestone Gold Run

**Date:** October 13, 2026

### Labels used as gold, and what they are

At the user's request the assistant reviewed its own 300 draft labels instead of
a human review. Rules applied in the review:

- **definition:** fixes the meaning of a named concept, including security games
  and named assumptions; in a mixed block a definition taking roughly a third or
  more of the block wins, because definitions are what the product extracts;
- **notation:** symbol conventions and auxiliary `:=` quantities with no named concept;
- otherwise the role that takes most of the block; fragments take the role of
  what they continue.

The 61 flagged blocks were re-read in full text (the first pass saw long blocks
truncated): 7 changed. A seeded random 50 of the 239 unflagged blocks were
re-read: 1 changed (49/50 kept). Changes, by sample index: 37 other→definition
(SUF-CMA explained), 63 other→definition (modified Weil pairing), 69
notation→other, 94 other→notation, 109 other→definition (admissible encoding),
124 proof→example (mostly exercise solutions), 148 other→notation, 212
other→notation. Output: `ml/labels/gold_labels.jsonl` (ignored).

⚡ **Design Decision — the gold labels are single-annotator AI labels, and are
named and reported that way.**

**Reasoning:** the plan called for independent human labels. These labels are
independent of the weak labels and the classifier (the annotator never saw
either), but they come from one AI annotator reviewing its own draft. Kappa 0.966
between draft and review is self-consistency, **not** inter-annotator agreement.
A human check of a random subset (e.g. 50 blocks with Cohen's kappa) would
upgrade these numbers; until then every gold figure below carries this caveat.

### The run

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.gold_eval --gold ml/labels/gold_labels.jsonl --compare ml/labels/assistant_labels.jsonl --frozen-test-milestone --out ml/results/gold_merged_stacked_lightgbm.json
```

Frozen model: stacked LightGBM (ML2.11), trained on all 4,477 expanded,
source-weighted training rows. Merged scheme; macro F1 over definition, theorem,
proof, example and algorithm (all present in the sample). Intervals resample
the 15 test files. The sample is enriched (100 headed, 100 prose-definition
candidates, 100 other unheaded), so these are diagnostic rates, not population
estimates.

| System | Accuracy | 95% CI | Macro F1 | 95% CI |
|---|---:|---|---:|---|
| Heading rule (fires on 33.3% of blocks) | 0.970 when it fires | [0.923, 1.000] | — | — |
| Classifier alone | 0.547 | [0.451, 0.611] | 0.589 | [0.483, 0.636] |
| **Two-stage (product)** | **0.603** | [0.498, 0.665] | **0.659** | [0.547, 0.707] |

Two-stage per class (precision / recall / F1, support): definition
0.88 / 0.33 / 0.48 (67); theorem 0.73 / 0.88 / 0.80 (41); proof 0.61 / 0.96 /
0.74 (56); example 0.27 / 0.76 / 0.40 (25); algorithm 0.91 / 0.83 / 0.87 (12);
other 0.71 / 0.40 / 0.52 (99, unscored).

**Prose definitions** (gold definition, no heading): 61 in 10 files.
Recall **0.262** [0.159, 0.365]; precision on unheaded blocks **0.842**
[0.706, 1.000]. Two-stage accuracy by stratum: headed 0.97, prose candidates
0.47, other unheaded 0.37.

### What the errors show

Two-stage confusion, gold rows → predicted:

- gold definition (67): 22 definition, 19 proof, 11 example, 11 other, 3 theorem, 1 algorithm;
- gold other (99): 40 other, **39 example**, 10 proof, 9 theorem, 1 definition.

⚡ **Finding — the training data contains no ordinary prose.**

Every training row comes from a block with a formatted heading, because
unlabelled is not treated as "other". At test time the classifier meets
discussion, introductions, reference lists and prose definitions, which have no
counterpart in training, and assigns them to the nearest headed role (often
example or proof). Development scores (0.80 accuracy) were measured on headed
blocks only and do not transfer to unheaded text. The headed path is solid
(heading rule 0.97; theorem/proof/algorithm F1 0.74–0.87); the unheaded path is
the weak point.

Positive for the product: definition precision is high (0.88 overall, 0.84 on
prose), so a bundle built from this model would contain few wrong definitions;
it would miss about three quarters of prose definitions.

### Consequences for the test set

The frozen test set has now been read once for this model. It must not guide
the next changes; the next model is chosen on development data, and any second
gold read is reported as a second read.

### Files

- **Evaluation result (created):** `ml/results/gold_merged_stacked_lightgbm.json`
  (numbers only).
- **Labels (ignored):** `ml/labels/gold_labels.jsonl`.

**Next goal to achieve:** ML2.14, training signal for unheaded prose:
unlabelled blocks as a noisy "neither" class (positive–unlabelled learning,
Elkan & Noto 2008), a prose-definition-specific cue set, and a precision-first
threshold for the bundle, all selected on development data with a held-out
development measure that includes unheaded blocks.

---

## Phase ML2.14: Training Signal for Unheaded Prose (first step)

**Date:** October 13, 2026

**Goal:** fix the ML2.13 finding that training contained no unheaded prose,
choosing on development data only. The frozen test set was not read.

### Development set with unheaded blocks

`ml/data/sample_dev_unheaded.py` draws 240 unheaded blocks from **training
sources only** (74 sources; frozen test and excluded groups rejected): four
cells of 60, {original sources, arXiv} × {prose-definition candidate, other}.
The assistant labelled them with the ML2.13 rules (40 flagged uncertain); labels
are in `ml/labels/dev_labels.jsonl` (ignored). Counts: other 140, definition 44,
notation 20, proof 26, example 4, algorithm 3, theorem 3, so 64 merged
definitions. Even among cue-matching candidates half are not definitions (50 of
120 are other, 16 are proofs: "define" is common inside proofs).

### Three fixed variants (`ml/eval/unheaded_cv.py`)

Frozen stacked LightGBM with source weights, scored out of fold: a dev block is
predicted only by a model that never saw its source and is never used as a
negative.

- **A headed_only:** today's training rows.
- **B unlabelled_other:** plus unheaded blocks from each training source as
  "other", one per headed row (naive positive–unlabelled learning).
- **C reliable_negatives:** as B, but blocks matching the prose-definition cue
  regex are left out of the negatives (two-step PU: reliable negatives only).

| Variant | Dev accuracy | 95% CI | Def. precision | Def. recall | 95% CI | Other recall | Headed accuracy |
|---|---:|---|---:|---:|---|---:|---:|
| A headed_only | 0.396 | [0.332, 0.465] | 0.73 | 0.297 | [0.180, 0.410] | 0.37 | 0.799 |
| B unlabelled_other | 0.621 | [0.549, 0.688] | 1.00 | 0.094 | [0.020, 0.170] | 0.99 | 0.700 |
| C reliable_negatives | **0.650** | [0.586, 0.711] | 0.76 | 0.250 | [0.143, 0.362] | 0.94 | 0.726 |

**Readings.**

1. The development set reproduces the test finding (A: definition recall 0.30
   on dev, 0.26 on test), so it is a usable proxy.
2. Negatives fix the "ordinary prose becomes example/proof" error: other recall
   0.37 → 0.94 with C, dev accuracy 0.40 → 0.65 (non-overlapping intervals).
3. They do not find more definitions; B collapses almost everything to other.
4. Headed accuracy drops (0.80 → 0.73), which does not matter for the product:
   headed blocks are labelled by the heading rule (0.97 on test). The classifier
   only needs to be good on unheaded blocks.

### How much do simple rules carry? (dev set)

| Rule | Precision | Recall |
|---|---:|---:|
| Prose cue regex used for sampling | 0.43 | 0.81 |
| Strong cues ("is called", "we say", "is defined as", `:=`, "denote by") | 0.54 | 0.42 |
| Strong cues and not starting with Proof/Since/Hence/By | 0.58 | 0.41 |

Block-level italics barely separate classes (italic in 83% of definitions, 60%
of non-definitions) because mathematics is italic too.

⚡ **Finding — the bottleneck is positive examples of prose definitions.** The
only definitions in training are headed "Definition 2.1." blocks, whose wording
differs from prose ("we say a graph is *bipartite* if…"). Neither negatives nor
the current features close that gap.

### Files

- **Data (created):** `ml/data/sample_dev_unheaded.py`.
- **Evaluation (created):** `ml/eval/unheaded_cv.py`; `ml/results/unheaded_cv.json`.
- **Models (modified):** `definition_features.py` (`StackedLightGBM.predict_proba`).
- **Tests (created):** `ml/tests/test_unheaded.py` (4); 280 Python tests pass.

### Positive signal for prose definitions: emphasis, sentences and LaTeX

At the user's request three independent kinds of evidence were added.

1. **Emphasis (`ml/data/emphasis.py`).** Words set in a different text style from
   the block's own body (italic in roman text, upright `\emph` in an italic
   theorem), excluding maths fonts (CMMI, CMSY, LMMathItalic, MSBM, …) and the
   block's heading. It reads spans inside an existing block's bounding box, so
   no re-extraction is needed and frozen test block IDs are unchanged. 9,812 of
   29,161 training blocks contain emphasis. On its own it is weak (59% of
   definitions vs 40% of others: emphasis also marks paragraph titles, journal
   names and stress), so it is used per sentence.
2. **Sentence-level detection (`ml/models/sentences.py`,
   `ml/models/prose_definitions.py`).** Block text is split into sentences
   (abbreviation- and numbering-aware). Each sentence gets TF-IDF words plus
   named features: nine defining cues, emphasis in the sentence, emphasis with a
   cue, proof-style openings, subject openings, length, position and category.
   A balanced, source-weighted logistic regression scores sentences; a block
   scores its best sentence.
3. **LaTeX positives (`ml/data/latex_definitions.py`).** In the 20 LaTeX sources,
   sentences outside theorem/proof environments with an emphasis command and a
   defining cue: 97 found, 83 aligned uniquely to PDF sentences in 19 papers
   (7 ambiguous, 6 unmatched, 1 duplicate). A spot check of 20 found about 16
   clean definitions; the rest are near misses ("is defined in an open interval",
   a misaligned "Hence …", "so-called").

Training sentences per fold: headed definition/notation sentences that carry a
cue or emphasis (positives), optionally the LaTeX positives, and sentences from
reliable-negative unheaded blocks and headed theorem/proof/example/algorithm
blocks (negatives); about 385 positives and 12,700 negatives in fold 0.

### Correcting the target: "contains a definition"

Reading the detector's highest-scoring "false positives" showed that most were
real definitions inside mixed blocks that the role labels called other ("The
Rosenbrock function is defined as …", "is referred to as the encoder", "is called
experts", "Digital identity, which can be defined as …"). Role labels pick one
role per block; the product needs to know whether a block **contains** a
definition and which sentence it is.

⚡ **Design Decision — a separate binary label, applied to every block.**

**Reasoning:** to avoid relabelling only the model's errors, every dev block not
already labelled definition/notation was reviewed through its candidate defining
sentences with one rule: yes if a sentence states what a named term or symbol
means (local notation included); no for references to definitions elsewhere,
"define" in its ordinary sense, announcements without content, and statements
of results. 36 of 85 candidate blocks became yes; 100 of 240 dev blocks contain
a definition. Role labels are unchanged. The frozen test labels need the same
field, added blind to predictions, before the next milestone read.

One cue was added after reading dev errors: a slide/bullet **gloss** ("Round-Trip
Time (RTT) (definition): …"). Dev scores are therefore somewhat optimistic.

### Results on "contains a definition" (240 dev blocks, out of fold)

| Method | Precision | Recall | F1 | Average precision |
|---|---:|---:|---:|---:|
| A headed-only classifier | 0.85 | 0.22 | 0.35 | — |
| C reliable negatives | 0.95 | 0.20 | 0.33 | — |
| Strong-cue rule | 0.86 | 0.49 | 0.62 | — |
| Detector, all evidence (D1) | 0.76 [0.66, 0.86] | 0.57 [0.46, 0.68] | 0.65 | 0.80 |
| **Detector without LaTeX positives (D2)** | 0.79 [0.69, 0.88] | 0.59 [0.48, 0.70] | **0.67** | 0.78 |
| Detector without emphasis (D3) | 0.84 [0.75, 0.92] | 0.47 [0.37, 0.57] | 0.60 | 0.78 |

Precision at fixed thresholds for D2: 0.4 → 0.88 / 0.51; 0.6 → 0.92 / 0.45;
0.8 → 0.92 / 0.34. The strongest learned hand weights are emphasis (+1.63), a
subject opening (+0.99), the gloss cue (+0.80) and "we say" (+0.61).

**Readings.**

- The detector more than doubles prose-definition recall of the classifier at
  similar precision (0.51 vs 0.22 at about 0.86–0.88 precision).
- Against the strong-cue rule the gain is modest: about 2–4 points of precision
  at equal recall, and more reachable recall at lower thresholds.
- Emphasis adds recall (0.47 → 0.59 at cross-fitted thresholds).
- The 83 LaTeX positives do not help beyond headed-definition sentences
  (0.651 vs 0.674 F1, within noise); they remain an ablation result.

⚡ **Design Decision — frozen choice for the next milestone.** Detector D2
(emphasis on, no LaTeX positives) decides definitions in unheaded blocks at
threshold **0.4** (highest dev recall with dev precision ≥ 0.85); variant C
assigns the other roles; the heading rule handles headed blocks. Chosen on
development data only.

### Files (ML2.14 total)

- **Data (created):** `ml/data/sample_dev_unheaded.py`, `ml/data/emphasis.py`,
  `ml/data/latex_definitions.py`.
- **Models (created):** `ml/models/sentences.py`, `ml/models/prose_definitions.py`;
  `definition_features.py` gained `predict_proba`.
- **Evaluation (created):** `ml/eval/unheaded_cv.py`, `ml/eval/prose_definition_cv.py`.
- **Results (created):** `ml/results/unheaded_cv.json`,
  `ml/results/prose_definition_cv.json`, `ml/results/latex_definition_positives.json`.
- **Tests (created):** `ml/tests/test_unheaded.py` (4), `ml/tests/test_prose_definitions.py` (7);
  **287 Python tests pass**.
- **Ignored outputs:** `ml/labels/dev_to_label.jsonl`, `ml/labels/dev_labels.jsonl`,
  `ml/out/ml214/` (emphasis maps, LaTeX positives, predictions).

```powershell
.\.venv-ml\Scripts\python.exe -m ml.data.sample_dev_unheaded
.\.venv-ml\Scripts\python.exe -m ml.eval.unheaded_cv
.\.venv-ml\Scripts\python.exe -m ml.data.emphasis --blocks ml/out/arxiv_expansion/context_blocks.jsonl --out ml/out/ml214/emphasis_train.jsonl
.\.venv-ml\Scripts\python.exe -m ml.data.latex_definitions
.\.venv-ml\Scripts\python.exe -m ml.eval.prose_definition_cv
```

**Next goal to achieve:** add the "contains a definition" field to the 300 test
labels (blind to predictions), extend `gold_eval.py` to the frozen two-stage +
detector pipeline, and run the second milestone read, reported as a second read.

---

## Phase ML2.15: Second Milestone Read with the Frozen ML2.14 Pipeline

**Date:** October 13, 2026

### Preparing the test labels

The 300 test labels gained the binary **contains_definition** field with the
ML2.14 rule (a sentence states what a named term or symbol means; references,
ordinary uses of "define", announcements, theorem hypotheses and exercise
solutions do not count). Every test block not already labelled
definition/notation was reviewed through its candidate sentences (108 blocks);
33 became yes, giving 100 of 300. No per-block test prediction had been seen;
only the ML2.13 aggregate results were known. Role labels are unchanged.

### The run

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.gold_pipeline --frozen-test-milestone
```

`ml/eval/gold_pipeline.py` fits the frozen pipeline on all training data
(4,477 headed rows, 4,264 reliable negatives; detector on 458 positive and 16,098
negative sentences) and refits the ML2.13 pipeline as a reference, so both read
the same blocks. Test-block emphasis comes from the block-box annotation (no
re-extraction; IDs unchanged). This is the **second read** of the frozen test
set. Intervals resample the 15 test files.

### Results

"Contains a definition" (100 positives in 300 blocks):

| | Precision | 95% CI | Recall | 95% CI | F1 |
|---|---:|---|---:|---|---:|
| ML2.13 pipeline, all blocks | 0.96 | [0.90, 1.00] | 0.24 | [0.15, 0.34] | 0.38 |
| **ML2.14 pipeline, all blocks** | **0.86** | [0.78, 0.96] | **0.56** | [0.45, 0.67] | **0.68** |
| ML2.13 classifier, unheaded blocks | 0.95 | [0.85, 1.00] | 0.21 | [0.13, 0.31] | 0.35 |
| **Detector, unheaded blocks** | **0.85** | [0.76, 0.96] | **0.60** | [0.47, 0.71] | **0.70** |

Detector precision/recall on unheaded test blocks by threshold: 0.2 → 0.79 / 0.62;
0.4 → 0.85 / 0.60; 0.6 → 0.85 / 0.49; 0.8 → 0.93 / 0.44. The dev choice (0.4)
sits near the best trade-off on test as well.

Roles (merged scheme, macro F1 over five classes):

| Pipeline | Accuracy | 95% CI | Macro F1 | 95% CI | Prose-definition recall |
|---|---:|---|---:|---|---:|
| ML2.13 (refitted; reproduces the first read) | 0.603 | [0.498, 0.665] | 0.659 | [0.547, 0.707] | 0.262 |
| **ML2.14** | **0.753** | [0.694, 0.817] | **0.769** | [0.626, 0.797] | **0.623** [0.457, 0.795] |

Per-class F1 changes: definition 0.48 → 0.67, example 0.40 → 0.63, other 0.52 →
0.75, theorem 0.80 → 0.90, proof 0.74 → 0.78, algorithm 0.87 → 0.87. Accuracy by
stratum: headed 0.97 → 0.97, prose candidates 0.47 → 0.61, other unheaded 0.37 → 0.68.

**Reading.** The development estimates transferred: dev "contains a definition"
0.88 / 0.51 at threshold 0.4, test 0.85 / 0.60 on unheaded blocks. Accuracy
intervals for the two pipelines do not overlap. The precision cost (0.96 → 0.86)
is the expected trade: the bundle now finds more than twice as many definitions,
and about one in seven detected blocks is wrong.

**Caveats.**

- Second read of the test set; the ML2.14 choices were made on development data,
  but the overall direction (more recall for prose definitions) was motivated by
  the first read.
- Gold labels are single-annotator AI labels; contains_definition was added after
  the first read's aggregate results were known (but blind to predictions).
- The sample is enriched; rates are diagnostic, not population estimates.

### Files

- **Evaluation (created):** `ml/eval/gold_pipeline.py`;
  `ml/results/gold_ml215_pipeline.json` (numbers only).
- **Labels (ignored):** `ml/labels/gold_labels.jsonl` gained `contains_definition`.

**Next goal to achieve:** ML3, the OKF bundle writer: one concept file per
detected definition (defining sentence, page provenance, `status: draft`) and per
headed theorem-like block, using this pipeline; optional human check of 50 gold
labels to replace "single-annotator AI" with a measured agreement.

---

## Phase ML2.16: Independent Second Annotation and Adjudicated Gold Labels

**Date:** October 13, 2026

**Goal:** replace single-annotator AI labels with two independent annotations,
a measured agreement, and adjudicated gold labels.

### Procedure

- `ml/labels/ANNOTATION_GUIDE.md` (committable; invented examples, no PDF text)
  states the seven roles, hard-case rules and the `contains_definition` rule.
- `ml/data/export_for_annotator.py` writes six self-contained batch prompts of
  50 blocks (guide + blocks + output format) to the ignored
  `ml/labels/second_annotator/`, with an opening prompt in `PROMPT.md`. No
  existing label, weak label or prediction is included: the annotation is blind.
- The user ran the batches through a different AI; all 300 lines were returned
  and validated (`ml/eval/compare_annotators.py`).

### Agreement (annotator A = this project's labels, B = second AI)

| Field | Cohen's kappa | Raw agreement |
|---|---:|---:|
| Seven roles | **0.806** | 0.843 |
| Merged roles (notation → definition) | **0.826** | — |
| contains_definition | **0.645** | 0.827 |

Most frequent role disagreements: other→definition (9), definition→other (4),
definition→notation (4), other→example (4). Saved in
`ml/results/annotator_agreement.json`.

### Adjudication

The 85 blocks with any disagreement were decided against the written guide, one
reason recorded per block (`disagreements.jsonl`, ignored). Annotator A did the
adjudication, so the split is reported: **44 decided for B, 38 for A, 3 mixed**
(label from one, contains_definition from the other). B was more consistent on
local notation inside proofs ("Write e − u + v for …", "Let P(n) be the
statement …") and on slide titles; A's readings were kept for fragments that
start a definition, theorem hypotheses and exercise-vs-definition proportions.
Result: `ml/labels/adjudicated_labels.jsonl` (215 agreed + 85 adjudicated);
120 of 300 blocks contain a definition (was 100).

### Frozen pipelines re-scored on adjudicated labels (same models, labels changed)

| | Single-annotator labels | Adjudicated labels |
|---|---|---|
| ML2.13 pipeline: role accuracy / macro F1 | 0.603 / 0.659 | 0.600 [0.505, 0.658] / 0.634 |
| **ML2.14 pipeline: role accuracy / macro F1** | 0.753 / 0.769 | **0.730** [0.653, 0.804] / **0.723** [0.595, 0.773] |
| Heading rule accuracy when it fires | 0.970 | 0.930 |
| ML2.14 contains-definition, all blocks P / R | 0.86 / 0.56 | **0.88 / 0.48** |
| ML2.13 contains-definition, all blocks P / R | 0.96 / 0.24 | 1.00 / 0.21 |
| Detector, unheaded blocks P / R | 0.85 / 0.60 | **0.86 / 0.56** [0.41, 0.70] |
| Prose-definition recall (roles) | 0.26 → 0.62 | 0.27 → **0.65** |

**Reading.** The improvement survives independent labels: role accuracy +0.13,
contains-definition recall more than doubled at higher precision. The absolute
numbers drop a little because the adjudicated set counts more definitions,
mostly local notation inside headed proofs. The pipeline cannot report those:
a headed block takes the heading rule's role, so 29 of the 120 positives (in
headed blocks) are structurally out of reach. For the knowledge bundle, proof-local
notation has little value, so the unheaded-detector row (0.86 / 0.56) is the
relevant one.

### Files

- **Created:** `ml/labels/ANNOTATION_GUIDE.md`, `ml/data/export_for_annotator.py`,
  `ml/eval/compare_annotators.py`, `ml/tests/test_compare_annotators.py` (5 tests;
  292 Python tests pass), `ml/results/annotator_agreement.json`,
  `ml/results/gold_ml215_pipeline_adjudicated.json`.
- **Modified:** `.gitignore` (ignore `ml/labels/second_annotator/`).
- **Ignored:** batch prompts and replies, `disagreements.jsonl`, `adjudicated_labels.jsonl`.

From here on, `ml/labels/adjudicated_labels.jsonl` is the gold set.

**Next goal to achieve:** ML3, the OKF bundle writer, using the frozen pipeline.

---

## Phase ML3.1: OKF Bundle Writer, Links and Conformance

**Date:** October 14, 2026

**Goal:** turn the frozen ML2.14 pipeline into an Open Knowledge Format v0.2
bundle per PDF, conformant to the spec, ready for the Knowledge panel and for
retrieval in ML4.

### Spec facts used (OKF v0.2, read from the published SPEC.md)

A concept is any non-reserved `.md` file with YAML frontmatter; only `type` is
required. Optional families: `title`, `description`, `resource`, `tags`;
`sources` (entries with `id`, `resource`, `title`); `generated: {by, at}`;
`verified: [{by, at}]` (a bare mapping counts as one entry); `status` in
draft/stable/deprecated. Actors are `<producer>/<version>`, `human:<id>` or
`process:<id>`; timestamps are ISO 8601 with a UTC offset. Links are plain
markdown links; broken links are tolerated. `index.md` and `log.md` are
reserved; only the bundle-root index may carry `okf_version`. Conformance: every
concept file has parseable frontmatter with a non-empty `type`, and reserved
files follow their structure. Producers may add extension keys.

### Implementation (`ml/okf/`)

- **`pipeline.py`:** the frozen ML2.14 pipeline as one saved object, trained
  exactly as in ML2.15 (same counts: 4,477 headed rows, 4,264 reliable negatives,
  16,556 detector sentences). Saved to the ignored `ml/models/artifacts/`
  because its vocabulary is learned from copyrighted text. `classify(blocks,
  emphasis)` returns, per block, the role, whether it contains a definition, the
  method (heading / detector / classifier), the score and every defining sentence
  at or above the 0.4 threshold. The stacked model now fits its text sub-model
  once at training time instead of on every predict call (deterministic, so
  predictions are unchanged).
- **`bundle.py`:** PDF → extractor blocks → emphasis → pipeline → concepts.
  - Headed definition, theorem-like (theorem, lemma, proposition, corollary,
    claim, conjecture), algorithm and notation blocks become concepts; examples,
    exercises, remarks and notes do not. A proof adds "Proof on page N" to the
    result before it.
  - Each defining sentence found by the detector (up to three per block) becomes
    a `Definition` titled by the defined term, or a `Notation` titled by its
    symbol when no term can be named.
  - Title rules: emphasised term nearest after the defining cue; cue patterns
    ("is called X", "we say … is X", "we call [object] an X", "define the X");
    the earliest emphasised term for headed definitions; clauses and
    cross-references ("Then", "We observe that", "Section 5") rejected; a defined
    term repeated later keeps its first occurrence; bibliography entries skipped.
  - Frontmatter: `type`, `title`, `description`, `resource`
    `margin://doc/<fingerprint>/page/<n>#bbox=x0,y0,x1,y1`, `tags`, `sources`,
    `generated {by: margin-okf/0.1, at}`, `status: draft`, and a `margin`
    extension key (page, block id, method, confidence). Nothing is written as
    `verified`; only a human Verify action will add that.
  - The fingerprint reproduces PDF.js `fingerprints[0]` (first trailer `/ID`, else
    MD5 of the first 1,024 bytes), so resources point at the document the
    frontend already identifies.
  - Links under "# Uses": numbered references ("by Theorem 3.4", "Definition 2.1")
    resolved within the document, and mentions of defined terms (only specific
    terms: two or more words, or one word of seven or more letters).
  - Root `index.md` (`okf_version: "0.2"`, sections Definitions / Notation /
    Results / Algorithms) and `log.md`; no index for an empty bundle; concept
    files never take the reserved names `index` or `log`.
- **`conformance.py`:** the spec's three rules as errors; broken links, bare
  `verified` mappings, unknown status and offset-less timestamps as warnings.
- **`build_all.py`:** builds and checks every main PDF; numbers-only summary.

### Results

All **48 main PDFs** built in about 4.5 minutes; **48/48 conformant**, no
warnings. 2,245 concepts and 6,587 links: Definition 1,313, Notation 449,
Theorem 212, Algorithm 121, Lemma 77, Corollary 35, Proposition 21, Claim 17.

| Category | PDFs | Concepts | Links |
|---|---:|---:|---:|
| Textbook | 2 | 1,447 | 6,184 |
| Paper | 17 | 305 | 220 |
| Slides | 19 | 255 | 61 |
| Standard | 3 | 177 | 118 |
| Assignment | 4 | 30 | 1 |
| Thesis | 1 | 28 | 1 |
| Solutions | 1 | 3 | 2 |
| Notes | 1 | 0 | 0 |

Four documents give empty bundles (an assignment, course notes, two non-maths
papers), which is the expected outcome for text without definitions.

Bugs found while building: an empty `index.md` failed conformance, and a
Sipser concept titled "index" took the reserved filename `definitions/index.md`;
both fixed with regression tests.

**Quality, by inspection (not yet measured).** On an arXiv paper the Definitions
section reads well (largest common subtrees, height, genealogical order, parent,
plane tree, Bienaymé tree, spine, typical event, real tree). On slides many
defining sentences have no nameable term and fall back to "Notation (page N)",
and an "agreement subtree" sentence still falls back to a page title. Title
accuracy and link precision have no gold set yet; they are measured in ML3.2.

### Files

- **Created:** `ml/okf/__init__.py`, `ml/okf/pipeline.py`, `ml/okf/bundle.py`,
  `ml/okf/conformance.py`, `ml/okf/build_all.py`, `ml/tests/test_okf_bundle.py`
  (7 tests), `ml/results/okf_bundles_summary.json`.
- **Modified:** `ml/models/definition_features.py` (text model fitted once),
  `.gitignore` (`ml/models/artifacts/`).
- **Ignored outputs:** `ml/models/artifacts/okf_pipeline.joblib`, `ml/out/bundles/`.
- **Tests:** 299 Python tests pass.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.okf.pipeline       # train and save once
.\.venv-ml\Scripts\python.exe -m ml.okf.bundle --pdf "<file>.pdf" --out ml/out/bundles/<name> --category paper
.\.venv-ml\Scripts\python.exe -m ml.okf.conformance ml/out/bundles/<name>
.\.venv-ml\Scripts\python.exe -m ml.okf.build_all
```

**Next goal to achieve:** ML3.2: `POST /bundle` on the RAG service, the Knowledge
panel with Verify in Margin, a small gold check of titles and links, and BM25 +
vector hybrid retrieval over passages and concepts.

---

## Phase ML3.2: Bundle Endpoint, Title and Link Gold Check, Hybrid Retrieval

**Date:** October 14, 2026

**Goal:** serve bundles from the RAG service, measure title and link quality
instead of judging them by eye, and build the BM25 + dense retrieval baseline
that ML4's ranker has to beat. The Knowledge panel is the remaining ML3 piece.

### `POST /bundle` (`local-llm/rag-api/okf_api.py`)

- Multipart upload (`file`, optional `category`); returns `fingerprint`,
  `fileName`, `summary` and `files: [{path, content}]`. Needs PDF bytes, not
  extracted text, because block extraction reads fonts and layout.
- Rejects non-PDFs (415), unknown categories (422) and files over 200 MB (413);
  returns 503 when the trained artifact is missing. The pipeline is loaded once.
- `ml/okf/bundle.py` now has `bundle_files()` (files in memory) and
  `write_bundle()` uses it, so the endpoint and the batch build share one path.
- Docker: `../ml` mounted read-only at `/margin/ml`, `MARGIN_ML_ROOT=/margin`,
  `libgomp1` for LightGBM, and scikit-learn/LightGBM pinned to the artifact's
  versions. Docker is optional: the endpoint was tested in `.venv-ml` with
  FastAPI's test client, including a live run on a real paper (200 in 16 s,
  57 files, same counts as the batch build).
- **Bug fixed:** the saved pipeline was pickled as `__main__.FrozenPipeline`
  (trained via `python -m ml.okf.pipeline`), so it loaded only from scripts that
  happened to import that class. The entry point now runs through the importable
  module, and the artifact was re-saved without retraining.

### Gold check of concepts, titles and links

Protocol: `ml/eval/okf_sample.py` draws at most 3 concepts and 3 links per
document. A development sample (seed 1: 127 concepts, 68 links, 44 documents)
was labelled and used to fix title rules; a held-out sample (seed 2: 85
concepts, 41 links, excluding every development item) was drawn from the fixed
build and labelled once. Labels per `ml/eval/okf_sample.py`: `real`
(the block states what its type says), `title` good/partial/bad, `link_ok`.
`ml/eval/okf_gold.py` scores with 95% intervals resampling whole documents;
`ml/eval/okf_carry.py` carries labels to a rebuilt bundle (dropped items and
changed titles are flagged; only changed titles are relabelled). All labels were
assigned by me, a single annotator, so these are not agreement-checked numbers.

| Sample | Concept precision | Title good | Title usable | Link precision |
|---|---|---|---|---|
| Development, ML3.1 build | 0.677 [0.567, 0.780] | 0.570 | 0.640 | 0.691 [0.557, 0.821] |
| Development, final build (tuned on) | 0.934 [0.859, 0.987] | 0.803 | 0.972 | 0.952 (n = 21) |
| **Held-out, first read** | **0.929 [0.857, 0.978]** | **0.747** [0.620, 0.861] | **0.924** | **0.756** [0.561, 0.943] |
| Held-out, final build (after 2 fixes it exposed) | 0.938 | 0.776 | 0.921 | 0.811 |

By method on the held-out first read: headed concepts precision 1.00, title good
0.85; detector concepts precision 0.81, title good 0.54.

What changed (all found on the development sample unless noted):
- **Emphasis needs a defining position.** Bold or italic words are accepted as
  the defined term only near a cue, as the sentence subject ("A *shared secret
  key* is ..."), or as a predicate before a condition ("A graph is *viscous*
  if ..."). Slides emphasise names, warnings and headings that define nothing.
- **Headings and lists are not terms.** Enumerators ("a)", "(ii)", "2.1",
  "A.1", bullets) are stripped; generic words ("Theory", "Algorithm",
  "Conclusion", "Hint") rejected; "Term: gloss" accepted only with a
  definitional gloss and never for a question.
- **More patterns:** "refer to X as the TERM", "we call X the TERM at ...",
  "is known as TERM •", "we say ... is TERM against", subject of "A TERM is a",
  "Definition: A TERM is", symbols "denoted as 'X'", "where X denotes",
  "function X is defined as", "define the following matrix: X =".
- **No fallback concepts.** A detector sentence with neither a term nor a symbol
  is no longer written as "Notation (page N)". On the development sample these
  were 36 non-definitions against 15 real ones, and none could be found by name.
- **Unnumbered results get a gist** ("Definition (ACQ)", "Theorem (N(F) is a
  subspace of…)") instead of a bare "Theorem".
- **Links:** a mention inside a longer defined term belongs to that term ("level
  set" inside "lower level set"); concepts from the same block do not link; a
  headed definition links by its name ("Definition (penalty function)" by
  "penalty function").
- **Found on the held-out sample, fixed afterwards:** the same symbol repeated as
  three concepts ("cbRt"); a prose restatement surviving next to the headed
  definition because the name sat only in the heading text. The held-out first
  read above is the honest figure; the final-build row includes these fixes.

Cost: concepts across the 48 PDFs fell from 2,245 to 1,188 (Definition 1,313 →
653, Notation 449 → 52; headed results unchanged), links from 6,587 to 1,591.
On the development sample 15 of 86 real concepts are no longer produced, so the
gain in precision is bought with roughly 17% lower recall of real concepts.
All 48 bundles remain conformant.

### Hybrid retrieval (`ml/retrieval/hybrid.py`, `ml/eval/hybrid_eval.py`)

- Hand-written BM25 (k1 = 1.2, b = 0.75, Lucene-style idf), unit-tested against a
  hand computation; reciprocal rank fusion (k = 60) of BM25 and cosine rankings.
- `hybrid_eval` compares dense, BM25, hybrid and hybrid + concepts (a concept hit
  counts at its page), with the same chunks and embedder as the current-RAG
  baseline. It scores only the train split unless `--frozen-test-milestone`.
- **Smoke run only:** the question file has 2 answerable train questions, so the
  output (`ml/results/hybrid_retrieval_smoke.json`) checks that the harness runs,
  not that any method is better. A real comparison needs the 200-question set.

### Files

- **Created:** `local-llm/rag-api/okf_api.py`, `ml/eval/okf_sample.py`,
  `ml/eval/okf_gold.py`, `ml/eval/okf_carry.py`, `ml/eval/hybrid_eval.py`,
  `ml/retrieval/__init__.py`, `ml/retrieval/hybrid.py`,
  `ml/tests/test_okf_api.py`, `ml/tests/test_hybrid.py`,
  `ml/results/okf_gold_dev_before.json`, `ml/results/okf_gold_dev_final.json`,
  `ml/results/okf_gold_test.json`, `ml/results/okf_gold_test_final.json`,
  `ml/results/hybrid_retrieval_smoke.json`.
- **Modified:** `ml/okf/bundle.py`, `ml/okf/pipeline.py`,
  `ml/results/okf_bundles_summary.json`, `ml/tests/test_okf_bundle.py`,
  `local-llm/rag-api/main.py`, `local-llm/rag-api/requirements.txt`,
  `local-llm/rag-api/Dockerfile`, `local-llm/docker-compose.yml`.
- **Ignored:** `ml/labels/okf_*.jsonl` (quote the PDFs), `ml/out/bundles*`.
- **Tests:** 310 Python tests pass.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.okf_sample --out ml/labels/okf_dev.jsonl --seed 1
.\.venv-ml\Scripts\python.exe -m ml.eval.okf_gold --labels ml/labels/okf_test.jsonl --out ml/results/okf_gold_test.json
.\.venv-ml\Scripts\python.exe -m ml.eval.okf_carry --labels ml/labels/okf_test.jsonl --out ml/labels/okf_test_v4.jsonl
.\.venv-ml\Scripts\python.exe -m ml.eval.hybrid_eval --out ml/results/hybrid_retrieval_train.json
```

**Next goal to achieve:** the Knowledge panel with Verify in Margin (frontend),
and the 200 evaluation questions, without which neither the hybrid comparison
nor ML4's ranker can be measured.

---

## Phase ML3.3: Knowledge Panel with Verify

**Date:** October 14, 2026

**Goal:** show a document's OKF bundle in Margin, jump from a concept to its
place in the PDF, and let the reader record a check as an OKF `verified` entry.

### Implementation

- **Service:** `POST /bundle` also returns `concepts`, one plain record per
  concept file (path, type, title, description, page, bbox, method, confidence,
  proof pages, linked paths), so the browser never parses YAML.
  `local-llm/rag-api/bundle_server.py` serves only `/bundle` and `/health` on
  port 9101 from `.venv-ml`, for machines without Docker or the chat stack.
- **Core (`src/core/knowledge/okf.ts`, pure, 10 tests):** filter and group
  concepts (Definitions, Notation, Results, Algorithms; page order);
  `addVerification` inserts or extends `verified: [{by, at}]` in a concept's
  frontmatter; `appendLog` adds a `**Verification**` line under the day's
  heading in `log.md`; `verifyConcept` applies both and updates the record;
  `carryVerifications` keeps checks across a rebuild for concepts whose path and
  title are unchanged (anything renamed is a new draft).
- **Storage:** its own IndexedDB database `margin-knowledge` (store `bundles`,
  keyed by document id), separate from the library and annotation databases.
- **Panel (`src/components/KnowledgePanel.tsx`):** third dock tab and panel-bar
  button (Mod+Shift+K, also in the command palette). States: no bundle (Build
  knowledge, with the document kind the classifier uses), building (cancellable),
  service not running, ready. Ready lists concepts with type, page, proof page,
  "found in prose" for detector concepts, description and linked concepts;
  clicking scrolls to the concept's region of the original page (following pages
  that were moved, and saying so when the page was deleted). Verify writes
  `verified: {by: human:local, at}`. Export downloads the bundle as a zip of its
  Markdown files; Rebuild keeps unchanged verifications.
- The bundle is built from the original source bytes, so page edits made in the
  organiser do not change concept page numbers; navigation maps original pages
  to the current page records.

### Checks

- 195 Vitest tests and the production build pass; new files lint clean (the
  viewer keeps its 21 pre-existing lint findings, unchanged).
- Python: 310 tests pass; the standalone server returned a real slide deck's
  bundle (16 concepts) with the CORS header in 10 s.
- The UI itself is checked by the user (checklist in the session notes).

```powershell
.\.venv-ml\Scripts\python.exe -m uvicorn bundle_server:app --app-dir local-llm/rag-api --port 9101
npm run dev
```

**Next goal to achieve:** the 200 evaluation questions, then ML4 (learned
ranker over the hybrid candidates).

---

## Phase ML3.4: Evaluation Questions and the Hybrid Retrieval Comparison

**Date:** October 14, 2026

**Goal:** complete the 200-question collection that ML3–ML5 are measured on,
then compare dense, BM25, hybrid and hybrid + concepts retrieval on it.

### Question collection (`ml/eval/questions.jsonl`, git-ignored)

- 200 questions, 15 PDFs (13–14 each), 40 unanswerable, 120 train and 80 test
  questions; `python -m ml.eval.validate_questions --require-complete` reports
  VALID (every quote occurs on a listed physical page).
- PDFs: Steepest Descent and KKT slides, networking Chapter 1, the
  classification lecture, Decision Trees, the side-channel NTT paper, the Deep
  SVDD and TSFM arXiv papers, Sipser (train); NIST FIPS 203, Levin, Boneh–Franklin,
  the resolving-sets paper, the Bayesian sampling slides and the CBDC PKI paper
  (test groups). The 5 existing example questions were kept.
- Types: definition, theorem-lookup, needs-definition, explain, other.
  Questions are paraphrased, not copied from the evidence sentence, so they do
  not favour keyword matching. Unanswerable questions were checked by searching
  the whole document for their key terms first.
- **Caveat:** I wrote the questions myself, after building the retriever, from
  the PDFs' text layers. They were not written by an independent person, so a
  spot check by the user is advisable before ML5's final read.

### Hybrid retrieval on the train split (`ml/results/hybrid_retrieval_train.json`)

95 answerable train questions over 9 documents; same chunks and MiniLM embedder
as the current-RAG baseline; no parameter tuning (BM25 k1 = 1.2, b = 0.75; RRF
k = 60). 95% intervals resample whole documents; paired differences are
per-question differences from dense, resampled the same way.

| Method | Recall@5 | MRR@10 |
|---|---|---|
| Dense (current retriever) | 0.863 [0.796, 0.935] | 0.644 [0.547, 0.759] |
| BM25 | 0.842 [0.745, 0.924] | 0.717 [0.621, 0.806] |
| Hybrid (RRF) | 0.916 [0.842, 0.979] | 0.746 [0.679, 0.818] |
| Hybrid + OKF concepts | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] |

| Paired difference from dense | Recall@5 | MRR@10 |
|---|---|---|
| BM25 | −0.021 [−0.095, +0.053] | +0.072 [−0.034, +0.181] |
| Hybrid | +0.053 [0.000, +0.111] | **+0.101** [+0.024, +0.178] |
| Hybrid + concepts | **+0.074** [+0.011, +0.133] | **+0.117** [+0.040, +0.190] |

Hybrid fusion clearly improves ranking (MRR) over dense retrieval; adding the
OKF concepts as retrievable items improves both measures over dense, with on
average 0.73 concepts among the top 5. Hybrid + concepts versus hybrid alone is
not separately tested and is small. The 80 test questions were not read; they
are reserved for the milestone read.

**Next goal to achieve:** ML4, a learned ranker over the hybrid + concepts
candidates (features: BM25 and cosine scores and ranks, concept type, page
position, cross-encoder score), trained on the train questions and compared
with the hybrid baseline above.

---

## Phase ML3.5: Hybrid Retrieval and OKF Concepts in the Live Assistant

**Goal:** make `/query` use what ML3 built (hybrid retrieval and the reader's
concepts), run the assistant without Docker on a laptop, and re-measure the
live code against the pipeline it replaces.

### What changed

- **No Docker.** `local-llm/rag-api/store.py` gives the service one Qdrant
  client: a server when `QDRANT_URL` is set (the Docker setup), otherwise
  Qdrant embedded in the process with data in `local-llm/data/qdrant`
  (ignored by git). Run from the repository root:
  `.venv-ml\Scripts\python.exe -m uvicorn main:app --app-dir local-llm/rag-api --port 9101`.
- **Local LLM.** `llm_client.py` calls any OpenAI-compatible server with
  `httpx`; the default is Ollama with `qwen2.5:3b-instruct` (1.9 GB), chosen
  for the laptop's limits. `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS` (512)
  and `LLM_TIMEOUT` override it; Docker keeps llama.cpp with Llama 3.1 8B.
  LLM failures return an error answer and are no longer cached as answers.
  `langchain-openai`, `langchain` and `langchain-community` are no longer used.
- **Retrieval** (`retriever.py`, `RETRIEVAL=hybrid_concepts` by default): BM25
  and exact cosine over the scoped passages and the PDF's OKF concepts, fused
  by RRF (`ml/retrieval/hybrid.py`, now also `rrf_scored`). The scoped points
  and their stored vectors are read once and kept until the next write.
  `hybrid` and `dense` (the old behaviour) remain selectable; queries without a
  document scope use dense search. The cross-encoder then reranks 3 × topK
  candidates as before.
- **Concept index** (`concepts_api.py`): `POST /concepts` replaces a PDF's
  concepts with the reader's copy (title, description, Markdown, verified
  flag); `DELETE /concepts/{fingerprint}` removes them. Searchable text is the
  same as in ML3.4 (title, description, defining sentence, body; proof and
  uses excluded), checked by a test against `ml.eval.okf_sample.read_concept`.
- **Verified concepts** get `VERIFIED_BOOST` (1.0) added to their
  cross-encoder logit. Untuned: the evaluation data has no verifications.
- **Citations:** a concept source carries kind, type, title, verified flag and
  its region. The prompt labels each context item
  (`(Definition "regular point", page 27, verified by the reader)`). In Margin
  a concept chip reads "Definition: regular point · p. 27", shows a check when
  verified, and jumps to and highlights the defining region; passage chips keep
  page navigation (their box spans the whole chunk).
- **Sync:** the Knowledge panel sends its bundle to `/concepts` after a build,
  rebuild or verification, and when a saved bundle opens (best effort).
- **Bugs fixed on the way:**
  - The ingest status check referenced an unimported `models` and always
    reported "not indexed", so every open re-ingested the document.
  - The retriever read `pageNumber`, but ingest stores `page`, so sources came
    back without pages and the page scope matched nothing.
  - Concepts are indexed under the Knowledge panel's document id, the chat
    scopes by the ingest id, and the two differ in the app. The ML3.4
    evaluation used the file name for both and could not see this. Concepts now
    join their passages by the PDF fingerprint (found by the end-to-end smoke
    test; covered by a test).

### Live code on the train split (`ml/results/live_rag_train.json`)

`ml/eval/live_rag_eval.py` imports the service's own retriever, concept indexer
and reranker and runs them on in-memory Qdrant (passages from the legacy
chunker over native PDF words; 525 concepts through `index_concepts`). 95
answerable train questions, 9 documents, 24 candidates each, all kept ranked so
MRR@10 is defined.

| Method | Recall@5 | MRR@10 |
|---|---|---|
| Dense + rerank (service before ML3.5) | 0.926 [0.862, 0.979] | 0.775 [0.670, 0.871] |
| Hybrid + concepts, no rerank | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] |
| Hybrid + rerank | 0.916 [0.869, 0.967] | 0.768 [0.666, 0.865] |
| Hybrid + concepts + rerank (service now) | 0.926 [0.881, 0.978] | 0.787 [0.713, 0.867] |

| Paired difference from dense + rerank | Recall@5 | MRR@10 |
|---|---|---|
| Hybrid + concepts, no rerank | +0.011 [−0.042, +0.065] | −0.013 [−0.078, +0.069] |
| Hybrid + rerank | −0.011 [−0.043, +0.022] | −0.006 [−0.021, +0.002] |
| Hybrid + concepts + rerank | +0.000 [−0.043, +0.053] | +0.012 [−0.013, +0.053] |

The no-rerank row reproduces ML3.4 exactly (0.937 / 0.761), so the live code
matches the evaluated method. But ML3.4 compared against dense retrieval
*without* the reranker; the cross-encoder already recovers most of hybrid's
gain, and the new service is not measurably better than the old one at
ranking pages (+0.012 MRR@10, interval includes zero). What ML3.5 adds is
concept citations that point at a defining region and carry the reader's
verification, plus the bug fixes. 0.68 concepts appear among the top 5 on
average.

### End-to-end smoke test

In-process `/ingest` → `/status` → `/concepts` → `/query` with Ollama
`qwen2.5:3b-instruct` on CPU, two train questions: both answers correct with
the answer page ranked first; 10 s and 26 s per query, of which the LLM is
9–25 s and retrieval plus reranking about 1 s. For the LICQ question the
concept "Definition: regular point" (p. 27) is the second source.

### Tests

`ml/tests/test_live_rag.py` (11): concept text parity, replace-on-index,
citable concepts, fingerprint join, page scope, cache invalidation, dense
fallback, status count, prompt labels. `test_baseline.py` now checks the lazy
client in `store.py`. Frontend: `sourceLabel`, `sourceRegion` and
`conceptIndexRequest` tests. 321 Python tests, 198 Vitest tests and the
production build pass.

**Next goal to achieve:** ML4. The bar is now the live pipeline, hybrid +
concepts + cross-encoder (MRR@10 0.787, Recall@5 0.926 on train), not dense
retrieval.

---

## Phase ML4: Learned Ranker — ML4.2 Training Comparison

**Date:** October 17, 2026

**Goal:** finish the train-only leave-one-document-out comparison after changing
page position to use the highest indexed passage page, save the full-training
artifact, and pre-register ML5 before any frozen evaluation.

### Implementation and invariants

- `ml/ranking/features.py`: 27 query-time features covering BM25/cosine
  scores and ranks, fusion, raw cross-encoder logit and relative signals,
  concept type/verification, title and question overlap, length and page
  position. Labels are 2 for an answer-page candidate containing the quote
  (exact whitespace-normalized match or at least 60% quote-token coverage),
  1 for another candidate on an answer page, and 0 otherwise.
- Page position divides by the highest indexed **passage** page for the PDF,
  not the PDF's unavailable page count or the highest returned candidate page.
  `retriever.with_signals` computes it over the indexed scope, keyed by PDF
  fingerprint. A regression checks it still uses page 3 when only page 1 is
  returned, then updates to page 9 after an index write.
- `ml/ranking/ranker.py`: LambdaRank with fixed `PARAMS` (150 trees, seven
  leaves, learning rate 0.05, seed 0); no tuning. Joblib serialization keeps
  the importable model and feature list; loading rejects a different list.
- `ranker_eval` uses the service's own `fill`, retriever and cross-encoder
  over 24 hybrid + concept candidates; pointwise logistic regression is a
  second learned baseline. Each held-out document is scored only by models
  fitted on the other eight documents. The final saved artifact is fitted
  on all training groups, distinct from the out-of-fold scores in the table.
- `RERANK=ranker` is opt-in. The cross-encoder loads lazily, and missing model
  or retrieval signals fall back to cross-encoder ordering. Ranking uses the
  raw CE logit as a feature; the existing confidence score keeps the CE scale
  and existing verification boost. All training verifications are zero, so
  this experiment provides no evidence that verification helps.
- Frozen-data safeguards: `live_rag_eval.load_questions` now routes by the
  manifest's frozen source split **before** PDF evidence validation; test
  evidence is no longer validated by a train-only run. Synthetic regression
  tests cover both modes and a false claimed `split`. `ranker_eval` rejects
  `--frozen-test-milestone` before loading questions because cross-validation
  would fit on test questions. ML5 needs a separate inference-only harness.
- The absent candidate cache was confirmed before the approved rerun, so
  candidates/features are rebuilt with the corrected page feature. Run uses
  cached local models, CPU only, with numerical thread limits of two.

### Corrected-feature training results (`ml/results/ranker_train.json`)

95 answerable training questions, nine documents, 24 candidates. 95% percentile
intervals resample complete documents (2,000 resamples, seed 20261006); paired
differences use the same question outcomes grouped by document. No parameters
were tuned. The original and independent frozen sets were not evaluated.

| Method | Recall@5 | MRR@10 |
|---|---|---|
| Fused hybrid + concepts | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] |
| Cross-encoder | 0.926 [0.881, 0.978] | 0.787 [0.713, 0.867] |
| Pointwise logistic regression | 0.958 [0.911, 1.000] | 0.805 [0.742, 0.871] |
| LambdaRank | 0.968 [0.938, 1.000] | 0.826 [0.770, 0.887] |

| Paired difference from cross-encoder | Recall@5 | MRR@10 |
|---|---|---|
| Fused hybrid + concepts | +0.011 [-0.033, +0.053] | -0.026 [-0.071, +0.020] |
| Pointwise logistic regression | +0.032 [-0.021, +0.082] | +0.018 [-0.022, +0.060] |
| LambdaRank | +0.042 [-0.011, +0.091] | **+0.039 [+0.009, +0.068]** |

**Verdict:** LambdaRank improves MRR over the live cross-encoder in this
development comparison; its paired interval excludes zero. Recall's paired
interval includes zero. Candidate recall is 0.989 (94/95). The corrected run
is close to the first run: LambdaRank Recall 0.958 -> 0.968, MRR 0.813 -> 0.826;
pointwise MRR 0.810 -> 0.805. Fused and CE baselines reproduce exactly. This
is a repeat on the same small development set after a feature correction,
not independent confirmation. Keep `cross_encoder` as default until ML5.

Top gain features: cross-encoder gap 34.9%, RRF 12.1%, cosine gap 8.6%,
cross-encoder reciprocal rank 7.5%, relative BM25 7.3%; page position 4.6%.
These shares describe fitted trees, not causal effects or ablation results.

Saved `ml/models/artifacts/ranker.joblib` (ignored), fitted on all 95 training
groups. Fresh-process load verifies `LGBMRanker`, 27 features and metadata
`questions=95`, `splits=[train]`. SHA-256 of this artifact:
`7e35f36de053c0b970658c769f789bb40fdc423da879256d38890380b5c5571f`.
The candidate cache and run log remain ignored under `ml/out/`.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.ranker_eval --out ml/results/ranker_train.json --save ml/models/artifacts/ranker.joblib
```

### ML5 pre-registration

Recorded in `docs/IMPLEMENTATION_PHASES.md` before test evaluation: fused-only,
cross-encoder and frozen LambdaRank; Recall@5, MRR@10 and explicitly defined
page nDCG@10; original and independent test sets separate and pooled;
document-clustered paired intervals; McNemar supporting analysis; train-only
ablation selection and blind answer grading with separate LLM-run approval.
The default-switch rule requires a positive pooled paired MRR lower bound,
nonnegative MRR/nDCG point differences on each set, and a pooled Recall
lower bound of at least -0.02. Otherwise keep the cross-encoder.

### Remaining ML4 scope

nDCG implementation and train measurement, one-hop link expansion, and optional
distance to the reader's current page remain separate work to scope with the
user. ML4's full demo acceptance is not claimed by this training comparison.
No UI interaction, frozen model evaluation, LLM generation or commit is part
of this step.

### Verification

- Full light Python suite: **332 passed in 50.08 s**, including the corrected
  page feature, ranker serialization, reranking fallback and frozen-data
  safeguards. The initial sandboxed run hung in the existing stub `/bundle`
  test; a 30-second faulthandler trace located the wait in Windows asyncio's
  internal socket-pair creation, before endpoint execution. The complete
  suite passed outside the sandbox. Pytest temporary files use `ml/out/`
  because its sandbox default temporary directory was not writable.
- Frontend: **198 tests passed**; `npm run build` passed (includes `tsc -b`).
  Build warnings remain: outdated Browserslist data, unresolved PDF viewer
  SVG references, mixed static/dynamic imports and a large main chunk.
  No frontend source or dependency changes were made in this step.

---

## Phase ML4.3: Page nDCG and Cached Training Measurement

**Date:** October 17, 2026

**Goal:** complete the train ranking table with the page nDCG definition
pre-registered before ML5. ML4.2 checkpoint committed as `412a30d`, subject
`Complete ML4 ranker evaluation and preregister ML5`. No frozen evaluation or
frontend edits were made in ML4.3.

### Changes

- `ml/eval/metrics.py` is the shared page metric implementation for the
  baseline, hybrid, live-service and ranker evaluators. `METRICS` drives
  their reports and paired bootstrap tables. Recall/MRR definitions are
  unchanged; the original baseline import of `metrics` remains supported.
- Page nDCG@10 gives binary gain to each distinct gold page at its first
  candidate occurrence, discounted by `log2(rank + 1)`. Duplicate passages
  or concepts earn no second credit and still consume candidate ranks.
  Ideal DCG contains all gold pages up to ten, including absent candidate
  pages. Empty gold/candidates return zero; real retrieval evaluation still
  excludes unanswerable questions. Quote-based 2/1/0 labels remain training
  targets, not nDCG gains.
- `ranker_eval --require-cache` refuses missing caches before question/model
  loading. Cache validation checks exact training qid membership, document,
  gold pages and row dimensions before fitting. It does not authenticate old
  feature semantics; changes to feature computation still require rebuilding
  the cache, as ML4.2 did. No hyperparameters/features were changed here.
- Tests cover hand-computed scores, repeated pages, missing gold, rank-ten
  cutoff, more than ten gold pages, zero cases and score bounds; report tests
  cover document-clustered/paired nDCG; stub cross-validation verifies document
  separation. Synthetic tests also reject mismatched or missing caches.

### Training results (`ml/results/ranker_train_ndcg.json`)

User approved the CPU run. Same 95 answerable train questions, nine documents,
24 cached live-service candidates, fixed parameters and leave-one-document-out
as ML4.2. 95% intervals resample whole documents (2,000 draws, seed 20261006).
All Recall/MRR values **and their intervals** reproduce ML4.2 exactly.

| Method | Recall@5 | MRR@10 | Page nDCG@10 |
|---|---|---|---|
| Fused hybrid + concepts | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] | 0.790 [0.731, 0.854] |
| Cross-encoder | 0.926 [0.881, 0.978] | 0.787 [0.713, 0.867] | 0.822 [0.750, 0.893] |
| Pointwise logistic | 0.958 [0.911, 1.000] | 0.805 [0.742, 0.871] | 0.832 [0.767, 0.897] |
| LambdaRank | 0.968 [0.938, 1.000] | 0.826 [0.770, 0.887] | 0.846 [0.788, 0.908] |

LambdaRank minus CE: nDCG **+0.024 [+0.004, +0.044]**, MRR
**+0.039 [+0.009, +0.068]**, Recall +0.042 [-0.011, +0.091]. This supports
MRR and nDCG improvements on the small development comparison, not independent
generalization or answer-quality claims. Keep the cross-encoder default.
The same final-training model remains on disk, SHA-256 unchanged from ML4.2.
No embedder, cross-encoder or LLM loaded in this cached run; no artifact saved.
Historical result files keep their original two-metric reports rather than
inventing nDCG values for rankings they did not retain.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.ranker_eval --require-cache --out ml/results/ranker_train_ndcg.json
```

### Verification and unrelated frontend failure

- Focused ML tests: **34 passed**. Full light suite: **350 passed in 19.11 s**
  outside the sandbox, avoiding the previously diagnosed asyncio hang.
- Production build, including `tsc -b`: **passed**, with the existing
  Browserslist, PDF viewer SVG, mixed import and large-chunk warnings.
- Frontend suite: **197 passed / 1 failed**. The unchanged
  `AnnotationQuadtree` randomized linear-scan comparison failed with fast-check
  seed `-1495291639`. Reproduced deterministically in the ignored diagnostic
  `ml/out/ml43-quadtree-repro.cjs` (`node ml/out/ml43-quadtree-repro.cjs`).
  Four zero-size strokes at the origin force subdivision; a fifth spans
  x=0 to `0.003906250000000001`, y=0. A point query at its right endpoint
  should return the fifth stroke, but returns none. New insertions descend
  into the first **intersecting** child even if the annotation extends outside
  it; query pruning can then skip that child and miss the annotation. This is
  a pre-existing annotation-index issue, not an ML metric regression. No
  rerun-to-green, source patch or test weakening was used to hide it.
- The saved ranker SHA-256 still matches ML4.2. Frozen sets were not evaluated,
  and unrelated frontend documentation changes remain unstaged.

**Next:** scope one-hop concept-link expansion with the user. The annotation
quadtree correctness bug was subsequently repaired in the separate step below.
No UI interaction was performed during ML4.3.

---

## Annotation Index Repair: Preserve Overlaps Across Quadtree Children

**Date:** October 17, 2026
**Status:** Implemented and automated checks pass; manual acceptance pending.

**Problem:** after subdivision, new annotations were inserted into the first
child they intersected, even if they extended beyond it. Query pruning could
then skip that child when searching the annotation's far end. Redistribution
of existing annotations already used containment, so insertion order affected
results. ML4.3's randomized test exposed this with a tiny boundary case, but
ordinary shapes spanning horizontal/vertical quadrant boundaries also fail.

**Fix:** `src/core/annotations/spatial-index.ts` now descends only when the
child fully contains the annotation's bounds. Otherwise the annotation stays
at the parent, stored once. Query intersection semantics and maximum depth
remain unchanged. Keeping spanning annotations at ancestors can require more
candidate checks; this is necessary to preserve correct overlap results.

**Verification:**
- Four new deterministic cases failed before the patch and pass afterward:
  shapes crossing either/both partition axes and the original stroke endpoint
  at `0.003906250000000001` after four zero-size origin strokes.
- Tests check insertion before/after subdivision, no false positives,
  removal/rebuild, and exactly one result for a point on shared child edges.
- The linear-scan property test runs 200 cases with a fresh seed and 200 with
  the original failing seed `-1495291639`.
- All **204 frontend tests in 32 files pass**; **13 quadtree tests pass**.
  Core lint (`npx eslint src/core --max-warnings 0`) passes. The tests import
  both modified modules and exercise their real behavior without a browser.
- Production build (`npm run build`, including `tsc -b`) passes. Existing
  Browserslist/PDF viewer asset/mixed-import/large-chunk warnings remain.
  The ignored standalone reproduction now returns the expected annotation.
- No Python/ML source changes, model evaluation, frozen-test read or commit
  was performed in this repair step. The repair accompanies the ML4 checkpoint.

**Manual check — pending user results:**
1. Open a PDF, draw four short strokes near the top-left, then a long
   horizontal stroke crossing the page's vertical centre line. In whole-stroke
   eraser mode, erase its far-right end: the long stroke should disappear and
   the four short strokes should remain.
2. Undo, then erase the long stroke near its left end: the same entire stroke
   should disappear. Undo should restore it; redo should remove it again.
3. Undo, zoom in and repeat at the far-right end: erasing should still find
   the long stroke. No browser interaction was performed by the assistant.

**Next:** review/manual acceptance, then return to ML4 link-expansion scoping.

---

## Phase ML4.4: Bounded One-Hop Concept-Link Expansion

**Date:** October 17, 2026
**Status:** Complete; implemented and measured on TRAIN.

### Live retrieval

- `ml/retrieval/links.py` reads the bundle writer's `# Uses` links, accepting
  local Markdown paths and rejecting external URLs, traversal, query/fragment
  aliases and backslashes. Duplicate targets are collapsed. Parsing links
  never reads a target file or makes a network request.
- `concepts_api` retains these paths in the concept payload's `uses` metadata;
  embedding text still excludes proof/uses sections, so the original retrieval
  baseline remains comparable. Existing stored concepts need a Knowledge-panel
  sync (reopen/rebuild) to acquire this metadata; missing metadata is a no-op.
- Opt-in `RETRIEVAL=hybrid_concepts_links` shares the live hybrid index and
  original BM25/cosine/RRF signals. Among the original fused top eight, only
  result concepts (theorem/lemma/proposition/etc.) expand. At most four directly
  used definitions/notations are retained, joined by `(pdfFingerprint, path)`
  inside the already scoped index. Cross-PDF names, absent targets, and targets
  outside an explicit page scope cannot expand. Added definitions never become
  seeds, so cycles cannot recurse.
- The eight seed candidates are protected. Dependency targets are included
  first, remaining slots filled in original fused order, then output in
  original order with new items appended. The total CE candidate budget stays
  24. A new target keeps its actual retrieval scores/ranks (zero fusion score
  and a missing-rank sentinel when outside a ranking); no untuned boost is
  added. Its title, page, bbox and verification remain citable.
- `reached_by_link` records provenance. The existing 27 learned features stay
  fixed to isolate candidate expansion from a feature-schema change. The old
  saved ranker remains compatible; its checksum and defaults are unchanged.
  Learning a new link-provenance feature would require a separately controlled
  training comparison. Expansion stays opt-in during this step.

### Pre-registered train comparison

The ML4.4 policy and comparison were added to `IMPLEMENTATION_PHASES.md`
before model evaluation. `ml/eval/link_expansion_eval.py` uses the live `fill`,
concept indexer, retriever and raw cross-encoder, plus `ranker_eval`'s shared
feature/label builder and leave-one-document-out fits. It compares expansion
off/on for fused retrieval, CE, pointwise logistic regression and LambdaRank.
Hyperparameters stay fixed; only predeclared LambdaRank seeds 0/1/2 vary.
The original ranker evaluation retains its seed-0 behavior.

Unique candidate texts share a raw CE logit between paired pools; verification
boosts are not ranker features. Document/fingerprint/path identity, rather
than text alone, determines which candidates are newly added. The report
includes each seed and on-minus-off paired Recall@5, MRR@10 and page nDCG@10
intervals. Seed-mean metrics average each question's outcomes first and then
resample whole documents (2,000 draws, seed 20261006), not seeds as independent
data. These means are robustness summaries, not an ensemble deployed live.
Candidate recall and actual expansion counts are also reported. Primary
expansion comparison is paired LambdaRank MRR, with CE describing the current
default reranker. No best-seed selection or test-guided tuning is allowed.

The separate ignored cache hashes relevant source files, selected training
PDFs/bundles/questions, feature list and expansion policy. Stale caches fail
instead of silently reusing old candidates. `--require-cache` prevents a fresh
model/index build. Frozen-test mode is rejected before question loading. This
tool has no model-save or LLM-generation path.

```powershell
.\.venv-ml\Scripts\python.exe -m ml.eval.link_expansion_eval --out ml/results/link_expansion_train.json
```

### Training comparison (`ml/results/link_expansion_train.json`)

The user approved the CPU run on October 17. It completed in about 6.5 minutes
with two-thread limits and cached local models: 95 answerable TRAIN questions,
nine documents, 24 candidates, leave-one-document-out for seeds 0/1/2. No
hyperparameter or policy changes were made after observing results. The seed-0
off report exactly reproduces ML4.3 values **and intervals** for every method.
The following LambdaRank rows average per-question outcomes across three seeds;
they therefore differ from the historical single-seed ML4.3 row.

| Method / expansion | Recall@5 | MRR@10 | Page nDCG@10 |
|---|---|---|---|
| Fused / off | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] | 0.790 [0.731, 0.854] |
| Fused / on | 0.937 [0.898, 0.978] | 0.761 [0.710, 0.821] | 0.790 [0.731, 0.854] |
| CE / off | 0.926 [0.881, 0.978] | 0.787 [0.713, 0.867] | 0.822 [0.750, 0.893] |
| CE / on | 0.926 [0.881, 0.978] | 0.787 [0.713, 0.867] | 0.822 [0.750, 0.893] |
| Pointwise LR / off | 0.958 [0.911, 1.000] | 0.805 [0.742, 0.871] | 0.832 [0.767, 0.897] |
| Pointwise LR / on | 0.958 [0.911, 1.000] | 0.805 [0.742, 0.871] | 0.832 [0.767, 0.897] |
| LambdaRank / off | 0.961 [0.924, 1.000] | 0.812 [0.743, 0.884] | 0.838 [0.772, 0.906] |
| LambdaRank / on | 0.958 [0.911, 1.000] | 0.810 [0.747, 0.884] | 0.838 [0.777, 0.905] |

| Paired expansion on minus off | Recall@5 | MRR@10 | Page nDCG@10 |
|---|---|---|---|
| Fused | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| CE | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| Pointwise LR | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| LambdaRank | -0.0035 [-0.0208, +0.0103] | -0.0016 [-0.0180, +0.0164] | -0.0002 [-0.0130, +0.0137] |

All intervals resample complete documents (2,000 draws, seed 20261006).

| LambdaRank seed | Recall off / on | MRR off / on | nDCG off / on |
|---|---|---|---|
| 0 | 0.9684 / 0.9579 | 0.8259 / 0.8251 | 0.8461 / 0.8477 |
| 1 | 0.9579 / 0.9579 | 0.8035 / 0.8020 | 0.8335 / 0.8327 |
| 2 | 0.9579 / 0.9579 | 0.8063 / 0.8037 | 0.8353 / 0.8338 |

Expansion marked 23 dependency targets across 13 queries; 12 were new
candidates, across only seven queries (mean 0.126 new candidates/query).
Candidate recall stayed **94/95 = 0.9895 [0.9688, 1.0000]** in both variants.
The small coverage limits what this experiment can establish. Zero CE metric
differences mean no change on these page-based measures, not identical source
lists or proof of answer-quality equivalence. Learned-model differences can
also affect queries whose own pool did not change, because their training
folds contain changed pools from other documents.

**Verdict:** the bounded one-hop policy provides no demonstrated improvement
on this development comparison. LambdaRank's mean point differences are
slightly negative and all paired intervals include zero; do not claim either
a gain or an established harm. Keep expansion **opt-in**, retain the existing
saved ranker and cross-encoder default, and preserve the frozen on/off variant
for the pre-registered ML5 ablation. No threshold/seed/policy tuning follows
these results. LLM answer quality was not measured.

### Verification

Pure-policy tests cover local-path parsing, scope/type checks, duplicate and
cyclic links, seed protection, budgets, missing metadata and stable ordering.
In-memory Qdrant tests cover real metadata indexing, session-id/fingerprint
joining, explicit page scope, citation fields and actual query-time signals.
Stub evaluation tests check shared raw CE scores, distinct candidate identity,
question pairing, seed averaging and frozen/cache preflight guards.

Initial focused suite: 52 passed; additional focused suite: 37 passed after
adding paired-pool/cache cases and refining the live scope test. Frontend:
204 passed. Final full light Python suite: **373 passed in 18.04 s** outside
the sandbox (avoiding the known Windows asyncio hang). Production build,
including TypeScript checking, passed; existing Browserslist, PDF viewer SVG,
mixed static/dynamic import and large-chunk warnings remain.

Post-run checks passed: aggregate bounds/counts, qid pairing, seed means,
paired differences, 24-candidate/four-link budgets, cache/report signature
agreement and saved-model SHA-256. The saved ranker remains
`7e35f36de053c0b970658c769f789bb40fdc423da879256d38890380b5c5571f`.
The cache, run log and lightweight verification script stay ignored under
`ml/out/`. No Ollama, frozen evaluation, UI interaction, artifact overwrite or
commit occurred. The pre-run 373/204 test suites and build remain valid; no
implementation code changed during the approved evaluation.

**Next:** ML5.1, training-only ablation setup and the inference-only milestone
harness. Freeze all model/feature/variant choices and the answer-grading
protocol before the single frozen read; obtain fresh CPU approval for those
later runs. Optional current-page distance and a learned link-provenance
feature are not implemented or silently folded into this result.

---

## Phase ML5.1 — TRAIN ablations and frozen milestone setup (October 17, 2026)

**Checkpoint:** ML4.3/ML4.4 and the annotation index repair committed as
`b46c36c` (`Complete ranking metrics and link expansion evaluation`) at the
user's request. ML5.1 changes remain uncommitted.

**Scope:** implement TRAIN-only leave-one-document-out ablations and prepare
an inference-only harness for the future one-read milestone. The user
approved the 10–20 minute TRAIN CPU run with two-thread limits. No approval
for frozen inference or LLM generation is implied.

### Implementation and safeguards

- `ml5_train` compares 15 fixed variants: fused, cross-encoder and LambdaRank
  on three candidate pools (concepts, passages only, concepts plus links),
  plus six feature-group removals. Each learned variant is fitted outside
  the held PDF for seeds 0/1/2; report every seed and per-question seed means.
- Ranker save/load supports ordered feature subsets and rejects inconsistent
  artifact dimensions. Existing full-feature production artifacts retain
  their schema. Candidate building reuses live service retrieval and one
  raw CE logit per unique text across pools.
- Preserve the exact ML4 full-feature seed-0 primary artifact. Fit the other
  26 final variant/seed models only on answerable TRAIN rows, save separately,
  and freeze their hashes, source hashes, feature lists and fixed parameters.
- `milestone_eval` requires explicit preflight or milestone mode. Preflight
  checks hashes without opening questions. Actual inference claims an
  exclusive fixed receipt before reading either question collection; failures
  retain the receipt. Synthetic tests verify read order, refusal to replay,
  canonical split filtering, namespace isolation and absence of fitting.
- Reports include exact McNemar per seed, paired document-bootstrap intervals,
  set-specific and pooled tables, and descriptive question-type breakdowns.
  PDFs shared across sets remain a single bootstrap cluster. Fractional
  seed-mean recalls do not receive binary McNemar tests.
- `docs/ML5_PROTOCOL.md` freezes the later 50-question/100-answer grading
  sample, randomized presentation and correctness/grounding/abstention
  rubric. The future milestone stages the selected contexts during its one
  read so subsequent generation does not reopen questions or repeat retrieval.
  LLM generation and human grading remain later, separately approved work.

### TRAIN results

The approved run completed in approximately seven minutes with two-thread
limits, local offline embedder/CE weights and no LLM. It counted 120 TRAIN
questions (95 answerable, 25 unanswerable), with nine answerable source PDFs.
The table reports leave-one-document-out seed means. Intervals in the final
column are paired document-bootstrap MRR differences against CE; absolute
intervals for every metric, each seed and all type breakdowns are retained in
`ml/results/ml5_train.json`.

| Variant | Recall@5 | MRR@10 | nDCG@10 | Paired MRR vs CE [95% CI] |
| --- | ---: | ---: | ---: | --- |
| Fused + concepts | 0.9368 | 0.7613 | 0.7900 | -0.0259 [-0.0710, +0.0203] |
| Fused passages | 0.9158 | 0.7457 | 0.7783 | -0.0415 [-0.0758, -0.0073] |
| Fused + links | 0.9368 | 0.7613 | 0.7900 | -0.0259 [-0.0710, +0.0203] |
| CE + concepts | 0.9263 | 0.7872 | 0.8220 | reference |
| CE passages | 0.9158 | 0.7684 | 0.8040 | -0.0188 [-0.0555, +0.0090] |
| CE + links | 0.9263 | 0.7872 | 0.8220 | 0.0000 [0.0000, 0.0000] |
| Full ranker + concepts | 0.9614 | 0.8119 | 0.8383 | +0.0246 [-0.0014, +0.0506] |
| Ranker passages | 0.9333 | 0.7724 | 0.8051 | -0.0149 [-0.0625, +0.0338] |
| Ranker + links | 0.9579 | 0.8103 | 0.8381 | +0.0231 [-0.0132, +0.0594] |
| Without CE features | 0.9263 | 0.7958 | 0.8193 | +0.0086 [-0.0462, +0.0613] |
| Without lexical features | 0.9614 | 0.8152 | 0.8391 | +0.0280 [+0.0018, +0.0549] |
| Without dense features | 0.9474 | 0.8003 | 0.8286 | +0.0131 [-0.0177, +0.0444] |
| Without concept features | 0.9544 | 0.8084 | 0.8367 | +0.0211 [-0.0044, +0.0475] |
| Without context features | 0.9614 | 0.7857 | 0.8201 | -0.0016 [-0.0300, +0.0275] |
| Without fusion features | 0.9614 | 0.8069 | 0.8365 | +0.0197 [-0.0088, +0.0486] |

Absolute full-ranker 95% intervals: R@5 [0.9236, 1.0000], MRR [0.7435,
0.8838], nDCG [0.7720, 0.9057]. CE: R@5 [0.8812, 0.9778], MRR [0.7127,
0.8667], nDCG [0.7502, 0.8930]. The pooled TRAIN full-ranker improvement over
CE remains inconclusive; keep the live cross-encoder default.

Matched comparisons support a TRAIN benefit from including OKF candidates:
full-ranker concepts minus passages MRR +0.0395 [+0.0043, +0.0812]. For CE,
the corresponding +0.0188 [-0.0090, +0.0555] remains inconclusive. Link
expansion minus full ranker is -0.0016 [-0.0180, +0.0164], reproducing ML4.4;
leave it opt-in. These are small-data development comparisons across nine
PDFs and multiple variants, not independent confirmation or causal effects.

Feature removals versus the full ranker use paired outcomes, not differences
between unrelated interval endpoints:

| Removed group | Paired MRR difference [95% CI] |
| --- | --- |
| CE | -0.0160 [-0.0592, +0.0233] |
| Lexical | +0.0033 [-0.0153, +0.0246] |
| Dense | -0.0116 [-0.0291, +0.0021] |
| Concept | -0.0035 [-0.0131, +0.0041] |
| Context | -0.0262 [-0.0416, -0.0100] |
| Fusion | -0.0050 [-0.0159, +0.0058] |

Removing lexical features has a slightly higher point estimate than full,
but its paired interval includes zero. Do not select it as the new primary.
Removing context features hurts TRAIN MRR; the other group removals remain
uncertain. Correlated feature groups and multiple comparisons limit claims.
Full-ranker seed MRR values are 0.8259 / 0.8035 / 0.8063. Recall McNemar exact
p-values versus CE are 0.2891 / 0.4531 / 0.4531, supporting only; no binary
McNemar is computed on the fractional seed mean.

### Verification and frozen artifacts

388 Python tests passed (24.96 s), including synthetic ML5 tests; 204 frontend
tests passed; production build passed. Existing Browserslist, unresolved SVG,
mixed static/dynamic import and large-chunk warnings remain. No UI was operated.
Post-run aggregate checks passed for all variant/seed metric bounds, paired
differences, seed means, 95 qid pairings, three candidate pools, 24-candidate
budgets, 27 finite feature columns and TRAIN-only provenance. All verified
features are zero, as previously disclosed. Full seed-0 and CE reproduce
ML4.3 exactly. All 27 learned variant/seed references (the retained original
plus 26 new artifacts) and source hashes pass the read-only preflight. The
original ML4 SHA-256 is unchanged. No failed job or repeat evaluation occurred.

Frozen protocol SHA-256:
`da6e0c0a658fab4b6224152169d871e463b4c8b6d53c63b9a7cfc50b62ecf619`.
The protocol, candidate cache, models, log and verification script remain
ignored locally; the aggregate result contains no question text or evidence
quotations. No milestone receipt exists, no frozen TEST evidence was opened
or evaluated, no Ollama was started, and no ML5 commit was made.

**Next:** ML5.2 protocol/artifact preflight review and separate CPU approval
for the single frozen retrieval milestone. Do not run it automatically.

---

## Phase ML5.2 — Frozen retrieval milestone (October 17, 2026)

**Status:** readiness review and light tests complete. The user approved the
15–25 minute frozen retrieval workload; the single milestone run completed
in 23m 30s with two-thread/offline limits. The readiness snapshot matched
immediately before launch, and the fixed receipt was claimed before the
question read. Results and integrity checks are recorded below. ML5 changes
remain uncommitted; no commit was requested here.

### Readiness review

- The existing source/model hash preflight passes. All TRAIN aggregate
  consistency checks and ML4 seed-0 reproduction still pass. The original
  ML4 primary artifact and ML5.1 protocol hashes remain unchanged.
- All 12 eligible TEST PDFs exist. Their bytes and the existing bundle
  markdown are hashed in `ml/results/ml5_readiness.json`; no question-file
  content or hash is read. Only question-file existence and byte counts are
  checked before the milestone.
- Eleven source PDFs have existing bundles. The design brief is marked
  `use=other` and has no bundle because `ml.okf.build_all` only builds `main`
  sources. Preserve that expected passages-only behavior; do not rebuild or
  modify any retrieval inputs in response to TEST outcomes.
- The readiness snapshot supplements ML5.1 with hashes of the ingestion
  chunker, baseline PDF extraction helper, service schema/path helper and
  written grading protocol. It records installed dependency versions and
  cached retrieval-model revisions/files without loading either model.
  These additional files were not included in ML5.1's source-hash list.
- Offline embedder revision:
  `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`; CE revision:
  `c5ee24cb16019beea0893ab7796b1df96625c6b8`. Both have local weights/configs.
  No downloads, Docker, GPU use, Ollama startup or LLM calls are planned.
- Reviewed the explicit milestone flag, fixed exclusive receipt, canonical
  source filtering, saved-model-only inference, paired document reporting,
  fixed seed-0 decision rule and staging of the predeclared grading sample.
  Any failure consumes the receipt; no automatic restart or second read.

Verification: 388 Python tests passed (121.07 s), including synthetic
receipt, split-routing, grading-selection and inference-only tests. No
production evaluation code changed during this review. The preceding 204
frontend tests/build remain applicable; there are no frontend edits in ML5.2.

The ignored helper `ml/out/ml52_preflight.py --check` verifies that the
readiness snapshot still matches immediately before the authorized run.
The executed command used `ml.eval.milestone_eval` with the frozen ML5.1
protocol, `--frozen-test-milestone` and `--out ml/results/ml5_frozen.json`.
It processed both frozen collections once, reported all declared
variants/seeds, and staged 50 questions' contexts for later generation.
No model fitting, primary-model replacement, live-default change or LLM
generation occurred.

### Frozen results and verdict

Original: 80 questions (65 answerable, 15 unanswerable); independent: 78
(62/16). Retrieval metrics exclude the 31 unanswerable questions. Both sets'
127 answerable questions cover the same six PDFs; pooled uncertainty uses
six shared document clusters, not twelve independent ones.

| Set | CE MRR@10 | Full ranker MRR@10 | Paired difference [95% CI] |
| --- | ---: | ---: | --- |
| Original TEST | 0.8213 | 0.8454 | +0.0241 [-0.0398, +0.0841] |
| Independent | 0.8414 | 0.8102 | -0.0312 [-0.0866, +0.0115] |
| Pooled | 0.8311 | 0.8282 | -0.0029 [-0.0551, +0.0385] |

Pooled Recall@5 improves 0.9528 to 0.9921, paired +0.0394 [+0.0236,
+0.0476]; nDCG improves 0.8509 to 0.8551, paired +0.0042 [-0.0364,
+0.0375]. Exact pooled Recall McNemar p=0.0625 (0 lost, 5 gained), supporting
only because of within-PDF dependence. Recall improvement does not establish
earlier answer placement or answer-generation quality.

**Preregistered decision: keep cross-encoder default.** The positive pooled
MRR lower bound fails; the per-set nonnegative MRR/nDCG check also fails on
independent questions. The Recall lower-bound guard passes. Full-ranker seed
0/1/2 pooled MRR values are 0.8282 / 0.8157 / 0.8249, all below CE's 0.8311;
do not select another seed or variant using TEST.

**OKF verdict:** concepts versus passages improve pooled CE MRR by +0.0370
[+0.0040, +0.0742] on these six PDFs; for ranker the matched difference is
+0.0346 [-0.0126, +0.1023], uncertain. Links have no demonstrated pooled
gain: CE unchanged, ranker -0.0001 [-0.0343, +0.0235]. Keep links opt-in.
Definition-dependent questions (43) show ranker MRR +0.0609 [+0.0246,
+0.1052] versus CE; other types (84) show -0.0355 [-0.1050, +0.0283]. These
are descriptive, unadjusted comparisons, not grounds for a new routing rule.

Full absolute intervals, all 15 variants, paired feature-group removals,
per-seed robustness and type breakdowns are in `docs/ML5_RESULTS.md` and the
aggregate JSONs. The independent CE MRR was higher than the original CE MRR;
lower wording overlap did not imply uniformly harder questions. Results
remain limited by six documents, AI authorship and wide intervals.

### Post-run verification

The fixed receipt is complete; exit code 0; 474 retrieval calls and zero
runtime errors/warning lines. Checks pass for receipt/output/audit/grading
hashes, frozen retrieval inputs, TEST-only source membership, unique
namespaced IDs, seed pairing, metric bounds, paired document intervals,
McNemar discordances and the exact decision rule. Original ML4 artifact and
ML5.1 protocol hashes remain unchanged. No repeat question-file read or
model inference was needed for these checks.

`ml/results/ml5_frozen_analysis.json` adds the declared matched ablations
from the private saved outcomes; it does not modify the receipt-bound report.
Report SHA-256:
`af512bac091475f57133599ad79569ce32fab539277d9d0e45da26c4d3ba2e35`.
Private receipt/audit/grading inputs, run log and verification scripts stay
ignored. The 50 grading inputs contain 20 answerable plus five unanswerable
questions from each set, each with both methods' top-eight contexts; no
answers have been generated yet. Do not rerun the frozen evaluator or refit
the frozen comparison based on these results. Existing test results remain
applicable because no production source changed during the run.

**Next after ML5.2:** ML5.3 blind answer generation and human grading from the
staged inputs, with separate laptop approval before LLM work. Retrieval
results and the failed switch rule are now documented; stop here for the
user's next subphase instruction.

---

## Current Project State

**As of:** October 7, 2026

### File tree (abridged by responsibility)

```text
src/
├── core/                         pure TypeScript; CI-enforced boundary
│   ├── annotations/              models, apply, inverse commands, quadtree
│   ├── ink/                      coordinates, geometry, fitting, prediction
│   ├── library/                  reference identity and folder-path rules
│   ├── notes/                    independent notes, multi-anchor migration/export
│   ├── pages/                    stable page model and transforms
│   ├── search/                   literal keyword matching and scope resolution
│   ├── text-editor/              pure textbox session and geometry rules
│   ├── ui/                       virtual range calculation
│   └── workspace/                recursive pane/tab layout
├── lib/
│   ├── annotations/              history, autosave, storage, pointer handling
│   ├── pages/                    PDF materialisation and page-workspace storage
│   ├── saving/                   local save controller and adapters
│   ├── search/                   generation-safe native PDF text extraction
│   ├── storage/                  handle/blob library and editor IndexedDB databases
│   ├── tools/                    pencil, highlighter, eraser, text, shapes
│   └── workers/                  ink rendering and stroke processing
├── components/
│   ├── PDFViewer.tsx             document/page/annotation integration owner
│   ├── AnnotationCanvas.tsx      drawing plus text-editor integration adapter
│   ├── TextAnnotationEditor.tsx  controlled text editing and pointer capture
│   ├── PageOrganizer.tsx         page-operation dialog and real previews
│   ├── NotesPanel.tsx            virtualised multi-anchor note editor
│   ├── LibraryGrid.tsx           folder-based PDF reference library
│   ├── SearchBar.tsx             find in the focused PDF with match stepping
│   ├── DocumentTabs.tsx          document tab strip
│   └── ui/                       shared token-based primitives
└── pages/Dashboard.tsx           workspace and library composition root

ml/
├── data/extract_blocks.py        PDF → visual lines → blocks → features + weak labels
├── data/heading_rules.py         pure heading detection and removal
├── data/make_splits.py           validated deterministic source-group proposal
├── data/sample_for_labelling.py  enriched independent held-out sample
├── data/prepare_training.py      train-only heading-free rows and source folds
├── data/repair_training.py       training-only regeneration with original source folds
├── data/arxiv_corpus.py          cached, rate-limited training-paper/source collection
├── data/expand_training.py       uncapped train-only extension and coverage/fold report
├── models/first_classifier.py    majority/heading baselines, TF-IDF logistic and NB fitting
├── models/layout_classifier.py   finite layout allowlist, category encoder and LightGBM
├── models/improved_classifier.py balanced word and word/character candidates
├── splits.json                  user-accepted frozen memberships and counts
├── labels/label.html             offline labelling; local JSONLs ignored
├── eval/validate_questions.py    schema, frozen split and native-PDF evidence checks
├── eval/questions.schema.md      user question-authoring instructions
├── eval/baseline_current_rag.py   offline exact-vector and reranking baseline
├── eval/stats.py                 seeded document-cluster confidence intervals
├── eval/classifier_cv.py         grouped logistic/NB/layout development and intervals
├── eval/label_scheme.py          merged labels and estimable-class rule
├── eval/error_audit.py           train-only diagnostic sampling and review binding
├── eval/training_quality.py      aggregate repair diagnostics and content overlap
├── eval/latex_audit.py           bounded source-environment alignment and coverage
├── eval/compare_expanded.py      identical-run guards and paired source intervals
├── results/classifier_layout_cv.json  numerical four-method weak-label comparison
├── results/classifier_improved_cv.json  fixed text-candidate comparison
├── results/error_audit_summary.json  aggregate provisional 50-error diagnoses
├── results/classifier_repaired_cv.json  separate repaired-row weak-label comparison
├── results/classifier_merged_cv.json  ML2.8 merged-label, estimable-class scoring
├── results/training_repair_summary.json  numerical before/after training diagnostics
├── results/arxiv_expansion_summary.json  training-only yield and fold coverage
├── results/classifier_expanded_cv.json  source-weighted expanded-data baselines
├── results/classifier_expanded_features_cv.json  fixed definition-focused candidates
├── results/expanded_paired_comparison.json  same-row source-group bootstrap gains
├── results/arxiv_label_audit.json  20 readable sources, 448/742 aligned labels
├── results/baseline_current_rag.json  five-example numerical smoke results
└── tests/                        extraction, split, sampling and JS session tests
```

### Numbers

- 191 tracked TypeScript/TSX files under `src/`, 24,406 lines (tests
  included; counted with `git ls-files | wc -l`).
- 56 TypeScript files and 4,745 lines under `src/core/`.
- 31 frontend test files and 185 test cases.
- 2 property-based assertions: spatial index versus linear scan, and arbitrary
  command sequences round-tripping through inverses.
- `ml/`: 6,326 Python lines across 46 files (including blank lines), 299 passing Python tests (68 extraction/layout, 16 split,
  eight sampling, 24 questions, eight baseline, seven training preparation)
  plus ten active classifier, eight grouped-CV, eight NB and 17 layout-classifier tests;
  nine error-audit, nine fixed-candidate, 16 training-repair and five label-scheme tests;
  15 concurrent gold/feature cases, 35 source-expansion cases and seven paired-comparison cases;
  seven non-UI JavaScript tests.
- ML corpus: 58 PDFs / 38 groups; 52 eligible PDFs yield 14,237 blocks and
  1,345 weak labels in the preserved ML1 extraction snapshot. Frozen split:
  23 train/dev, 10 test, 5 excluded groups. ML2.7 regenerated training-only snapshot:
  40 PDFs, 9,360 blocks / 938 weak labels; 549 capped training rows across 27 PDFs.
- ML2.E1: 120 new arXiv PDFs / 120 new training groups, 19,804 new blocks /
  3,665 new weak labels. Expanded training: 160 extracted PDFs, 143 assigned
  groups / 124 usable groups, 4,477 uncapped rows across 137 PDFs. All original
  classes appear in all five folds. Source collection complete: 20 readable archives;
  fixed-sample audit has 742 labels, 448 aligned, 446 agreeing, two disagreements
  and 294 unresolved (60.4% coverage);
  remaining transfers rate-limited and two archives truncated. ML2.E2 stacked
  development accuracy 0.8043, macro F1 0.7591, definition P/R 0.7275/0.6196.
- 19 commits after the safety checkpoint `ab63d6f` through ML2 checkpoint `984c0ea`
  (not including the subsequent documentation-only checkpoint record).

### Build and test status

| Check | Status | Scope |
|---|---|---|
| `npx tsc -b` | Green | TypeScript project references |
| `npm test -- --run` | Green | 185 tests in 31 files |
| `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider` | Green, October 13 | 276 passed, no skips; includes ML2.12 heading-rule and audit-alignment regressions |
| `node --test ml/tests/label_session.test.cjs` | Green, October 7 | 7 non-UI offline labelling-session tests |
| `npx eslint src/core --max-warnings 0` | Green | pure-core boundary and core lint |
| `npm run build` | Green | typecheck plus Vite production build |
| `npm run build:demo` + `npm run demo:check` | Green | static demo and bundle exclusions |

The Vite build still reports non-fatal warnings about outdated Browserslist data, PDF.js image URLs,
mixed static/dynamic imports, and a large output chunk. Full-repository ESLint
is not a green gate because the inherited shell still has a known lint backlog;
CI gates `src/core` at zero warnings.

### Known working-tree state

- `f390691` checkpoints the real page-preview follow-up and Phase 8R.1 through
  Phase 8R.5 implementation, tests, and the Text-tool render-loop repair.
- Frontend phases F1 through F8 are checkpointed through `0e0847e`; their
  detailed chronology lives in `docs/frontend_implementation_log.md`.
- Phase 8R.6 (literal find) and F8R.2 (chrome redesign) are committed in
  `9e79ffa`; the ML1 pipeline and manifest in `a11f5a9`.
- Manual browser acceptance of 8R and F8R.2 remains pending and is not implied
  by those code checkpoints.
- ML2.1–ML2.7 code, tests, aggregate comparison reports, model documentation,
  roadmap/log entries and the `.venv-ml` ignore rule are checkpointed in
  `984c0ea` — `feat(ml): add classifiers, evaluation and training data repairs`.
- Unrelated edits to `docs/FRONTEND_PLAN.md` and
  `docs/frontend_implementation_log.md` remain uncommitted and were preserved.
- `docs/MARGIN_BUILD_PLAN.html` and `PROJECT_SUMMARY.md` remain untracked local
  documentation; `PROJECT_SUMMARY.md` is out of date and is rewritten in ML7.
- Full-repository ESLint still reports the inherited shell backlog (mostly
  `any` in `PDFViewer.tsx` and `useClientOcr.ts`); none of it comes from the
  two October commits.

---

## Next Up: ML3 — OKF Bundle Writer

The full plan is in `docs/IMPLEMENTATION_PHASES.md`. Remaining ML1 work:

1. Grouped split complete and frozen October 6 (`ml/splits.json`): 23 train/dev,
   10 test, 5 excluded.
2. ML1.4.2 sample/page implemented and non-UI tested; user page acceptance and
   300 independent human labels pending.
3. ML1.4.3 validator complete; five authored questions validate. Expand/review
   to 200 questions with gold pages and ~40 unanswerable before full acceptance.
4. ML1.4.4 baseline implemented; five-example vector/reranking table measured.
   Full-collection baseline and data acceptance remain before ML2.

ML1 tooling is checkpointed in `13d5106`. At the user's request ML2 started
October 6 with ML2.1 data plumbing: 548 heading-free weak training rows and five
source folds. The user then explicitly requested model implementation: ML2.2
baselines and the first TF-IDF/logistic classifier now pass ten active tests.
ML2.3–ML2.4 grouped development is measured: logistic accuracy 0.4033 / macro
F1 0.2362, NB 0.4215 / 0.2373, majority 0.2153 / 0.0702. ML2.5 layout comparison
is complete: accuracy 0.2974 / macro F1 0.1646, definition recall zero. Next goal
was ML2.6, now complete with a provisional 50-text audit and two fixed candidates.
Balanced logistic reaches accuracy 0.4124 / macro F1 0.2700 / definition recall
0.3913, with lower definition precision and no gain over NB accuracy.
ML2.7 is now implemented: source-page-verified extraction fixes, 549 regenerated
rows with unchanged source folds, and separate evaluation (balanced accuracy
0.4080 / macro F1 0.2638 / definition recall 0.4022). This changed-data result
is not an identical-row improvement over ML2.6. ML2.8 changed scoring only:
notation merged into definition, other unscored, algorithm not estimable; on the
four estimable classes balanced logistic reaches macro F1 0.4444 (same models, same rows).
ML2.9 gold-evaluation tooling and ML2.10 cue/context model tooling were added
in concurrent work; the draft test labels still require human approval. More
training sources are now extracted in ML2.E1, with its source audit partial.
Final held-out evaluation still requires the pending independent human labels.

ML2.E1 now adds 120 training-only arXiv groups and replaces the cap with source
weights: 4,477 usable rows, balanced five-fold row counts, every class in every
fold. Expanded logistic reaches weak-label accuracy 0.6813 / macro F1 0.4609
over five scored classes, but definition recall is only 0.0981. Do not treat
that changed-population accuracy as proof of an across-the-board improvement.
ML2.E2 has now compared the existing definition-focused candidates on identical
expanded rows. The stack reaches accuracy 0.8043 / macro F1 0.7591 / definition
recall 0.6196, with paired source-group intervals supporting gains over plain
logistic. This is weak-label development evidence, not gold acceptance.
The 20-paper source audit remains partial: five downloaded, four readable;
16 valid sources still needed. The script resume returned HTTP 429, but the
subsequent built-in-browser download succeeded.
ML2.E3 fixes the full-sample denominator (103/742 resolved, 13.9% coverage) and
provides an offline exact-version download manifest. Acquire those sources,
complete the audit and review unresolved matches before a precision claim. ML2.9 human approval and
gold acceptance remain pending; concurrent ML2.10 code is preserved separately.

ML2.E4 verifies that the built-in browser downloads a complete source archive
where the script route failed. Four sources are now readable, 16 still needed.
Use that browser route for the next collection step; don't infer browser
unavailability from the script's 429 responses or require manual downloads
without first testing the available browser mechanism.

Manual acceptance of Phase 8R and F8R.2 and publishing the static demo stay
open in parallel; they do not block the ML track.

**Current roadmap update, October 13:** ML2.E5 completes all source downloads.
All 20 archives are readable; automatic agreement is 446/448 with 60.4% coverage.
The earlier download blockers above are historical, not current. Next are the
294 unresolved audit labels, the heading/alignment issues and human approval
of 300 draft test labels before gold evaluation. No downloads remain.

**Update, October 13 (ML2.11–ML2.12):** the audit review is done. Alignment
coverage is 83.6% (619/740) with 0.995 precision [0.984, 1.000]; all 121 still
unmatched labels were reviewed and are correct headings. Four heading-rule
issues were fixed and training data regenerated; the stacked LightGBM remains
best (0.799 accuracy, 0.755 macro F1; 0.654 / 0.678 on non-arXiv sources) and is
frozen for the gold run. Remaining: (1) user review of the 300 draft labels in
`label.html` → `hand_labels.jsonl`; (2) the single milestone run
`python -m ml.eval.gold_eval --compare ml/labels/assistant_labels.jsonl --frozen-test-milestone`;
(3) commit; (4) ML3, the OKF bundle writer.

**Update, October 13 (ML2.13):** labels reviewed by the assistant (8 changes;
single-annotator AI labels, not human) and the milestone gold run done.
Two-stage accuracy 0.603 [0.498, 0.665], macro F1 0.659; heading rule 0.97 when
it fires; prose-definition recall 0.262 [0.159, 0.365] at precision 0.842.
Training has no unheaded prose, so unheaded text is forced into headed roles.
Next: ML2.14 (unlabelled blocks as a noisy "neither" class, prose-definition
cues, precision-first threshold), chosen on development data only; optional
human check of 50 gold labels; then ML3.

---

## Working Conventions

- Work one roadmap phase or repair subphase at a time.
- ML: split by source group; keep the test set frozen; report intervals; never
  commit `ml/out/`.
- Keep pure decisions in `src/core/`; inject browser/PDF/storage dependencies
  through `src/lib/`.
- Use the shared operation history for every user-visible reversible edit.
- Run deterministic checks before requesting a manual UI check.
- The user performs UI interaction and visual judgment; record those checks as
  pending until the user reports the result.
- Preserve unrelated working-tree changes.
- Do not commit AI-local folders or agent artifacts.
- Do not mark a phase complete because its code exists; automated and manual
  acceptance must agree.
