-- ============================================================
-- Allow contact deletion without wiping broadcast history.
-- broadcast_recipients.contact_id becomes nullable + ON DELETE SET NULL.
-- ============================================================

ALTER TABLE broadcast_recipients
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcast_recipients_contact_id_fkey'
      AND conrelid = 'broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE broadcast_recipients
      DROP CONSTRAINT broadcast_recipients_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;
