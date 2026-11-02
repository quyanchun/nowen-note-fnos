import { getDb } from "../db/schema";

let installedFor: object | null = null;

/**
 * Last-resort protection for suspicious destructive body replacements.
 *
 * Normal version history intentionally merges edits made within five minutes. Recording
 * every autosave here would defeat that policy and grow note_versions on every keystroke.
 * The trigger therefore covers only the data-loss signature behind #200:
 *
 * - a non-empty body becomes empty; or
 * - a reasonably sized body loses more than 80% of its content in one write.
 *
 * If the route already recorded the exact OLD revision, the NOT EXISTS guard avoids a
 * duplicate. Deliberate large deletions still receive a recoverable pre-image.
 */
export function ensureNoteWriteSafetyTrigger(): void {
  const db = getDb();
  if (installedFor === db) return;

  db.exec(`
    DROP TRIGGER IF EXISTS notes_preserve_revision_before_overwrite;

    CREATE TRIGGER notes_preserve_revision_before_overwrite
    BEFORE UPDATE OF content, contentText ON notes
    WHEN
      (
        length(COALESCE(OLD.content, '')) > 0 AND
        length(COALESCE(NEW.content, '')) = 0
      ) OR (
        length(COALESCE(OLD.contentText, '')) > 0 AND
        length(COALESCE(NEW.contentText, '')) = 0
      ) OR (
        length(COALESCE(OLD.content, '')) >= 64 AND
        length(COALESCE(NEW.content, '')) * 5 < length(COALESCE(OLD.content, ''))
      ) OR (
        length(COALESCE(OLD.contentText, '')) >= 64 AND
        length(COALESCE(NEW.contentText, '')) * 5 < length(COALESCE(OLD.contentText, ''))
      )
    BEGIN
      INSERT INTO note_versions (
        id, noteId, userId, title, content, contentText, contentFormat,
        version, changeType, changeSummary, createdAt
      )
      SELECT
        lower(hex(randomblob(16))),
        OLD.id,
        OLD.userId,
        OLD.title,
        OLD.content,
        OLD.contentText,
        COALESCE(OLD.contentFormat, 'tiptap-json'),
        OLD.version,
        'edit',
        'Automatic safety snapshot before destructive overwrite',
        datetime('now')
      WHERE NOT EXISTS (
        SELECT 1
        FROM note_versions existing
        WHERE existing.noteId = OLD.id
          AND existing.version = OLD.version
          AND COALESCE(existing.title, '') = COALESCE(OLD.title, '')
          AND COALESCE(existing.content, '') = COALESCE(OLD.content, '')
          AND COALESCE(existing.contentText, '') = COALESCE(OLD.contentText, '')
          AND COALESCE(existing.contentFormat, '') = COALESCE(OLD.contentFormat, '')
      );
    END;
  `);

  installedFor = db;
}

ensureNoteWriteSafetyTrigger();
