-- NE2 — relabel historical fabricated resend rows (notifications-email-engine).
--
-- Before NE2, NotificationTemplatesService.resend() was a stub: it wrote a
-- NotificationLog row with status='sent' and metadata={ "resendOf": <id> } but
-- NEVER enqueued or dispatched anything. Those rows lie — they inflate the
-- deliverability audit trail with sends that never happened (plan Risk R4).
--
-- This one-shot data migration relabels them to the honest terminal status
-- 'failed' (the dispatch did not succeed) and stamps a marker so the relabel is
-- auditable and so analytics can exclude them. The original 'resendOf' pointer
-- is preserved.
--
-- Idempotent: once a row is relabeled its status is no longer 'sent', so the
-- WHERE predicate stops matching and a re-run is a no-op. Genuine NE2 resends
-- never carry 'resendOf' (the new code re-enqueues through MailService and lets
-- the worker write the real status), so this can never touch a real send.
--
-- Rollback: data-only; there is no schema change to reverse. The relabeled rows
-- cannot be restored to 'sent' precisely because that status was never true —
-- the marker `metadata.relabeledBy = 'NE2'` identifies them if needed.

UPDATE "NotificationLog"
  SET "status" = 'failed',
      "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{relabeledBy}',
        '"NE2"'::jsonb,
        true
      )
  WHERE "status" = 'sent'
    AND "metadata" ? 'resendOf';
