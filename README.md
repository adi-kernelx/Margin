<img src="public/margin.svg" alt="" width="64" height="64">

# Margin

A local-first PDF reader for mathematical and research documents, with
annotation tools, a knowledge panel that extracts definitions and theorems,
and an optional AI assistant that answers questions from the open PDF with
page citations. Everything runs on your own machine: there are no accounts
and nothing is uploaded.

## Features

- **Reading:** tabs and split panes, a local library, find in document,
  outline, notes, and page operations (reorder, rotate, split, merge).
- **Annotation:** ink, highlights, text, shapes and math, with shared
  undo/redo and export to PDF or Markdown.
- **Knowledge panel:** builds an Open Knowledge Format (OKF) bundle of the
  document's definitions, results and notation; jump to each one in the PDF,
  mark it verified, export the bundle.
- **Assistant:** ask about the open PDF or summarise it. Answers cite their
  pages and concepts, render LaTeX, and show token counts and speeds.
- **OCR:** scanned pages get a selectable text layer from a local OCR service.

## Architecture

![Margin architecture](docs/architecture.svg)

The browser app keeps every document, annotation, bundle and conversation in
IndexedDB. Two optional local services do the heavy work: the OCR service
(port 8000) and the RAG API (port 9101). The RAG API indexes passages and
concepts in an embedded Qdrant store, ranks them with BM25, vector search and
a cross-encoder, and generates answers with Qwen 2.5 3B through Ollama. The
`ml/` track trains the block classifier and ranker offline; the service loads
their saved artifacts at start-up.

## Getting started

Requires Node.js 22. The reader needs no other service.

```bash
npm ci
npm run dev
```

Open the URL Vite prints. Documents live in the browser's storage, so export
anything important before clearing site data.

### Assistant (optional)

1. Install [Ollama](https://ollama.com) and pull the model once:
   `ollama pull qwen2.5:3b-instruct`. Open the Ollama app.
2. Create the Python environment (Python 3.13):

   ```bash
   py -3.13 -m venv .venv-ml
   .venv-ml\Scripts\python.exe -m pip install -r ml/models/requirements.txt -r ml/eval/requirements.txt -r local-llm/rag-api/requirements.txt
   ```

3. Start the service:

   ```bash
   npm run assistant
   ```

Opening a PDF indexes its text automatically. The assistant panel shows what
is missing if the service, Ollama or the model is not available. Settings
such as the model, context size and retrieval method are listed in
[`.env.example`](.env.example).

The Knowledge panel needs `ml/models/artifacts/okf_pipeline.joblib`, which is
produced by the `ml/` pipeline and not committed.

### OCR (optional)

```bash
cd ocr-service
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Static demo

`npm run build:demo` builds a version without services into `dist-demo/`;
`npm run demo:check` verifies that no service code leaked into it.

## Results

Measured on 127 held-out questions over six PDFs (95% intervals resample
whole documents):

| Retrieval | Recall@5 | MRR@10 | nDCG@10 |
|---|---:|---:|---:|
| Hybrid + OKF concepts + cross-encoder (default) | 0.953 | 0.831 | 0.851 |
| Same, with the learned LambdaRank ranker | 0.992 | 0.828 | 0.855 |

- OKF concepts improve ranking: MRR +0.037 [+0.004, +0.074] over passages
  alone.
- The learned ranker finds the answer page more often but does not rank it
  higher (MRR −0.003 [−0.055, +0.039]), so it stays optional.
- Generated answers scored 1.76 / 2 for correctness on a reviewed sample of
  100. Mathematical, unit and citation errors still occur, and CPU generation
  takes tens of seconds per answer.

Details: [results](docs/ML7_RESULTS.md), [model card](docs/MODEL_CARD.md),
[dataset card](docs/DATASET_CARD.md).

## Project layout

| Path | Contents |
|---|---|
| `src/` | React 19 + TypeScript frontend; `src/core/` holds pure, tested logic |
| `local-llm/rag-api/` | RAG service: ingest, retrieval, reranking, generation, OKF bundles |
| `ocr-service/` | PaddleOCR service |
| `ml/` | Block extraction, classifier and ranker training, evaluation, results |
| `docs/` | Roadmap, implementation log, results, model and dataset cards |
| `scripts/` | Demo build helpers and the assistant launcher |

## Development

```bash
npm test
npm run build
.venv-ml\Scripts\python.exe -m pytest ml/tests -q -p no:cacheprovider
```

CI runs the type check, the `src/core` lint gate, the tests and both builds on
every push.

## Data and privacy

Source PDFs, labels, evaluation questions and trained model files stay local
and are excluded from the repository; their rights belong to their owners.
The services listen on localhost only and have no authentication, so keep
them local.
