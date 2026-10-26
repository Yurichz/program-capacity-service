ALTER TABLE "Program" ADD CONSTRAINT "program_amounts" CHECK (
  "limitMinor" >= 0 AND "reservedMinor" >= 0 AND "stateVersion" >= 0 AND
  "lastAppliedTreasuryRevision" >= 0 AND "highestSeenTreasuryRevision" >= "lastAppliedTreasuryRevision");
ALTER TABLE "Program" ADD CONSTRAINT "program_currency" CHECK ("currency" IN ('USD','EUR','GBP','JPY','KWD'));
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_money" CHECK (
  "invoiceMinor" > 0 AND "reservedMinor" > 0 AND "fxRate" > 0 AND
  "invoiceCurrency" IN ('USD','EUR','GBP','JPY','KWD') AND
  "fxDirection" = 'PROGRAM_MAJOR_PER_INVOICE_MAJOR');
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_terminal_time" CHECK (
  ("status" = 'ACTIVE' AND "closedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "closedAt" IS NOT NULL));
ALTER TABLE "TreasuryInbox" ADD CONSTRAINT "inbox_revision" CHECK ("revision" > 0);
ALTER TABLE "IdempotencyRequest" ADD CONSTRAINT "idempotency_result" CHECK (
  ("status" IS NULL AND "result" IS NULL) OR ("status" BETWEEN 200 AND 599 AND "result" IS NOT NULL));

CREATE FUNCTION deny_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CapacityMovement is append-only'; END;
$$;
CREATE TRIGGER movement_append_only BEFORE UPDATE OR DELETE ON "CapacityMovement"
  FOR EACH ROW EXECUTE FUNCTION deny_movement_mutation();

CREATE FUNCTION protect_reservation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Reservation history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'status' - 'closedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closedAt')
    OR OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Reservation financial data and terminal state are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_history BEFORE UPDATE OR DELETE ON "Reservation"
  FOR EACH ROW EXECUTE FUNCTION protect_reservation_history();
