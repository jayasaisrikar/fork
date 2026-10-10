CREATE TRIGGER ledger_postings_no_update BEFORE UPDATE ON ledger_postings
BEGIN
  SELECT RAISE(ABORT, 'ledger_postings is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER ledger_postings_no_delete BEFORE DELETE ON ledger_postings
BEGIN
  SELECT RAISE(ABORT, 'ledger_postings is append-only');
END;
