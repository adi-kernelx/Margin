# Margin

A local-first reading and annotation workspace for mathematical documents — textbooks,
papers, problem sets.

> **Status: in development, week 8 of 17.** This README describes what is
> actually in the tree today, and says plainly what isn't built yet. The
> [roadmap](#roadmap) is the honest version. Nothing below is aspirational; if a
> section describes behaviour, that behaviour exists.

---

## What works today

- **Annotation** — pencil, highlighter, text, shapes, image paste, LaTeX/KaTeX
  math, and an eraser. Live ink is isolated from committed ink, preserves
  coalesced stylus samples, predicts one frame ahead, and is simplified into
  fitted cubic Bézier paths in a worker. Point erasure uses exact swept-disc
  geometry and refits the surviving stroke pieces.
- **Undo/redo** — every edit is a command carrying its own inverse, on one stack.
- **Page operations** — every page has a stable UUID independent of its current
  position. The page organizer can add blanks, delete, drag-reorder, rotate,
  merge another PDF, extract a selection, and split a document. Page edits and
  the annotations attached to them share the same undo/redo history.
- **Notes** — every highlight can carry a plain-Markdown note with inline KaTeX,
  its selected quote, nearby text, stable page ID and page-space bounds. The
  virtualised notes panel follows document order, links both ways with the page,
  participates in undo/redo, and exports portable Markdown.
- **Local library** — PDFs live in IndexedDB with generated first-page covers,
  page counts and last-read position. Import and reopen them without uploading
  anything; nothing leaves the machine.
- **Full-text search** — native PDF text and local OCR tokens are merged into a
  persisted browser-side inverted index. Multi-term and exact-phrase queries
  return ranked snippets and page bounds, and the cache is invalidated when the
  stable page order or rotation changes.
- **Portable PDF export** — highlights, ink, text and shapes are emitted as
  standard PDF annotation objects. Margin's complete model is also attached as
  JSON so the annotations remain losslessly editable when reopened here.
- **Multi-document workspace** — open documents live as tabs in a recursive pane tree. Drag a tab to a pane edge to split (up to four visible panes), drag it to the centre to move it, and resize dividers with a pointer or arrow keys. Hidden tabs release their PDF renderer because only each pane's active tab is mounted.
- **Consistent workspace controls** — the toolbar and settings use reusable,
  keyboard-accessible buttons, tooltips, popovers, dialogs, segmented controls,
  colour/stroke controls and resizable panels. A virtualised-list primitive is
  ready for the thumbnail and notes views planned later.
- **OCR** — PaddleOCR via a local FastAPI service, producing a selectable text layer.
- **RAG chat** — a local llama.cpp + LangGraph service, answering over the open document.

## What is not built yet

Named explicitly, because a README that overstates is worse than one that omits:

- No object store, no version history, no document diffing.
- No layout-detection or reading-order ML.
- No Docker Compose; the services are started by hand.
- No encryption, no sync, no sharing, no accounts.

---

## Architecture

Local-first with no server of its own. The frontend owns all persistent state
and calls the Python services directly over HTTP.

```
  React frontend (Vite)  ──┬── OCR service     :8000   PaddleOCR / FastAPI
   IndexedDB is the        │
   only source of truth    └── RAG + ingest    :9101   llama.cpp + LangGraph
                                                       (Qdrant + Typesense behind it)
```

There is no Node backend, no cloud storage, and no authentication. That is
deliberate: this is a single-user application, and the OS account that owns the
data directory is the access control. Earlier revisions had Firebase auth, S3
storage and an Express API; all three were removed in weeks 1–2, along with
about 8,700 lines of the code that supported them.

### The core/shell split

`src/core/` holds the parts of the system with no environment — geometry,
command semantics, and later cache policy. It must run in plain Node: no DOM, no
storage, no framework imports. This is enforced by an ESLint rule that fails CI,
not by convention, which is what makes it stay true.

Everything else — `src/components/`, `src/lib/`, `src/hooks/` — is a shell. Shells
may import the core; the core may never import a shell.

```
src/
  core/annotations/    models, command factories, quadtree spatial index   (pure)
  core/ink/            coordinates, exact eraser geometry, fitting, prediction (pure)
  core/pages/          stable page identities, page commands, annotation transforms (pure)
  core/notes/          quote/context anchors, document ordering, Markdown export (pure)
  core/search/         tokenisation, inverted index, ranking and match bounds (pure)
  core/workspace/      pane-layout tree, tab movement, split and resize    (pure)
  core/ui/             virtual-list range calculations                     (pure)
  lib/annotations/     operation log, storage, autosave, pointer handling
  lib/storage/         library metadata/files, annotations and OCR cache
  lib/search/          PDF/OCR extraction and persisted IndexedDB search pages
  lib/saving/          save manager, adapters, flatten service
  lib/tools/           one class per drawing tool
  components/          React
```

---

## Running it

Requires Node 22+ and Python 3.10+.

### Frontend

```bash
npm install
npm run dev
```

The app runs standalone. The two services below are optional — without them, OCR
and chat are unavailable and everything else works.

### OCR service

```bash
cd ocr-service
docker compose up --build
```

### RAG stack

```bash
cd local-llm
docker compose up --build
```

Qdrant and Typesense, used by the ingest pipeline:

```bash
cd ingest-pipeline
docker compose -f docker-compose.search.yml up
```

---

## Development

```bash
npm test          # Vitest
npm run lint      # ESLint across the tree
npm run build     # tsc -b && vite build
```

CI runs typecheck, the core boundary rule at zero errors, tests, and a
production build on every push.

Note that `npm run lint` currently reports a backlog of pre-existing `no-explicit-any`
errors across the shells. That backlog is being worked down; `src/core` is held
at zero and is the part CI gates.

---

## Roadmap

| Weeks | Focus |
|-------|-------|
| 1–2   | Demolition, core/shell split, tests, CI, design tokens |
| 3–4   | App shell, pane grid, component primitives — complete |
| 5–6   | Ink quality: layered canvases, Bézier fitting, latency prediction, exact eraser — complete |
| 7     | Page operations on stable page IDs — complete |
| 8     | Notes panel, library grid, full-text search, native PDF annotation export — complete |
| 9     | **Milestone — containerised, demoable, documented** |
| 10–11 | Content-addressed object store, version history, document diffing |
| 12    | Cache replacement policies benchmarked against Belady's optimal |
| 13    | OCR escalation ladder |
| 14–16 | Layout detection and reading-order recovery (the ML flagship) |
| 17    | OKF knowledge bundles, hybrid retrieval, benchmarks, write-ups |

---

## Licence

Not yet chosen.
