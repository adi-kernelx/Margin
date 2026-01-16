A — Firestore data model (recursive subcollections)

Top-level:

/users/{uid}         // document for each user (document id = uid)


Inside each user document:

/users/{uid}/rootFolders/{folderId}    // root-level folders (there may be one "root" folder or multiple)


Folder document:

{
  "id": "<folderId>",            // doc id (UUID)
  "type": "folder",
  "name": "Invoices 2025",
  "createdAt": <timestamp>,
  "createdBy": "<uid>",
  "updatedAt": <timestamp>,
  "metadata": { /* optional */ }
}


Each folder document has a subcollection children:

/users/{uid}/rootFolders/{folderId}/children/{childId}


A child document is either a folder or a file. If it is a folder, its document will have "type": "folder" and itself will have a children subcollection (recursion). If it is a file, "type": "file" and it will have fields for PDF and annotation pointers.

File document (stored as a child in a folder’s children):

{
  "id": "<fileId>",             // doc id (UUID)
  "type": "file",
  "name": "report.pdf",         // visible filename
  "displayName": "report",      // optional without extension
  "mimeType": "application/pdf",
  "sizeBytes": 123456,
  "s3Prefix": "users/{uid}/{folderPath…}/{folderId}", // prefix for this file's folder on S3
  "s3PdfKey": "users/{uid}/{...}/{fileId}-{originalName}.pdf",
  "s3AnnotationsKey": "users/{uid}/{...}/{fileId}-annotations.json",
  "annotationsRef": "annotations/{annotationId}/latest.json", // optional, if you use separate top-level annotations structure; you asked same folder, so leave as s3AnnotationsKey.
  "lastAnnotationsHash": "<sha256|null>",
  "lastSavedAt": <timestamp|null>,
  "createdAt": <timestamp>,
  "createdBy": "<uid>",
  "updatedAt": <timestamp>
}


Notes:

children subcollections implement recursion.

Use UUID document IDs, not folders names as doc ids; keep name as field so rename = update name field, no doc ID changes.

Keep s3PdfKey and s3AnnotationsKey in the file document so the server can operate without deriving keys from names.

The folderPath can be represented by stacking folder IDs or by a parentId pointer. For clarity, since you requested hierarchical subcollections, the path is implicit in Firestore path (folder doc contains subcollection children). For S3 key path we compute full path by walking parent chain server-side or by storing pathIds array in the file doc at creation for quick key construction.

B — S3 layout (mirror Firestore folder structure; annotations in same folder)

S3 bucket layout (single bucket recommended):

s3://<BUCKET>/
  users/{uid}/
    folders/{folderId}/
      children/{childId}/  <-- for each file or subfolder
        file-<fileId>-orig.pdf
        file-<fileId>-annotations.json


Concretely:

PDF: users/{uid}/folders/{folderId}/children/{fileId}/file-{fileId}.pdf

Annotations: users/{uid}/folders/{folderId}/children/{fileId}/annotations-{fileId}.json

Why this: you requested keeping file and annotation in same folder/prefix; this layout ensures that.

Naming rules:

S3 keys contain the fileId (UUID) — avoids collisions and enables renames without changing s3 key (we'll discuss rename tradeoffs).

The UI shows the name field from Firestore; the S3 object name can be derived for download (include original filename in metadata if you want original filename preserved when downloaded).

S3 object metadata:

When we PUT the original PDF, set metadata fields: x-amz-meta-original-filename, x-amz-meta-fileid, x-amz-meta-created-by etc. This helps auditing and downloads.

Lifecycle:

exports/ prefix for temporary artifacts (flatten/package) should have lifecycle rules to expire after e.g. 24 hours.

C — API surface (server endpoints)

Authentication: every endpoint requires authenticated user (Firebase Auth bearer token verified server-side). req.user.uid used for authorization.

Core endpoints:

Folder & file management (CRUD)

POST /api/folders — create folder under parent folder (body: parentPath or parentFolderId, name)

PATCH /api/folders/{folderId} — rename folder (update name field)

DELETE /api/folders/{folderId} — delete folder (recursively delete children or refuse if non-empty depending on policy)

POST /api/files/upload — multipart upload to create a new file in a given folder (body: parentFolderId, file field). Backend:

validate user quota / VIP,

generate fileId,

compute S3 prefix: users/{uid}/folders/{folderId}/children/{fileId}/,

upload PDF to …/file-{fileId}.pdf (server PUT or client presigned multipart),

create file doc in Firestore with s3PdfKey and s3AnnotationsKey set,

increment fileCount in /users/{uid} atomically.

GET /api/folders/{folderId}/children — list children (files and folders) for UI tree (do not return annotations keys).

PATCH /api/files/{fileId} — rename file: name field change. (If you want to change S3 file name too, see rename section.)

DELETE /api/files/{fileId} — delete file, delete S3 objects (pdf + annotations), decrement fileCount.

Open & annotations

POST /api/files/{fileId}/open
Response: { pdfUrl: <signed-url-get>, annotations: <json|null> }
Behavior: returns presigned GET for pdf, and the content of annotations JSON (server GETs annotations key and returns parsed JSON). If annotations file missing, returns empty annotation scaffold and ensures s3AnnotationsKey exists (writes empty JSON).

POST /api/files/{fileId}/annotations/save-request
Body: { payloadHash }
Response: { skip: true } or { uploadUrl: <presigned PUT>, expiresAt }
Behavior:

Verify owner/permission,

Read fileDoc.lastAnnotationsHash,

If equal → return skip,

Generate presigned PUT URL for s3AnnotationsKey (same folder), return to client.

POST /api/files/{fileId}/annotations/confirm
Body: { payloadHash }
Behavior: server verifies object exists in S3 (HeadObject), updates Firestore lastAnnotationsHash, lastSavedAt, optionally writes snapshot copy annotations-{fileId}-{ts}.json to snapshots folder (optional), returns success.

Exports & flatten (on-demand)

POST /api/files/{fileId}/flatten → server-side flatten job returns presigned GET to flattened PDF. (Will read pdf + annotations, composite overlay then upload to exports/… and return URL.)

POST /api/files/{fileId}/package → create ZIP with original PDF + flattened + annotations; return presigned GET.

Admin / VIP

POST /api/admin/users/{uid}/vip — grant VIP (owner-only)

DELETE /api/admin/users/{uid}/vip — revoke VIP

GET /api/users/me — return isVip, fileCount etc.

D — Save flow, concurrency and conflict detection (industry-grade)

The single-click save must be reliable and instant-perception. Use this robust pattern:

Client computes canonical annotation JSON (deterministic ordering) and computes SHA-256 hash (clientHash).

Client calls POST /api/files/{fileId}/annotations/save-request with { payloadHash: clientHash }.

Server compares payloadHash with Firestore lastAnnotationsHash.

If equal: return { skip: true } — client treats as successful save; no writes.

If different: server returns presigned PUT URL for s3AnnotationsKey.

Client PUTs JSON to the provided uploadUrl (Content-Type application/json).

Client calls POST /api/files/{fileId}/annotations/confirm with { payloadHash: clientHash }.

Server HEADs the object to ensure it exists, reads metadata if desired,

Server updates Firestore lastAnnotationsHash = payloadHash, lastSavedAt = serverTimestamp and optionally writes a snapshot to snapshots/.

SaveManager on the client receives success → updates controller.lastSavedHash = payloadHash and clears dirty state. If autosave is on, it restarts the 60s timer.

Why this pattern:

Avoids partial writes and race conditions: server confirms the object exists before updating Firestore.

Enables short-circuit skip for redundant saves.

Firestore is the metadata authority (lastAnnotationsHash) while S3 holds payload blob.

Retries and backoff:

If PUT fails, SaveManager should retry with exponential backoff (e.g., 1s, 2s, 4s) up to N tries, then mark file saveState=error and pause autosave until manual retry.

On confirm failure (object missing) report server error and keep pending save in local queue and IDB for recovery.

Atomicity:

There is no distributed transaction with S3; the two-phase flow (presign + confirm) is a pragmatic eventual-consistent approach.

Conflict detection / collaborative safety:

lastAnnotationsHash detects simple last-write-wins conflicts.

To implement conflict UI later: when server sees clientHash != lastAnnotationsHash, it can return conflict: true and include serverHash: the client then prompts user to fetch latest and merge or overwrite.

For real-time collaboration you'll replace/augment with an OT/CRDT sync later.

E — Client SaveManager integration (single/double click UX)

SaveManager responsibilities (already discussed in Step 4) remain:

markDirty(file) when editor state changes

saveNow(file, reason) enqueues SaveJob with JSON payload and reason

Single-click Save:

saveNow(file, "manual") invoked

SaveManager calls fileController.enqueue SaveJob

CloudSaveAdapter does the presign/PUT/confirm flow

On success: UI toast "Saved", controller.lastSavedHash updated, and autosave timer reset (start counting from 0)

Double-click Save (modal):

UI opens modal listing file name + tag (Cloud vs Local)

Options:

Save (manual save) — same as single click

Autosave toggle — sets file meta and triggers SaveManager.enableAutosave(file, interval)

JSON — triggers download of current annotations (saveNow then client-side download)

Flatten PDF — calls POST /api/files/{fileId}/flatten (wait for job/presigned URL to download)

Package — POST /api/files/{fileId}/package

UX: double-click should not be interpreted as two single-click saves — detect double-click in UI code (e.g., time threshold) or implement single-click trigger on mouseup only if no second click within 300ms. Alternatively use an explicit "•••" menu for options to avoid accidental double-click confusion.

Autosave:

Default 60s for cloud files (file-level setting)

Autosave is a scheduler: only runs if saveState === "dirty" and controller.queue idle

If autosave causes failure, pause autosave for that file and notify user

Important: when manual save occurs, restart autosave timer for that file (i.e., clear and re-set interval).

Local files:

Maintained via LocalSaveAdapter (IndexedDB-first), with same SaveManager APIs for uniformity.

F — Rename / Move / Delete semantics (industry choices & recommended implementation)

You demanded the ability to rename folders and files and reflect that on UI and AWS.

Two possible strategies — choose one (I recommend A):

Option A — Metadata rename (recommended)

Keep S3 keys based on fileId (immutable). s3PdfKey = users/{uid}/folders/{folderId}/children/{fileId}/file-{fileId}.pdf.

Rename is an atomic Firestore update: update name field on file doc and updatedAt.

Pros:

Fast, cheap, no S3 copies.

Minimal downtime; no rekeying.

Cons:

S3 object key does not reflect new name (not visible to user anyway).

Recommendation: Use Option A. Keep S3 keys stable and show name from Firestore. Only perform server-side copy if user explicitly requests “Mirror filename in S3” (rare).

Move folder/file:

Update folder hierarchy (either move doc under new parent subcollection or update pathIds array).

If S3 key is computed from folder path and must change, perform copy; otherwise update Firestore only.

Delete:

When deleting a file, delete S3 objects (pdf + annotations), then delete Firestore doc in a transaction or in well ordered steps (delete S3 first, then Firestore). If S3 delete fails, report error.

G — Visibility rules (hide annotation files from UI)

Never surface s3AnnotationsKey or annotations-{fileId} in list APIs.

GET /api/folders/{folderId}/children returns only:

for folders: { id, type: 'folder', name, createdAt, updatedAt }

for files: { id, type: 'file', name, displayName, sizeBytes, createdAt, lastSavedAt } — no annotation key

Only POST /api/files/{fileId}/open returns actual annotation content (server-side), not the annotation key.

This maintains the user illusion of in-place edits.

H — Security, quotas, logging, monitoring & production concerns

Authentication/Authorization:

Require Firebase Auth tokens; verify with admin SDK server-side.

For admin actions (VIP grant) require caller UID = owner uid or a server role. Do not use email string checks in prod.

Validate every fileId -> check owner via Firestore before returning presigned URLs.

Presigned URLs:

Use short expiry: 5 minutes for GET, 5 minutes for PUT.

Ensure PUT URL expects Content-Type: application/json and a reasonable max payload size header on server check (reject very large JSON).

Quotas and billing:

Use fileCount in /users/{uid} document and atomically increment/decrement with Firestore FieldValue.increment(1).

Enforce size limit on uploads (e.g., 100MB) unless VIP.

Audit logging:

Write actions like upload, save, flatten request, package request, rename, delete to a Firestore collection /audit/users/{uid}/... or admin_logs.

Log server-side metrics to CloudWatch (S3 errors, 5xxs, slow requests).

Monitoring:

CloudWatch/Prometheus for server errors, S3 errors, CPU, memory.

Alert on high 5xx rate or storage cost spikes.

Scaling:

Use presigned uploads + direct client upload to S3 for large PDFs (multipart upload) to avoid server bandwidth bottleneck; but if you need to validate before upload, use a multipart preflight scheme (request upload slots).

Use worker queue (SQS + Lambda/ECS) for heavy tasks (flattening) so main API remains responsive.

Backups & lifecycle:

Use lifecycle rules to expire exports/ after 24–72h.

Back up Firestore periodically (managed export) and S3 versioning if you want to keep snapshots.

Data residency & compliance:

Choose S3 region matching legal/regulatory requirements.

Encrypt S3 objects at rest (SSE-S3 or SSE-KMS) and enforce HTTPS.

Secret management:

Use IAM roles (not static keys) for production compute.

Store credentials/secrets in Parameter Store/Secrets Manager.
