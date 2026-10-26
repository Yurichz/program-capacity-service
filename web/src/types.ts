export interface Meta {
  total: number;
  lastPage: number;
  currentPage: number;
  perPage: number;
  prev: number | null;
  next: number | null;
}
export interface Result<T> {
  success: true;
  data: T;
  meta?: Meta;
}
export interface User {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
}
export interface Program {
  programId: string;
  currency: string;
  limit: string;
  reserved: string;
  available: string;
  overLimit: string;
  stateVersion: string;
  syncStatus: 'READY' | 'RECONCILIATION_REQUIRED';
  acceptingReservations: boolean;
  lastAppliedTreasuryAt: string | null;
  activeReservationCount?: number;
}
export interface Reservation {
  id: string;
  programId: string;
  invoiceId: string;
  amount: string;
  currency: string;
  reservedAmount: string;
  programCurrency: string;
  status: 'ACTIVE' | 'RELEASED' | 'RECONCILED_CLOSED';
  createdAt: string;
  closedAt: string | null;
  fx: { rate: string; direction: string; source: string; asOf: string };
}
export interface Movement {
  id: string;
  programId: string;
  reservationId: string | null;
  currency: string;
  reservedDelta: string;
  limitDelta: string;
  reason: string;
  stateVersion: string;
  createdAt: string;
}
export interface View {
  programId: string;
  currency: string;
  limit: string;
  stateVersion: string;
  lastAppliedTreasuryRevision: string;
  highestSeenTreasuryRevision: string;
  reservations: Reservation[];
}
export interface TreasuryEvent {
  id: string;
  eventId: string;
  programId: string;
  type: string;
  treasuryRevision: string;
  resultCode: string | null;
  createdAt: string;
}
export interface EventEnvelope {
  schemaVersion: 1;
  eventId: string;
  type: 'ProgramStateSnapshot' | 'ProgramLimitUpdated';
  tenantId: string;
  programId: string;
  treasuryRevision: string;
  occurredAt: string;
  payload: object;
}
