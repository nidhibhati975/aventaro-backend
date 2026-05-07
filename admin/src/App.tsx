import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  BarChart3,
  BookOpen,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCog,
  Users,
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function resolveApiBaseUrl() {
  const rawBaseUrl = (
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.API_BASE_URL ||
    import.meta.env.BACKEND_URL ||
    ''
  ).trim();
  if (!rawBaseUrl) {
    throw new Error('VITE_API_BASE_URL or API_BASE_URL must be configured in .env');
  }
  return rawBaseUrl.replace(/\/+$/, '');
}

const API_BASE_URL = resolveApiBaseUrl();
const ACCESS_TOKEN_KEY = 'aventaro_admin_access_token';
const REFRESH_TOKEN_KEY = 'aventaro_admin_refresh_token';
const DEVICE_ID_KEY = 'aventaro_admin_device_id';

type Tab = 'users' | 'moderation' | 'revenue' | 'bookings';

type AuthUser = {
  id: number;
  email: string;
  role: string;
};

type AuthState = {
  accessToken: string;
  refreshToken: string;
  deviceId: string | null;
  user: AuthUser | null;
};

type LoginResponse = {
  access_token: string;
  refresh_token: string;
  device_id: string | null;
  user: AuthUser;
};

type MfaResponse = {
  mfa_required: true;
  challenge_id: string;
  channel: string;
  destination_hint: string;
};

type UserRow = {
  id: number;
  email: string;
  role: string;
  name: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_premium: boolean;
  created_at: string;
  last_login: string | null;
};

type ModerationCase = {
  id: number;
  report_id: number;
  target_type: string | null;
  target_id: number | null;
  status: string;
  admin_action: string | null;
  created_at: string;
};

type BookingRow = {
  id: number;
  user_id: number;
  trip_id: number | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
};

type RevenueSummary = {
  total_revenue: number;
  subscription_revenue: number;
  boost_revenue: number;
  commission_revenue: number;
};

function unwrap<T>(payload: any): T {
  if (payload && payload.success === true && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

function storedAuth(): AuthState {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY) || '',
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY) || '',
    deviceId: localStorage.getItem(DEVICE_ID_KEY),
    user: null,
  };
}

function persistAuth(nextAuth: AuthState) {
  localStorage.setItem(ACCESS_TOKEN_KEY, nextAuth.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, nextAuth.refreshToken);
  if (nextAuth.deviceId) {
    localStorage.setItem(DEVICE_ID_KEY, nextAuth.deviceId);
  }
}

async function rawRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `Request failed: ${response.status}`);
  }
  return unwrap<T>(payload);
}

function App() {
  const [auth, setAuth] = useState<AuthState>(storedAuth);
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState<MfaResponse | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAuth({ accessToken: '', refreshToken: '', deviceId: localStorage.getItem(DEVICE_ID_KEY), user: null });
    setUsers([]);
    setCases([]);
    setBookings([]);
    setRevenue(null);
    setStats(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    if (!auth.refreshToken) {
      throw new Error('Admin session expired');
    }
    const refreshed = await rawRequest<LoginResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: auth.refreshToken }),
    });
    if (refreshed.user.role !== 'admin') {
      logout();
      throw new Error('Admin access required');
    }
    const nextAuth = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      deviceId: refreshed.device_id,
      user: refreshed.user,
    };
    persistAuth(nextAuth);
    setAuth(nextAuth);
    return nextAuth.accessToken;
  }, [auth.refreshToken, logout]);

  const adminRequest = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      async function doRequest(token: string) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('AUTH_EXPIRED');
        }
        if (!response.ok) {
          throw new Error(payload?.detail || payload?.message || `Request failed: ${response.status}`);
        }
        return unwrap<T>(payload);
      }

      try {
        return await doRequest(auth.accessToken);
      } catch (err) {
        if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
          const nextToken = await refreshAuth();
          return doRequest(nextToken);
        }
        throw err;
      }
    },
    [auth.accessToken, refreshAuth],
  );

  const load = useCallback(async () => {
    if (!auth.accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const userParams = new URLSearchParams({ limit: '50' });
      if (userSearch.trim()) userParams.set('search', userSearch.trim());
      if (roleFilter) userParams.set('role', roleFilter);
      const bookingParams = new URLSearchParams({ limit: '50' });
      if (bookingStatus) bookingParams.set('status', bookingStatus);
      const [usersData, casesData, bookingsData, revenueData, statsData] = await Promise.all([
        adminRequest<UserRow[]>(`/admin/users?${userParams.toString()}`),
        adminRequest<ModerationCase[]>('/admin/moderation-cases?limit=50'),
        adminRequest<BookingRow[]>(`/admin/bookings?${bookingParams.toString()}`),
        adminRequest<RevenueSummary>('/admin/revenue/summary'),
        adminRequest<any>('/admin/stats'),
      ]);
      setUsers(usersData || []);
      setCases(casesData || []);
      setBookings(bookingsData || []);
      setRevenue(revenueData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin data');
    } finally {
      setLoading(false);
    }
  }, [adminRequest, auth.accessToken, bookingStatus, roleFilter, userSearch]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const code = String(data.get('code') || '').trim();
    try {
      const payload = mfaChallenge
        ? await rawRequest<LoginResponse>('/auth/mfa/login/verify', {
            method: 'POST',
            body: JSON.stringify({ challenge_id: mfaChallenge.challenge_id, code, device_id: auth.deviceId }),
          })
        : await rawRequest<LoginResponse | MfaResponse>('/auth/login', {
            method: 'POST',
            headers: auth.deviceId ? { 'X-Device-Id': auth.deviceId } : {},
            body: JSON.stringify({ email, password }),
          });
      if ('mfa_required' in payload) {
        setMfaChallenge(payload);
        return;
      }
      if (payload.user.role !== 'admin') {
        throw new Error('Admin access required');
      }
      const nextAuth = {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        deviceId: payload.device_id,
        user: payload.user,
      };
      persistAuth(nextAuth);
      setAuth(nextAuth);
      setMfaChallenge(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    }
  }

  async function resolveCase(caseId: number, action: 'approve' | 'reject' | 'ban') {
    await adminRequest(`/admin/moderation-cases/${caseId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await load();
  }

  async function toggleUser(user: UserRow) {
    const path = user.is_active ? `/admin/users/${user.id}/ban` : `/admin/users/${user.id}/unban`;
    await adminRequest(path, {
      method: 'POST',
      body: user.is_active ? JSON.stringify({ reason: 'admin_dashboard_action' }) : undefined,
    });
    await load();
  }

  async function updateRole(user: UserRow, role: string) {
    await adminRequest(`/admin/users/${user.id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await load();
  }

  useEffect(() => {
    load();
  }, [load]);

  if (!auth.accessToken) {
    return (
      <main className="loginShell">
        <form className="loginPanel" onSubmit={handleLogin}>
          <div>
            <h1>Admin Sign In</h1>
            <p>Aventaro operations console</p>
          </div>
          {!mfaChallenge && (
            <>
              <label>
                Email
                <input name="email" type="email" autoComplete="username" required />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
            </>
          )}
          {mfaChallenge && (
            <label>
              {mfaChallenge.channel.toUpperCase()} code sent to {mfaChallenge.destination_hint}
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <button type="submit">{mfaChallenge ? 'Verify' : 'Sign in'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">Aventaro Admin</div>
        <nav>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><Users size={18} />Users</button>
          <button className={tab === 'moderation' ? 'active' : ''} onClick={() => setTab('moderation')}><ShieldAlert size={18} />Moderation</button>
          <button className={tab === 'revenue' ? 'active' : ''} onClick={() => setTab('revenue')}><BarChart3 size={18} />Revenue</button>
          <button className={tab === 'bookings' ? 'active' : ''} onClick={() => setTab('bookings')}><BookOpen size={18} />Bookings</button>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div className="adminIdentity">{auth.user?.email || 'Admin'}</div>
          <button className="iconButton" onClick={load} disabled={loading} title="Refresh"><RefreshCw size={18} /></button>
          <button className="iconButton" onClick={logout} title="Sign out"><LogOut size={18} /></button>
        </header>
        {error && <div className="error">{error}</div>}
        {tab === 'users' && (
          <section>
            <Toolbar>
              <label className="searchInput">
                <Search size={16} />
                <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search email" />
              </label>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="">All roles</option>
                <option value="user">User</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={load}><RefreshCw size={16} />Apply</button>
            </Toolbar>
            <Table title="Users" rows={users} columns={['id', 'email', 'role', 'name', 'is_active', 'is_verified', 'is_premium', 'created_at']} action={(row) => (
              <div className="actions">
                <select value={row.role} onChange={(event) => updateRole(row, event.target.value)} aria-label="Update role">
                  <option value="user">User</option>
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={() => toggleUser(row)}><Ban size={16} />{row.is_active ? 'Ban' : 'Unban'}</button>
              </div>
            )} />
          </section>
        )}
        {tab === 'moderation' && (
          <Table title="Moderation Queue" rows={cases} columns={['id', 'report_id', 'target_type', 'target_id', 'status', 'admin_action', 'created_at']} action={(row) => (
            <div className="actions">
              <button onClick={() => resolveCase(row.id, 'approve')}>Approve</button>
              <button onClick={() => resolveCase(row.id, 'reject')}>Reject</button>
              <button onClick={() => resolveCase(row.id, 'ban')}>Ban</button>
            </div>
          )} />
        )}
        {tab === 'revenue' && (
          <section>
            <h1>Revenue</h1>
            <div className="metrics">
              <Metric label="Total" value={revenue?.total_revenue || 0} />
              <Metric label="Subscriptions" value={revenue?.subscription_revenue || 0} />
              <Metric label="Boosts" value={revenue?.boost_revenue || 0} />
              <Metric label="Commission" value={revenue?.commission_revenue || 0} />
            </div>
            <pre>{JSON.stringify(stats, null, 2)}</pre>
          </section>
        )}
        {tab === 'bookings' && (
          <section>
            <Toolbar>
              <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value)}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="payment_initiated">Payment initiated</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
                <option value="failed">Failed</option>
              </select>
              <button onClick={load}><RefreshCw size={16} />Apply</button>
            </Toolbar>
            <Table title="Bookings" rows={bookings} columns={['id', 'user_id', 'trip_id', 'status', 'total_amount', 'currency', 'created_at']} />
          </section>
        )}
      </section>
    </main>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value.toLocaleString()}</strong></div>;
}

function Table<T extends Record<string, any>>({ title, rows, columns, action }: {
  title: string;
  rows: T[];
  columns: string[];
  action?: (row: T) => React.ReactNode;
}) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}{action && <th><UserCog size={16} /> action</th>}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id || index)}>
                {columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}
                {action && <td>{action(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
