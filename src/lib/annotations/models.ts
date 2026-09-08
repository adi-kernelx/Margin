// Moved to @/core/annotations/models — these are pure types with no runtime
// dependencies, so they belong in the core rather than beside the storage and
// DOM code in lib/. Re-exported here so existing imports keep resolving.

export * from '@/core/annotations/models';
