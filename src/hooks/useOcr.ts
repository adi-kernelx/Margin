// The single import point for OCR in components. The demo build aliases this
// module to ./useOcr.demo.ts (see vite.config.ts), which removes the OCR
// client, Tesseract and the ingest calls from the bundle entirely — a runtime
// flag alone cannot, because those modules have top-level side effects.
export { useClientOcr as useOcr } from './useClientOcr';
