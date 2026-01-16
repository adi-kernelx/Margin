# Phased Implementation Plan

## Phase 1: Backend Foundation & Data Model (Requirements A, B, C-Core)
**Goal:** Establish the correct Firestore data model and S3 layout, and implement basic file/folder CRUD.

**Tasks:**
1.  **Firestore Schema Setup:**
    *   Verify/Update `createFolder` logic to support recursive `children` subcollections.
    *   Ensure `File` document schema matches the spec (including `s3PdfKey`, `s3AnnotationsKey`).
2.  **File Management APIs (`src/routes/files.ts`):**
    *   `POST /api/folders`: Create folder (validate recursion).
    *   `POST /api/files/upload`: Implement multipart upload.
        *   Generate UUID `fileId`.
        *   Construct S3 paths: `users/{uid}/folders/{folderId}/children/{fileId}/...`.
        *   Upload PDF to S3.
        *   Create Firestore document.
    *   `GET /api/folders/{folderId}/children`: List files/folders (hide annotation keys).
    *   `DELETE /api/files/{fileId}`: Delete S3 objects + Firestore doc.
3.  **S3 Helper:**
    *   Ensure `lib/storage.ts` supports `putObject`, `deleteObject`, and `getSignedUrl`.

**Acceptance Criteria:**
*   Can create nested folders.
*   Can upload a PDF; it appears in S3 under the correct hierarchy.
*   `GET /children` returns the file list without annotation details.

## Phase 2: Reliable Save Flow (Requirements C-Open/Save, D)
**Goal:** Implement the "Presigned PUT + Confirm" save loop with conflict detection.

**Tasks:**
1.  **Backend (`src/routes/annotations/index.ts`):**
    *   `POST /open`: Return presigned GET for PDF + fetch annotation JSON content.
    *   `POST /save-request`:
        *   Check `payloadHash` vs `lastAnnotationsHash`.
        *   Return `{ skip: true }` or `{ uploadUrl }`.
    *   `POST /confirm`:
        *   Verify S3 object existence (`headObject`).
        *   Update `lastAnnotationsHash`, `lastSavedAt`.
2.  **Frontend (`CloudSaveAdapter.ts`):**
    *   Implement `save()` method using the 2-step flow.
    *   Handle `skip: true` (instant success).
    *   Handle `uploadUrl` -> PUT -> `confirm`.
    *   Retry logic for failed uploads.

**Acceptance Criteria:**
*   Saving same content twice results in "skip" (no S3 write).
*   Changed content uploads to S3 and updates Firestore hash.
*   Network failure during PUT allows retry.

## Phase 3: Client UX & Autosave (Requirement E)
**Goal:** Polish the user experience for saving.

**Tasks:**
1.  **Save Manager:**
    *   Ensure `saveNow` handles logic for "manual" vs "autosave".
    *   Implement "Double-click" detection (or "Save Options" modal).
2.  **UI Components:**
    *   Build "Save Options" Modal (Save, Autosave toggle, Export).
    *   Autosave timer (60s default) - restarts on manual save.
3.  **Frontend State:**
    *   Track `lastSavedHash` to avoid unnecessary network requests.
    *   Visual feedback (Toast: "Saved", "Autosaving...").

**Acceptance Criteria:**
*   Single click -> Saves instantly (or queued).
*   Double click -> Opens options modal.
*   Autosave runs silently every 60s if dirty.

## Phase 4: Operations & Visibility (Requirements F, G)
**Goal:** Handle renaming and ensure correct visibility rules.

**Tasks:**
1.  **Rename Logic:**
    *   `PATCH /api/files/{fileId}`: Update `name` field in Firestore only.
    *   (Optional) Server-side S3 copy if strict S3 mirroring is enabled (default: OFF).
2.  **Move Logic:**
    *   Update parent paths in Firestore.
3.  **Visibility:**
    *   Review API responses to ensure internal S3 keys/annotation files are never exposed to the frontend list.

**Acceptance Criteria:**
*   Renaming a file changes its display name immediately.
*   Old S3 key remains valid/accessible via the system.

## Phase 5: Production Readiness (Requirements H)
**Goal:** Security, Logging, and Exports.

**Tasks:**
1.  **Security:**
    *   Audit all endpoints for `req.user.uid` checks.
    *   Validate file ownership before generating presigned URLs.
2.  **Exports:**
    *   Implement `/flatten` and `/package` endpoints.
    *   Use `pdf-lib` or similar on backend (or worker) to generate flattened PDF.
3.  **Logging:**
    *   Add structured logging for all critical actions (Upload, Save, Delete).

**Acceptance Criteria:**
*   Users cannot access other users' files.
*   Flatten/Package returns valid temporary URLs.
