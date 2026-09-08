# Margin

A local-first reading and annotation workspace for mathematical documents — textbooks,
papers, problem sets.

> **Status: in development, week 2 of 17.** This README describes what is
> actually in the tree today, and says plainly what isn't built yet. The
> [roadmap](#roadmap) is the honest version. Nothing below is aspirational; if a
> section describes behaviour, that behaviour exists.

---

## What works today

- **Annotation** — pencil, highlighter, text, shapes, image paste, LaTeX/KaTeX
  math, and an eraser, on a canvas layer with resize and rotate transforms.
- **Undo/redo** — every edit is a command carrying its own inverse, on one stack.
- **Local library** — folders and files in IndexedDB. Import PDFs, organise them,
  open them. Nothing leaves the machine.
- **Multi-document** — up to four PDFs open at once.
- **OCR** — PaddleOCR via a local FastAPI service, producing a selectable text layer.
- **RAG chat** — a local llama.cpp + LangGraph service, answering over the open document.

## What is not built yet

Named explicitly, because a README that overstates is worse than one that omits:

- No page operations (add, delete, reorder, rotate, merge, split).
- No notes panel.
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
  lib/annotations/     operation log, storage, autosave, pointer handling
  lib/storage/         library-db (file tree), local-file-db (annotations, OCR cache)
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
| 3–4   | App shell, pane grid, component primitives |
| 5–6   | Ink quality: layered canvases, Bézier fitting, latency prediction, exact eraser |
| 7     | Page operations on stable page IDs |
| 8     | Notes panel, library grid, full-text search |
| 9     | **Milestone — containerised, demoable, documented** |
| 10–11 | Content-addressed object store, version history, document diffing |
| 12    | Cache replacement policies benchmarked against Belady's optimal |
| 13    | OCR escalation ladder |
| 14–16 | Layout detection and reading-order recovery (the ML flagship) |
| 17    | OKF knowledge bundles, hybrid retrieval, benchmarks, write-ups |

---

## Licence

Not yet chosen.
