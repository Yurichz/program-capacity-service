import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError, clearSession, hasSession, logout, signIn } from './api';
import { Brand, ErrorNotice, Icon, Loading } from './ui';
import { useResource } from './use-resource';
import {
  Activity,
  Overview,
  Reservations,
  Treasury,
  ReserveDialog,
  ReservationDetails,
} from './pages';
import type { Program, Reservation, Result, User, View } from './types';

async function readPrograms(path: string, signal: AbortSignal): Promise<Result<Program[]>> {
  const data: Program[] = [];
  let page: number | null = 1;

  do {
    const result: Result<Program[]> = await api<Program[]>(`${path}&page=${page}`, { signal });

    data.push(...result.data);
    page = result.meta?.next ?? null;
  } while (page !== null);

  return { success: true, data };
}

export interface Workspace {
  program: Program;
  user: User;
  revision: number;
  refresh: () => void;
  reserve: () => void;
  details: (reservation: Reservation) => void;
  notify: (text: string) => void;
  captures: Record<string, View>;
  capture: (programId: string, view: View) => void;
}
function Login({ complete }: { complete: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      complete((await api<User>('/api/v1/users/me')).data);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-art">
        <Brand light />
        <div className="login-copy">
          <span className="eyebrow">CLARITY. CAPACITY. CONTROL.</span>
          <h1>
            Make room for
            <br />
            what’s next<span>.</span>
          </h1>
          <p>
            A clear view of your funding capacity.
            <br />
            Every reservation. Every movement. In sync.
          </p>
          <div className="login-glass">
            <span className="glass-icon">
              <Icon name="shield" size={25} />
            </span>
            <div>
              <strong>Confidence in every transaction</strong>
              <span>Connected to your treasury, built for precision.</span>
            </div>
          </div>
        </div>
        <div className="login-art-footer">
          <span>PROGRAM CAPACITY</span>
          <span>Finance, with a clearer perspective.</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form">
          <span className="section-kicker">YOUR WORKSPACE, CONNECTED</span>
          <h2>Welcome back</h2>
          <p>Sign in to manage your program capacity.</p>
          <form className="stacked-form" onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error != null && <ErrorNotice error={error} />}
            <button className="button button-primary button-wide" disabled={busy}>
              {busy ? (
                'Signing in…'
              ) : (
                <>
                  Sign in <Icon name="arrow" size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-demo">
            <Icon name="lock" size={17} />
            <p>
              Local demo workspace
              <span>Use the credentials created during setup.</span>
              <code>npm run dev:credentials</code>
            </p>
          </div>
        </div>
        <div className="login-bottom">
          A little more clarity. A lot more possibility.
          <span>© {new Date().getFullYear()} Program Capacity</span>
        </div>
      </section>
    </main>
  );
}
const navigation = [
  { path: '/overview', label: 'Overview', icon: 'grid' },
  { path: '/reservations', label: 'Reservations', icon: 'file' },
  { path: '/activity', label: 'Activity', icon: 'activity' },
  { path: '/treasury', label: 'Treasury', icon: 'shield' },
];

function Cabinet({ user, signedOut }: { user: User; signedOut: () => void }) {
  const [revision, setRevision] = useState(0);
  const programs = useResource<Program[]>('/api/v1/programs?perPage=100', revision, readPrograms);
  const [selection, setSelection] = useState(sessionStorage.getItem('capacity.program') ?? '');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(false);
  const [profile, setProfile] = useState(false);
  const [captures, setCaptures] = useState<Record<string, View>>({});
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const location = useLocation();
  const program = programs.data?.find((p) => p.programId === selection) ?? programs.data?.[0];
  const canTreasury = user.roles.includes('TREASURY') || user.roles.includes('APP_ADMIN');
  const title = navigation.find((n) => location.pathname === n.path)?.label ?? 'Overview';

  useEffect(() => {
    setMobile(false);
    setProfile(false);
  }, [location.pathname]);
  useEffect(() => {
    if (program) sessionStorage.setItem('capacity.program', program.programId);
  }, [program?.programId]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6000);

      return () => clearTimeout(timer);
    }
  }, [toast]);
  const discovered = programs.data ?? [];
  const selected = program;
  const refresh = () => setRevision((value) => value + 1);
  const workspace: Workspace | null = selected
    ? {
      program: selected,
      user,
      revision,
      refresh,
      reserve: () => setCreating(true),
      details: setDetail,
      notify: setToast,
      captures,
      capture: (id, view) => setCaptures((current) => ({ ...current, [id]: view })),
    }
    : null;

  async function leave() {
    setLoggingOut(true);
    try {
      await logout();
      signedOut();
    } catch (error) {
      setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside id="main-sidebar" className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <Link className="brand-link" to="/overview" aria-label="Program Capacity home">
          <Brand />
        </Link>
        <span className="nav-group-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation
            .filter((n) => n.path !== '/treasury' || canTreasury)
            .map((n) => (
              <NavLink
                key={n.path}
                to={n.path}
                className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {n.path === '/treasury' && selected?.syncStatus !== 'READY' && (
                  <span className="nav-indicator" />
                )}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-program">
          <span className="small-label">CURRENT PROGRAM</span>
          <div>
            <span className="program-mini">
              <Icon name="wallet" size={18} />
            </span>
            <span>
              <strong>
                {selected ? `Program ${selected.programId.slice(0, 8)}` : 'No program'}
              </strong>
              <small>{selected?.currency ?? 'Your funding workspace'}</small>
            </span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="shield-circle">
              <Icon name="shield" size={19} />
            </span>
            <strong>Every detail, accounted for.</strong>
            <p>
              Real-time visibility.
              <br />
              Confidence to move forward.
            </p>
          </div>
          <div className="local-marker">
            <span className="status-dot" />
            Local workspace <span>v2.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-controls="main-sidebar"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Icon name="menu" />
            </button>
            <Icon name="grid" size={17} />
            <span>Workspace</span>
            <Icon name="chevron" size={12} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-environment">
              <span className="status-dot" />
              Local environment
            </span>
            <div className="profile-wrap">
              <button
                className="profile-button"
                aria-expanded={profile}
                aria-label="Account menu"
                onClick={() => setProfile(!profile)}
              >
                <span className="avatar">
                  {(user.firstName ?? user.email).slice(0, 1).toUpperCase()}
                  {user.lastName?.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-name">
                  <strong>{user.firstName ?? user.email.split('@')[0]}</strong>
                  <small>{canTreasury ? 'Program operator' : 'Workspace member'}</small>
                </span>
                <Icon name="down" size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  <strong>{user.email}</strong>
                  <small>{user.roles.join(' · ')}</small>
                  <button className="text-button" disabled={loggingOut} onClick={leave}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <span className="section-kicker">PROGRAM WORKSPACE</span>
              <h1>{title}</h1>
              <p>
                {title === 'Overview'
                  ? 'A clear view of your capacity. More confidence in every move.'
                  : title === 'Reservations'
                    ? 'Your invoices, reserved with precision.'
                    : title === 'Activity'
                      ? 'The complete story behind every change.'
                      : 'Keep your program and treasury in sync.'}
              </p>
            </div>
            <div className="heading-actions">
              <label className="program-selector">
                <span className="small-label">PROGRAM</span>
                <select
                  aria-label="Program"
                  value={selected?.programId ?? ''}
                  onChange={(e) => {
                    setSelection(e.target.value);
                    setDetail(null);
                    setCreating(false);
                  }}
                >
                  {discovered.map((p) => (
                    <option value={p.programId} key={p.programId}>
                      Program {p.programId.slice(0, 8)} · {p.currency}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button refresh-button"
                aria-label="Refresh workspace"
                onClick={refresh}
              >
                <Icon name="refresh" size={18} />
              </button>
            </div>
          </div>
          {programs.error != null && (
            <ErrorNotice error={programs.error} retry={() => void programs.reload()} />
          )}{' '}
          {logoutError != null && <ErrorNotice error={logoutError} />}
          {programs.loading ? (
            <Loading />
          ) : workspace ? (
            <>
              <Routes>
                <Route path="/overview" element={<Overview {...workspace} />} />
                <Route
                  path="/reservations"
                  element={<Reservations key={workspace.program.programId} {...workspace} />}
                />
                <Route
                  path="/activity"
                  element={<Activity key={workspace.program.programId} {...workspace} />}
                />
                <Route
                  path="/treasury"
                  element={
                    canTreasury ? (
                      <Treasury key={workspace.program.programId} {...workspace} />
                    ) : (
                      <div className="notice notice-error">
                        Your account does not have treasury permission.
                      </div>
                    )
                  }
                />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
              {creating && (
                <ReserveDialog
                  program={workspace.program}
                  close={() => setCreating(false)}
                  complete={(r) => {
                    setCreating(false);
                    setDetail(r);
                    refresh();
                    setToast('Reservation created successfully.');
                  }}
                />
              )}{' '}
              {detail && (
                <ReservationDetails
                  reservation={detail}
                  canWrite={user.roles.includes('USER') || user.roles.includes('APP_ADMIN')}
                  close={() => setDetail(null)}
                  complete={(r) => {
                    setDetail(r);
                    refresh();
                    setToast('Reservation released. Capacity is available again.');
                  }}
                />
              )}
            </>
          ) : (
            !programs.error && (
              <div className="panel no-program">
                <h2>Your workspace is ready</h2>
                <p>No programs are assigned to this tenant yet.</p>
              </div>
            )
          )}
          <footer className="workspace-footer">
            <span>© {new Date().getFullYear()} Program Capacity</span>
            <span>Every number has a story. Keep yours in sync.</span>
            <span>
              <Icon name="lock" size={13} />
              Session protected
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Icon name="check" size={18} />
          </span>
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(hasSession());
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (hasSession())
      api<User>('/api/v1/users/me')
        .then((result) => setUser(result.data))
        .catch((failure) => {
          if (!(failure instanceof ApiError) || failure.status !== 401) setError(failure);
        })
        .finally(() => setBooting(false));

    const unauthorized = () => {
      clearSession();
      setUser(null);
    };

    window.addEventListener('capacity:unauthorized', unauthorized);

    return () => window.removeEventListener('capacity:unauthorized', unauthorized);
  }, []);
  if (booting) return <Loading />;

  if (!user)
    return (
      <>
        {error != null && (
          <div className="restore-error">
            <ErrorNotice error={error} />
          </div>
        )}
        <Login
          complete={(value) => {
            setError(null);
            setUser(value);
          }}
        />
      </>
    );

  return <Cabinet user={user} signedOut={() => setUser(null)} />;
}
