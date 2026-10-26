import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, command, message } from './api';
import { minor, money, scales, utilization } from './money';
import { useResource } from './use-resource';
import {
  Badge,
  date,
  Dialog,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  Pagination,
  Panel,
  reason,
  ReservationStatus,
} from './ui';
import type { Workspace } from './App';
import type { EventEnvelope, Movement, Program, Reservation, TreasuryEvent, View } from './types';

const base = (id: string) => `/api/v1/programs/${id}`;
const internal = (id: string) => `/api/v1/internal/programs/${id}`;
function canWrite(roles: string[]) {
  return roles.includes('USER') || roles.includes('APP_ADMIN');
}
function SyncNotice({ program }: { program: Program }) {
  return program.acceptingReservations ? null : (
    <div className="notice notice-warning">
      <Icon name="alert" size={19} />
      <span>
        <strong>
          {program.syncStatus !== 'READY'
            ? 'A fresh reconciliation is required.'
            : 'New reservations are currently paused.'}
        </strong>{' '}
        {program.syncStatus !== 'READY'
          ? 'Open Treasury to reconcile this program. Reads and releases remain available.'
          : 'Check available capacity, the active reservation limit, and the treasury connection.'}
      </span>
    </div>
  );
}
function ReservationTable({
  rows,
  details,
}: {
  rows: Reservation[];
  details: (r: Reservation) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Amount</th>
            <th>Reserved</th>
            <th>Status</th>
            <th>Created</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="invoice-cell">
                  <span className="document-icon">
                    <Icon name="file" size={18} />
                  </span>
                  <span>
                    <strong>{r.invoiceId}</strong>
                    <small>{r.id.slice(0, 8)}</small>
                  </span>
                </div>
              </td>
              <td className="numeric">
                {money(r.amount, r.currency)} <span className="currency-code">{r.currency}</span>
              </td>
              <td className="numeric">
                <strong>{money(r.reservedAmount, r.programCurrency)}</strong>{' '}
                <span className="currency-code">{r.programCurrency}</span>
              </td>
              <td>
                <ReservationStatus value={r.status} />
              </td>
              <td className="muted nowrap">{date(r.createdAt, true)}</td>
              <td>
                <button
                  className="table-action"
                  onClick={() => details(r)}
                  aria-label={`View invoice ${r.invoiceId}`}
                >
                  View <Icon name="arrow" size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MovementList({ rows }: { rows: Movement[] }) {
  return (
    <div className="movement-list">
      {rows.map((r) => (
        <div className="movement-row" key={r.id}>
          <span
            className={`movement-icon ${r.reservedDelta.startsWith('-') ? 'movement-green' : ''}`}
          >
            <Icon
              name={
                r.reason.includes('RECONCIL')
                  ? 'shield'
                  : r.limitDelta !== '0.00'
                    ? 'wallet'
                    : 'file'
              }
              size={18}
            />
          </span>
          <div>
            <strong>{reason(r.reason)}</strong>
            <small>
              {date(r.createdAt)} <span>· Version {r.stateVersion}</span>
            </small>
          </div>
          <span className="movement-amount">
            {r.reservedDelta !== '0.00'
              ? `${r.reservedDelta.startsWith('-') ? '' : '+'}${money(r.reservedDelta, r.currency)}`
              : `${r.limitDelta.startsWith('-') || minor(r.limitDelta, r.currency) === 0n ? '' : '+'}${money(r.limitDelta, r.currency)}`}
            <small>{r.currency}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
export function Overview(workspace: Workspace) {
  const { program: p, user, revision, reserve, details } = workspace;
  const reservations = useResource<Reservation[]>(
    `${base(p.programId)}/reservations?perPage=5`,
    revision,
  );
  const movements = useResource<Movement[]>(`${base(p.programId)}/movements?perPage=4`, revision);
  const used = utilization(p.reserved, p.limit, p.currency);
  const stats = [
    {
      title: 'Program limit',
      value: p.limit,
      icon: 'wallet',
      note: 'Your total funding capacity',
      style: 'blue',
    },
    {
      title: 'Reserved capacity',
      value: p.reserved,
      icon: 'stack',
      note: `${p.activeReservationCount ?? 0} active reservations`,
      style: 'violet',
    },
    {
      title: 'Available to reserve',
      value: p.available,
      icon: 'check',
      note: 'Ready for your next invoice',
      style: 'green',
    },
    {
      title: 'Over limit',
      value: p.overLimit,
      icon: 'alert',
      note:
        minor(p.overLimit, p.currency) === 0n
          ? 'You’re within your limit'
          : 'Reserved capacity exceeds limit',
      style: 'orange',
    },
  ];
  return (
    <>
      <section className="welcome-banner">
        <div>
          <span className="welcome-label">A LITTLE MORE CLARITY, EVERY DAY</span>
          <h2>
            Hello, {user.firstName ?? user.email.split('@')[0]} <span aria-hidden="true">👋</span>
          </h2>
          <p>Your next move starts with a clear picture.</p>
          <div className="welcome-status">
            <span className="welcome-status-dot" />
            {p.syncStatus === 'READY' ? 'Program reconciled' : 'Reconciliation needed'}
            <span className="welcome-divider" />
            State version {p.stateVersion}
          </div>
        </div>
        <div className="welcome-orbit" aria-hidden="true">
          <div />
          <div />
          <span>
            <Icon name="shield" size={40} />
          </span>
        </div>
        <button
          className="button button-white"
          onClick={reserve}
          disabled={!p.acceptingReservations || !canWrite(user.roles)}
        >
          <Icon name="plus" size={18} />
          New reservation
        </button>
      </section>
      <SyncNotice program={p} />
      <div className="stats-grid">
        {stats.map((s) => (
          <section className="stat-card" key={s.title}>
            <div className="stat-top">
              <span>{s.title}</span>
              <span className={`stat-icon stat-${s.style}`}>
                <Icon name={s.icon} size={18} />
              </span>
            </div>
            <div className="stat-value">
              <span>{p.currency}</span>
              <strong>{money(s.value, p.currency)}</strong>
            </div>
            <div className="stat-note">
              {s.title === 'Over limit' && minor(p.overLimit, p.currency) === 0n && (
                <span className="tiny-green-dot" />
              )}
              {s.note}
            </div>
          </section>
        ))}
      </div>
      <div className="overview-middle">
        <Panel
          title="Capacity at a glance"
          subtitle="Your funding, clearly allocated"
          action={
            <Badge tone={p.syncStatus === 'READY' ? 'green' : 'orange'}>
              {p.syncStatus === 'READY' ? 'In sync' : 'Action needed'}
            </Badge>
          }
        >
          <div className="capacity-visual">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#378df6 ${used}%, #eaf1fb 0)`,
              }}
              role="img"
              aria-label={`${used.toFixed(2)} percent of capacity reserved`}
            >
              <div>
                <strong>
                  {used.toFixed(1)}
                  <span>%</span>
                </strong>
                <small>capacity utilised</small>
              </div>
            </div>
            <div className="capacity-legend">
              <div>
                <span className="legend-dot legend-blue" />
                <span>Reserved</span>
                <strong>{money(p.reserved, p.currency, true)}</strong>
              </div>
              <div>
                <span className="legend-dot legend-light" />
                <span>Available</span>
                <strong>{money(p.available, p.currency, true)}</strong>
              </div>
              <p>
                <Icon name="lock" size={14} />
                Calculated from your current program state
              </p>
            </div>
          </div>
        </Panel>
        <Panel
          title="Treasury connection"
          subtitle="A consistent view, across your program"
          className="treasury-card"
        >
          <div className="connection-visual">
            <span className="connection-node">
              <Icon name="wallet" size={25} />
            </span>
            <span className="connection-line">
              <span />
            </span>
            <span className="connection-node connection-node-blue">
              <Icon name="shield" size={25} />
            </span>
          </div>
          <div className="connection-state">
            <strong>
              {p.syncStatus === 'READY' ? 'Everything is in sync' : 'Let’s get you in sync'}
            </strong>
            <p>
              {p.syncStatus === 'READY'
                ? 'Your program reflects the latest applied treasury state.'
                : 'Apply a fresh treasury snapshot to enable new reservations.'}
            </p>
          </div>
          <div className="connection-footer">
            <span>
              Last treasury update
              <strong>{date(p.lastAppliedTreasuryAt)}</strong>
            </span>
            {(user.roles.includes('TREASURY') || user.roles.includes('APP_ADMIN')) && (
              <Link to="/treasury" className="table-action">
                View treasury <Icon name="arrow" size={14} />
              </Link>
            )}
          </div>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title="Recent reservations"
          subtitle="The latest invoices in your program"
          action={
            <Link className="text-button" to="/reservations">
              View all <Icon name="arrow" size={15} />
            </Link>
          }
        >
          {reservations.error != null && (
            <ErrorNotice error={reservations.error} retry={() => void reservations.reload()} />
          )}{' '}
          {reservations.loading ? (
            <Loading />
          ) : reservations.data?.length ? (
            <ReservationTable rows={reservations.data} details={details} />
          ) : (
            <Empty
              title="Room for your next invoice"
              text="Create a reservation to put your available capacity to work."
            />
          )}
        </Panel>
        <Panel
          title="Latest activity"
          subtitle="Every change, accounted for"
          action={
            <Link className="icon-button" to="/activity" aria-label="View all activity">
              <Icon name="arrow" size={17} />
            </Link>
          }
        >
          {movements.error != null && (
            <ErrorNotice error={movements.error} retry={() => void movements.reload()} />
          )}{' '}
          {movements.loading ? (
            <Loading />
          ) : movements.data?.length ? (
            <MovementList rows={movements.data} />
          ) : (
            <Empty title="A fresh start" text="Your program movements will appear here." />
          )}
        </Panel>
      </div>
    </>
  );
}
export function Reservations({ program, revision, reserve, details, user }: Workspace) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [program.programId]);
  const params = new URLSearchParams({
    page: String(page),
    perPage: '10',
    ...(query ? { invoiceId: query } : {}),
    ...(status ? { status } : {}),
    ...(currency ? { currency } : {}),
  });
  const resource = useResource<Reservation[]>(
    `${base(program.programId)}/reservations?${params}`,
    revision,
  );
  return (
    <>
      <SyncNotice program={program} />
      <Panel
        title="All reservations"
        subtitle="Track, review and release your invoice capacity"
        action={
          <button
            className="button button-primary"
            onClick={reserve}
            disabled={!program.acceptingReservations || !canWrite(user.roles)}
          >
            <Icon name="plus" size={17} />
            New reservation
          </button>
        }
      >
        <div className="filters">
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              aria-label="Search invoices"
              placeholder="Search by invoice ID…"
              maxLength={128}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="filter-select">
            <span className="sr-only">Status</span>
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="RELEASED">Released</option>
              <option value="RECONCILED_CLOSED">Reconciled</option>
            </select>
          </label>
          <label className="filter-select">
            <span className="sr-only">Currency</span>
            <select
              aria-label="Currency filter"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All currencies</option>
              {Object.keys(scales).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {resource.error != null && (
          <ErrorNotice error={resource.error} retry={() => void resource.reload()} />
        )}{' '}
        {resource.loading ? (
          <Loading />
        ) : resource.data?.length ? (
          <ReservationTable rows={resource.data} details={details} />
        ) : (
          <Empty
            title={
              query || status || currency
                ? 'No matching reservations'
                : 'Your first reservation starts here'
            }
            text={
              query || status || currency
                ? 'Try another invoice ID or adjust your filters.'
                : 'Reserve capacity for an invoice and keep everything in view.'
            }
          />
        )}
        <Pagination meta={resource.meta} change={setPage} />
      </Panel>
    </>
  );
}
export function Activity({ program, revision }: Workspace) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [program.programId]);
  const rows = useResource<Movement[]>(
    `${base(program.programId)}/movements?page=${page}&perPage=10`,
    revision,
  );
  return (
    <Panel
      title="Program movements"
      subtitle="An immutable record of your financial activity"
      action={
        <span className="subtle-label">
          <Icon name="lock" size={14} />
          Audit trail
        </span>
      }
    >
      {rows.error != null && (
        <ErrorNotice error={rows.error} retry={() => void rows.reload()} />
      )}{' '}
      {rows.loading ? (
        <Loading />
      ) : rows.data?.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Movement</th>
                <th>Reserved change</th>
                <th>Limit change</th>
                <th>Version</th>
                <th>Date & time</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="invoice-cell">
                      <span className="document-icon">
                        <Icon
                          name={r.reason.includes('RECONCIL') ? 'shield' : 'activity'}
                          size={18}
                        />
                      </span>
                      <span>
                        <strong>{reason(r.reason)}</strong>
                        <small>
                          {r.reservationId
                            ? `Reservation ${r.reservationId.slice(0, 8)}`
                            : `Movement ${r.id.slice(0, 8)}`}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td
                    className={`numeric ${r.reservedDelta.startsWith('-') ? 'positive-text' : ''}`}
                  >
                    {money(r.reservedDelta, r.currency, true)}
                  </td>
                  <td className="numeric">{money(r.limitDelta, r.currency, true)}</td>
                  <td>
                    <span className="version-tag">v{r.stateVersion}</span>
                  </td>
                  <td className="muted nowrap">{date(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="Every movement will be here"
          text="Reservations, releases and treasury updates create a complete audit trail."
        />
      )}
      <Pagination meta={rows.meta} change={setPage} />
    </Panel>
  );
}
export function ReserveDialog({
  program,
  close,
  complete,
}: {
  program: Program;
  close: () => void;
  complete: (r: Reservation) => void;
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(program.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (minor(amount, currency) <= 0n) throw new Error('Enter an amount greater than zero.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enter a valid amount.');
      return;
    }
    setBusy(true);
    try {
      const r = await command<Reservation>(`${base(program.programId)}/reservations`, {
        invoiceId,
        amount,
        currency,
      });
      complete(r.data);
    } catch (failure) {
      const unknown = failure instanceof ApiError && failure.uncertain;
      setUncertain(unknown);
      setError(
        unknown
          ? 'The outcome is unknown. Retry this exact request; your idempotency key is preserved.'
          : message(failure),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="New reservation"
      subtitle="Put your available capacity to work."
      close={close}
      busy={busy || uncertain}
    >
      <form className="stacked-form" onSubmit={submit}>
        <div className="form-capacity">
          <span>Available capacity</span>
          <strong>{money(program.available, program.currency, true)}</strong>
        </div>
        <label>
          Invoice ID
          <input
            aria-label="Invoice ID"
            autoFocus
            data-autofocus
            required
            pattern="[A-Za-z0-9_.:\-]{1,128}"
            maxLength={128}
            placeholder="e.g. INV-2026-001"
            value={invoiceId}
            disabled={busy || uncertain}
            onChange={(e) => setInvoiceId(e.target.value)}
          />
          <small>A unique reference within your tenant.</small>
        </label>
        <div className="form-row">
          <label>
            Amount
            <input
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={busy || uncertain}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Currency
            <select
              aria-label="Currency"
              value={currency}
              disabled={busy || uncertain}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {Object.keys(scales).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {currency !== program.currency && (
          <div className="notice notice-info">
            <Icon name="refresh" size={17} />
            <span>
              This invoice will be converted to {program.currency} using a fixture FX quote, rounded
              up. The applied rate is shown after reservation.
            </span>
          </div>
        )}
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={close}
            disabled={busy || uncertain}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Reserving…' : uncertain ? 'Retry exact request' : 'Create reservation'}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ReservationDetails({
  reservation: initial,
  canWrite: writable,
  close,
  complete,
}: {
  reservation: Reservation;
  canWrite: boolean;
  close: () => void;
  complete: (r: Reservation) => void;
}) {
  const [row, setRow] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [uncertain, setUncertain] = useState(false);
  const current = useResource<Reservation>(`${base(row.programId)}/reservations/${row.id}`);
  useEffect(() => {
    if (current.data)
      setRow((previous) =>
        previous.status !== 'ACTIVE' && current.data!.status === 'ACTIVE'
          ? previous
          : current.data!,
      );
  }, [current.data]);
  async function release() {
    setBusy(true);
    setError(null);
    try {
      const result = await command<Reservation>(
        `${base(row.programId)}/reservations/${row.id}/release`,
        {},
      );
      setRow(result.data);
      setConfirm(false);
      setUncertain(false);
      complete(result.data);
    } catch (failure) {
      setError(failure);
      setUncertain(failure instanceof ApiError && failure.uncertain);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Reservation details"
      subtitle={row.invoiceId}
      close={close}
      busy={busy || uncertain}
    >
      <div className="detail-summary">
        <span className="document-icon large">
          <Icon name="file" size={28} />
        </span>
        <div>
          <span className="small-label">RESERVED CAPACITY</span>
          <h3>{money(row.reservedAmount, row.programCurrency, true)}</h3>
        </div>
        <ReservationStatus value={row.status} />
      </div>
      <dl className="detail-list">
        <div>
          <dt>Invoice amount</dt>
          <dd>{money(row.amount, row.currency, true)}</dd>
        </div>
        <div>
          <dt>FX rate</dt>
          <dd>
            {row.fx.rate} {row.programCurrency} / {row.currency}
          </dd>
        </div>
        <div>
          <dt>FX source</dt>
          <dd>
            {row.fx.source} <span className="fixture-label">fixture</span>
          </dd>
        </div>
        <div>
          <dt>Quote time</dt>
          <dd>{date(row.fx.asOf)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{date(row.createdAt)}</dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>{date(row.closedAt)}</dd>
        </div>
        <div className="detail-id">
          <dt>Reservation ID</dt>
          <dd>{row.id}</dd>
        </div>
      </dl>
      {current.error != null && (
        <ErrorNotice error={current.error} retry={() => void current.reload()} />
      )}{' '}
      {error != null && <ErrorNotice error={error} />}{' '}
      {uncertain && (
        <div role="alert" className="notice notice-warning">
          The outcome is unknown. Retry the same release to obtain its saved result.
        </div>
      )}{' '}
      {(row.status === 'ACTIVE' || uncertain) && writable && (
        <>
          {confirm ? (
            <div className="release-confirm">
              <strong>Release this reservation?</strong>
              <p>
                {money(row.reservedAmount, row.programCurrency, true)} will be returned to available
                capacity. The saved FX amount is preserved.
              </p>
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  disabled={busy || uncertain}
                  onClick={() => setConfirm(false)}
                >
                  Keep reservation
                </button>
                <button className="button button-primary" disabled={busy} onClick={release}>
                  {busy ? 'Releasing…' : uncertain ? 'Retry exact release' : 'Confirm release'}
                </button>
              </div>
            </div>
          ) : (
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={close}>
                Close
              </button>
              <button className="button button-primary" onClick={() => setConfirm(true)}>
                Release reservation
                <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
export function Treasury({ program, revision, refresh, notify, captures, capture }: Workspace) {
  const id = program.programId;
  const [page, setPage] = useState(1);
  const view = useResource<View>(`${internal(id)}/reconciliation-view`, revision);
  const events = useResource<TreasuryEvent[]>(
    `${internal(id)}/treasury-events?page=${page}&perPage=10`,
    revision,
  );
  const config = useResource<{ enabled: boolean; tenantId: string }>(
    `/demo-api/programs/${id}/config`,
  );
  const [limit, setLimit] = useState(program.limit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [last, setLast] = useState<EventEnvelope | null>(null);
  const [outcome, setOutcome] = useState('');
  const mounted = useRef(true);
  const captured = captures[id];
  useEffect(() => {
    mounted.current = true;
    setPage(1);
    setLimit(program.limit);
    setOutcome('');
    setError(null);
    const saved = sessionStorage.getItem(`capacity.event.${id}`);
    setLast(saved ? JSON.parse(saved) : null);
    return () => {
      mounted.current = false;
    };
  }, [id]);
  async function freshView() {
    return (await api<View>(`${internal(id)}/reconciliation-view`)).data;
  }
  async function check(event: EventEnvelope) {
    const end = Date.now() + 20000;
    do {
      const result = await api<TreasuryEvent[]>(
        `${internal(id)}/treasury-events?eventId=${event.eventId}`,
      );
      const code = result.data[0]?.resultCode;
      if (!mounted.current) return;
      if (code) {
        setOutcome(code === 'APPLIED' ? 'Applied' : reason(code));
        refresh();
        void events.reload();
        void view.reload();
        if (code === 'APPLIED') notify('Treasury event applied and confirmed in PostgreSQL.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < end);
    if (mounted.current) setOutcome('Published · awaiting durable confirmation');
  }
  async function publish(event: EventEnvelope) {
    setLast(event);
    sessionStorage.setItem(`capacity.event.${id}`, JSON.stringify(event));
    setOutcome('Publishing');
    await api(`/demo-api/programs/${id}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    if (!mounted.current) return;
    setOutcome('Published');
    await check(event);
  }
  async function perform(kind: 'capture' | 'fresh' | 'captured' | 'limit' | 'retry' | 'check') {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'check' && last) {
        await check(last);
        return;
      }
      if (kind === 'retry' && last) {
        await publish(last);
        return;
      }
      const current = await freshView();
      if (kind === 'capture') {
        capture(id, current);
        notify(`Snapshot captured at state version ${current.stateVersion}.`);
        return;
      }
      if (!config.data) throw new ApiError(503, 'Local demo tools are unavailable.');
      const selected = kind === 'captured' ? captured : current;
      if (!selected) throw new ApiError(422, 'Capture a snapshot first.');
      if (kind === 'limit') {
        try {
          if (minor(limit, current.currency) < 0n) throw new Error();
        } catch {
          throw new ApiError(422, 'Enter a valid non-negative limit in the program currency.');
        }
      }
      const envelope: EventEnvelope = {
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        tenantId: config.data.tenantId,
        programId: id,
        treasuryRevision: (BigInt(current.highestSeenTreasuryRevision) + 1n).toString(),
        occurredAt: new Date().toISOString(),
        type: kind === 'limit' ? 'ProgramLimitUpdated' : 'ProgramStateSnapshot',
        payload:
          kind === 'limit'
            ? { currency: current.currency, limit }
            : {
                currency: selected.currency,
                limit: selected.limit,
                baseStateVersion: selected.stateVersion,
                reservations: selected.reservations,
              },
      };
      await publish(envelope);
    } catch (failure) {
      if (mounted.current) {
        setError(failure);
        setOutcome((previous) =>
          previous === 'Publishing' ? 'Outcome unknown · retry exact event' : previous,
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function exportView() {
    if (!view.data) return;
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(view.data, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = `program-${id}-snapshot.json`;
    link.click();
    URL.revokeObjectURL(href);
  }
  return (
    <>
      <div className="treasury-status-bar">
        <span className="treasury-status-icon">
          <Icon name="shield" size={26} />
        </span>
        <div>
          <strong>
            {program.syncStatus === 'READY'
              ? 'Your program is in sync'
              : 'Fresh reconciliation required'}
          </strong>
          <p>
            {program.syncStatus === 'READY'
              ? 'Reservations reflect the latest applied treasury state.'
              : 'New reservations resume only after a fresh snapshot is applied.'}
          </p>
        </div>
        <Badge tone={program.syncStatus === 'READY' ? 'green' : 'orange'}>
          {program.syncStatus === 'READY' ? 'Ready' : 'Action required'}
        </Badge>
      </div>
      {view.error != null && <ErrorNotice error={view.error} retry={() => void view.reload()} />}
      <div className="treasury-grid">
        <Panel
          title="Reconciliation view"
          subtitle="A complete, consistent program snapshot"
          action={
            <button className="text-button" disabled={!view.data} onClick={exportView}>
              <Icon name="download" size={16} />
              Export JSON
            </button>
          }
        >
          {view.loading ? (
            <Loading />
          ) : (
            view.data && (
              <>
                <dl className="detail-list version-list">
                  <div>
                    <dt>State version</dt>
                    <dd>
                      <span className="version-tag">v{view.data.stateVersion}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Last applied treasury revision</dt>
                    <dd>{view.data.lastAppliedTreasuryRevision}</dd>
                  </div>
                  <div>
                    <dt>Highest seen treasury revision</dt>
                    <dd>{view.data.highestSeenTreasuryRevision}</dd>
                  </div>
                  <div>
                    <dt>Active reservations</dt>
                    <dd>{view.data.reservations.length}</dd>
                  </div>
                  <div>
                    <dt>Program limit</dt>
                    <dd>{money(view.data.limit, view.data.currency, true)}</dd>
                  </div>
                </dl>
                <details className="snapshot-preview">
                  <summary>
                    View complete snapshot <Icon name="down" size={14} />
                  </summary>
                  <pre>{JSON.stringify(view.data, null, 2)}</pre>
                </details>
              </>
            )
          )}
        </Panel>
        <Panel
          title="Local demo controls"
          subtitle="Publish real events to your local Kafka"
          action={<Badge tone="blue">Demo only</Badge>}
        >
          {config.error != null && (
            <div className="notice notice-warning">
              Local demo tools are unavailable or this program is outside the demo allowlist.
              <button className="text-button" onClick={() => void config.reload()}>
                Retry connection
              </button>
            </div>
          )}
          <p className="demo-explanation">
            Events apply asynchronously. “Applied” appears only after PostgreSQL confirms the
            result.
          </p>
          <fieldset disabled={busy || !config.data?.enabled} className="demo-fieldset">
            <form
              className="limit-form"
              onSubmit={(e) => {
                e.preventDefault();
                void perform('limit');
              }}
            >
              <label>
                Program limit ({program.currency})
                <input
                  aria-label="Program limit"
                  inputMode="decimal"
                  required
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <button className="button button-secondary" type="submit">
                Publish limit update
                <Icon name="arrow" size={15} />
              </button>
            </form>
            <div className="demo-buttons">
              <button className="button button-secondary" onClick={() => void perform('capture')}>
                <Icon name="file" size={16} />
                Capture snapshot
              </button>
              <button
                className="button button-secondary"
                disabled={!captured}
                onClick={() => void perform('captured')}
              >
                Publish captured
              </button>
            </div>
            {captured && (
              <div className="captured-label">
                <Icon name="clock" size={14} />
                Captured at version {captured.stateVersion} · {captured.reservations.length} active
                reservations
              </div>
            )}
            <button
              className="button button-primary button-wide"
              onClick={() => void perform('fresh')}
            >
              <Icon name="refresh" size={16} />
              Apply fresh snapshot
            </button>
          </fieldset>
          {error != null && <ErrorNotice error={error} />}{' '}
          {last && (
            <div className="event-outcome" role="status">
              <span className="small-label">LAST PUBLICATION</span>
              <strong>{outcome || 'Result available for checking'}</strong>
              <code>{last.eventId}</code>
              <div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void perform('check')}
                >
                  Check result
                </button>
                <button
                  className="text-button"
                  disabled={busy || !config.data?.enabled}
                  onClick={() => void perform('retry')}
                >
                  Retry exact event
                </button>
              </div>
            </div>
          )}
          {busy && (
            <div className="inline-loading">
              <span className="spinner" />
              Waiting for a durable result…
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Treasury event history" subtitle="Durable results from the PostgreSQL inbox">
        {events.error != null && (
          <ErrorNotice error={events.error} retry={() => void events.reload()} />
        )}{' '}
        {events.loading ? (
          <Loading />
        ) : events.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Revision</th>
                  <th>Result</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="invoice-cell">
                        <span className="document-icon">
                          <Icon
                            name={e.type === 'ProgramStateSnapshot' ? 'shield' : 'wallet'}
                            size={18}
                          />
                        </span>
                        <span>
                          <strong>
                            {e.type === 'ProgramStateSnapshot'
                              ? 'Program snapshot'
                              : 'Limit update'}
                          </strong>
                          <small>{e.eventId}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="version-tag">{e.treasuryRevision}</span>
                    </td>
                    <td>
                      <Badge
                        tone={
                          e.resultCode === 'APPLIED' ? 'green' : e.resultCode ? 'orange' : 'neutral'
                        }
                      >
                        {e.resultCode ? reason(e.resultCode) : 'Pending'}
                      </Badge>
                    </td>
                    <td className="muted nowrap">{date(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Ready to connect the dots"
            text="Publish a treasury event to see its durable result here."
          />
        )}
        <Pagination meta={events.meta} change={setPage} />
      </Panel>
    </>
  );
}
