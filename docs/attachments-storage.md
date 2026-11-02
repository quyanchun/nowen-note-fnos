# Attachment Storage

Nowen Note stores user-uploaded files (images, documents, etc.) as attachments. Metadata lives in SQLite; file bytes are stored either on the local filesystem or in an S3-compatible object storage bucket.

This document covers the storage layout, database schema, thumbnail generation, orphan cleanup, and backup recommendations.

---

## 1. Note Attachments

Note attachments are files uploaded through the rich-text editor (paste, drag-and-drop, or toolbar insert).

### Database

Table: **`attachments`**

| Column     | Type   | Description                                  |
| ---------- | ------ | -------------------------------------------- |
| id         | TEXT   | UUID v4 primary key                          |
| noteId     | TEXT   | FK to `notes.id` (ON DELETE CASCADE)         |
| userId     | TEXT   | Uploader user ID                             |
| filename   | TEXT   | Original filename from the client            |
| mimeType   | TEXT   | MIME type (e.g. `image/png`)                 |
| size       | INTEGER| File size in bytes                           |
| path       | TEXT   | Relative path under ATTACHMENTS_DIR          |
| workspaceId| TEXT   | NULL = personal space; otherwise workspace ID|
| hash       | TEXT   | SHA-256 hex for deduplication                |

### API

- **Upload**: `POST /api/attachments` (multipart/form-data, requires `file` + `noteId`)
- **Download**: `GET /api/attachments/<id>` (no JWT required; protected by UUID unguessability)
- **Delete**: `DELETE /api/attachments/<id>` (requires write permission on the parent note)

The download endpoint supports an optional `?w=240|480|960` query parameter for on-the-fly thumbnail delivery (see Section 3).

### File Path

New uploads are stored at:

```
data/attachments/YYYY/MM/<uuid>.<ext>
```

For example: `data/attachments/2026/06/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png`

The `YYYY/MM` prefix distributes files across monthly subdirectories, avoiding a single flat directory that could degrade filesystem performance at scale.

**Legacy compatibility**: Files uploaded before the monthly-directory layout remain at the old flat path `data/attachments/<uuid>.<ext>`. Both path formats are fully supported. The download handler, orphan scanner, and migration tooling all accept either pattern. There is no forced migration of existing files.

---

## 2. Task Attachments

Task attachments are images inserted into the todo/task module (e.g. screenshots in task titles).

### Database

Table: **`task_attachments`**

| Column     | Type   | Description                                    |
| ---------- | ------ | ---------------------------------------------- |
| id         | TEXT   | UUID v4 primary key                            |
| taskId     | TEXT   | FK to `tasks.id` (ON DELETE CASCADE), nullable |
| userId     | TEXT   | Uploader user ID                               |
| filename   | TEXT   | Original filename                              |
| mimeType   | TEXT   | MIME type                                      |
| size       | INTEGER| File size in bytes                             |
| path       | TEXT   | Relative path under ATTACHMENTS_DIR            |
| workspaceId| TEXT   | NULL = personal space; otherwise workspace ID  |

`taskId` is nullable to support a "pre-upload" workflow: the user pastes an image before the task is created. The frontend later binds the attachment to the task via `PATCH /api/task-attachments/<id>/bind`.

### API

- **Upload**: `POST /api/task-attachments` (multipart/form-data, requires `file`; `taskId` is optional)
- **Download**: `GET /api/task-attachments/<id>` (no JWT required; same UUID-unguessability model)
- **Bind**: `PATCH /api/task-attachments/<id>/bind` (associate orphan attachment to a task)
- **Delete**: `DELETE /api/task-attachments/<id>`

### Storage Directory

Task attachments share the same `ATTACHMENTS_DIR` (`data/attachments/`) as note attachments. File names are UUID-based, so there is no collision between the two tables. The `path` column in `task_attachments` uses the same `YYYY/MM/<uuid>.<ext>` format as note attachments.

---

## 3. Thumbnails

Thumbnail generation is handled by the `sharp` library (loaded at runtime; if unavailable, the system gracefully falls back to returning the original image).

### Directory

Thumbnails are cached under:

```
data/attachments/.thumbs/<id>_w<width>.webp
```

For example: `data/attachments/.thumbs/a1b2c3d4-e5f6-7890-abcd-ef1234567890_w480.webp`

The `.thumbs` directory is a hidden subdirectory of `ATTACHMENTS_DIR`. It is automatically excluded from orphan scanning, directory size statistics, and migration tooling.

### Supported Widths

Three fixed widths are supported (no arbitrary sizes, to prevent disk-exhaustion DoS):

| Width | Use Case                        |
| ----- | ------------------------------- |
| 240   | Card view (mobile, compact)     |
| 480   | HiDPI card view                 |
| 960   | Detail drawer / medium preview  |

Request a thumbnail by appending `?w=<width>` to the attachment download URL:

```
GET /api/attachments/<id>?w=480
```

### Format and Quality

- Output format: **WebP** (quality 78, effort 4)
- Aspect ratio is preserved; images are never enlarged or cropped
- GIF: only the first frame is extracted (static thumbnail)
- SVG / ICO: skipped; the original file is returned directly

### Lifecycle

- Thumbnails are generated on first request and cached to disk
- When an attachment is deleted, its thumbnail cache entries are also removed (best-effort)
- The orphan cleanup scanner **skips** the `.thumbs` directory entirely (see Section 4)

---

## 4. Orphan Cleanup

"Orphan" files are attachment bytes on disk that have no corresponding database record, or database records whose parent notes no longer reference them. The system provides two cleanup entry points.

### Admin Orphan Scanner

Endpoint: `GET /api/attachments/_orphans/scan`
Cleanup: `POST /api/attachments/_orphans/clean`

This endpoint (admin-only) scans for:

1. **DB orphans**: Files on disk with no matching row in `attachments`.
2. **Content orphans**: Rows in `attachments` whose `id` is no longer referenced by any `notes.content`.

A configurable grace period (default 24 hours) protects recently uploaded attachments that have not yet been saved to a note's content.

### Data Management Cleanup

Endpoint: `POST /api/data/cleanup` (admin-only)

This is the broader "cleanup everything" endpoint. The disk orphan scan constructs a `knownPaths` set from:

```sql
SELECT path FROM attachments
UNION
SELECT path FROM task_attachments
```

**Critical**: Both `attachments.path` and `task_attachments.path` are included. If `task_attachments.path` were omitted, the scanner would treat task attachment files as disk orphans and delete them, causing broken images in the todo module. The `.thumbs` subdirectory is also explicitly skipped during the recursive scan.

### What Cannot Be Recovered

Once a physical file is deleted by the orphan cleanup (or any other process), it is gone. The database record (if it still exists) will point to a missing file, and the attachment will return HTTP 404. The only recovery paths are:

- Restoring from a filesystem backup
- Restoring from a NAS / cloud snapshot
- Re-uploading the original file via the admin repair endpoint (`POST /api/attachments/_repair/missing/:id/upload`)

---

## 5. Backup Recommendations

A complete backup of Nowen Note's attachment data requires three components:

### 5.1 SQLite Database

Back up the main database file:

```
data/nowen-note.db
```

For a consistent snapshot, either:
- Use the built-in backup API (`POST /api/backups/create`), which checkpoints WAL before copying, or
- Stop the backend, then copy the `.db` file (and its `-wal` / `-shm` sidecar files if present)

### 5.2 Attachments Directory

Back up the entire directory:

```
data/attachments/
```

This includes:
- All note attachment files (both flat `uuid.ext` and nested `YYYY/MM/uuid.ext`)
- All task attachment files (same directory, UUID filenames)
- Thumbnail cache (`.thumbs/` subdirectory) -- optional, can be regenerated

If using rsync or similar tools, preserve the directory structure. Do not exclude the `.thumbs` directory if you want instant thumbnail availability after restore; otherwise thumbnails will be regenerated on demand.

### 5.3 Object Storage Configuration

If object storage (S3 / R2 / MinIO) is enabled, back up or document:

- The bucket name and endpoint
- The access key ID and secret access key
- The prefix configuration
- The encryption salt used to protect the saved secret (stored in `system_settings`)

See [object-storage.md](./object-storage.md) for details.

---

## 6. Object Storage

For deployments where local disk is insufficient or where multi-server scaling is needed, Nowen Note supports storing attachment bytes in any S3-compatible object storage service.

### Supported Backends

- **AWS S3**
- **Cloudflare R2**
- **MinIO** (self-hosted)
- Any service implementing the S3 API

### How It Works

When object storage is enabled, new uploads are written to the configured S3 bucket instead of the local filesystem. Reads transparently fetch from the bucket. The `attachments` / `task_attachments` tables still store the relative `path` in the same format; the storage driver determines whether to resolve it locally or remotely.

Local files and object storage can coexist during migration. The migration script uploads local files to the bucket without deleting them, so rollback is straightforward.

### Configuration

Object storage can be configured via:

1. **Admin UI**: Settings > Data Management > Attachment Storage
2. **Environment variables**: `ATTACHMENT_STORAGE=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX`

For full setup, migration, and rollback instructions, see [object-storage.md](./object-storage.md).
