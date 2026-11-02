# Attachment Object Storage

Nowen Note can keep attachment metadata in SQLite while storing attachment bytes either in the local data directory or in an S3-compatible bucket such as Cloudflare R2, MinIO, or AWS S3.

This feature is for attachments only. The main SQLite database remains the source of truth for notes, notebooks, users, permissions, and attachment metadata.

## Configuration Sources

Effective configuration is resolved in this order:

1. A saved admin config in Settings -> Data Management -> Attachment Storage.
2. A complete environment config.
3. Local storage under the data directory.

Use "Restore default source" in the UI to delete the saved admin config and return to environment/default resolution.

## Environment Variables

```bash
ATTACHMENT_STORAGE=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=nowen-note
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PREFIX=attachments
```

`S3_PREFIX` is optional. Keep it stable after migration because object keys are derived from it.

## UI Configuration

Admin users can configure object storage in Settings -> Data Management -> Attachment Storage.

The secret access key is encrypted before being saved in SQLite. Encryption uses a key derived from `JWT_SECRET`, so keep `JWT_SECRET` stable. If `JWT_SECRET` changes, previously saved secrets cannot be decrypted; save the object storage secret again in the UI.

The "Save and test" action writes and deletes a small probe object under `.nowen-note-probe/`.

## Migrating Existing Local Attachments

Always start with a dry run:

```bash
npm run migrate:attachments:object -- --dry-run
```

Then apply:

```bash
npm run migrate:attachments:object -- --apply
```

The migration script uses complete environment variables first. If env vars are not set, it reads the saved UI config from the SQLite database.

When the saved UI config contains an encrypted secret, run the migration with the same `JWT_SECRET` used by the backend that saved the config:

```bash
JWT_SECRET=<same-secret> npm run migrate:attachments:object -- --apply
```

Useful options:

```bash
npm run migrate:attachments:object -- --dry-run --limit 100 --verbose
npm run migrate:attachments:object -- --apply --include-existing
npm run migrate:attachments:object -- --db /path/to/nowen-note.db --attachments-dir /path/to/attachments
```

The script only uploads missing objects. It does not delete local files, so rollback remains simple.

## Verification

In Settings -> Data Management -> Attachment Storage:

- "Refresh" shows the active storage driver and local/database counts.
- "Check remote" samples attachment paths from SQLite and checks whether the objects exist in the bucket.
- The migration command shown in the UI is the safe dry-run command.

For API clients, see `/api/openapi.json` and the `Attachment Storage` tag.

## Rollback

To stop writing new attachments to object storage:

1. Open Settings -> Data Management -> Attachment Storage.
2. Click "Restore default source" if the source is "settings".
3. Remove `ATTACHMENT_STORAGE`/`S3_*` env vars if you also want to disable env-based object storage.
4. Restart the backend if env vars changed.

Existing object-storage attachments remain readable while the object storage config is active. If you fully disable object storage, only local files in the attachment directory are available.
