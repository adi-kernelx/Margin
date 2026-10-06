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
├── eval/error_audit.py           train-only diagnostic sampling and review binding
├── eval/training_quality.py      aggregate repair diagnostics and content overlap
├── results/classifier_layout_cv.json  numerical four-method weak-label comparison
├── results/classifier_improved_cv.json  fixed text-candidate comparison
├── results/error_audit_summary.json  aggregate provisional 50-error diagnoses
├── results/classifier_repaired_cv.json  separate repaired-row weak-label comparison
├── results/training_repair_summary.json  numerical before/after training diagnostics
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
- `ml/`: 4,579 Python lines, 208 passing Python tests (68 extraction/layout, 16 split,
  eight sampling, 24 questions, eight baseline, seven training preparation)
  plus ten active classifier, eight grouped-CV, eight NB and 17 layout-classifier tests;
  nine error-audit, nine fixed-candidate and 16 training-repair tests;
  seven non-UI JavaScript tests.
- ML corpus: 58 PDFs / 38 groups; 52 eligible PDFs yield 14,237 blocks and
  1,345 weak labels in the preserved ML1 extraction snapshot. Frozen split:
  23 train/dev, 10 test, 5 excluded groups. ML2.7 regenerated training-only snapshot:
  40 PDFs, 9,360 blocks / 938 weak labels; 549 capped training rows across 27 PDFs.
- 19 commits after the safety checkpoint `ab63d6f` through ML2 checkpoint `984c0ea`
  (not including the subsequent documentation-only checkpoint record).

### Build and test status

| Check | Status | Scope |
|---|---|---|
| `npx tsc -b` | Green | TypeScript project references |
| `npm test -- --run` | Green | 185 tests in 31 files |
| `.venv-ml/Scripts/python.exe -m pytest ml/tests -p no:cacheprovider` | Green, October 7 | 208 passed, no skips; extraction repair and data diagnostics checked |
| `node --test ml/tests/label_session.test.cjs` | Green, October 6 | 7 non-UI offline labelling-session tests |
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

## Next Up: ML2.8 Training-Data Acceptance, with ML1 Human-Data Acceptance Still Pending

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
is not an identical-row improvement over ML2.6. Next is ML2.8 training-snapshot
acceptance and rare-class label enrichment; final independent-label acceptance remains pending.
Final held-out evaluation still requires the pending independent human labels.

Manual acceptance of Phase 8R and F8R.2 and publishing the static demo stay
open in parallel; they do not block the ML track.

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
