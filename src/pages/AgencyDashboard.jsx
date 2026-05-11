import React, { useState, useEffect, useRef } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import Logo from '../components/Logo.jsx';

function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

const GoogleSvg = () => (
  <svg width="15" height="15" viewBox="0 0 48 48">
    <path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.3 5.5-4.8 7.2v6h7.7c4.5-4.2 7.1-10.3 7.1-17.3z"/>
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9H2.5v6.2C6.5 42.6 14.7 48 24 48z"/>
    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6v-6.2H2.5C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l8-6.2z"/>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.7 0 6.5 5.4 2.5 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"/>
  </svg>
);

const MicrosoftSvg = () => (
  <svg width="15" height="15" viewBox="0 0 21 21">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
);

export default function AgencyDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [live, setLive]       = useState(null);   // currently clocked-in workers
  const [history, setHistory] = useState(null);   // completed check-ins
  const autoRefreshRef = useRef(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) await loadAll();
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!currentUser) return;
    autoRefreshRef.current = setInterval(loadLive, 30000);
    return () => clearInterval(autoRefreshRef.current);
  }, [currentUser]); // eslint-disable-line

  function signIn(provider) {
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo: 'http://localhost:3000/agency' } });
  }
  async function signOut() {
    await authSb.auth.signOut();
    setCurrentUser(null);
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadAll() {
    await Promise.all([loadLive(), loadHistory()]);
  }

  async function loadLive() {
    // Workers currently clocked in (no clocked_out_at)
    const { data } = await dataSb.from('check_ins')
      .select('*, worker:workers(name, email), site:sites(name)')
      .is('clocked_out_at', null)
      .order('clocked_in_at', { ascending: false });
    setLive(data || []);
  }

  async function loadHistory() {
    const { data } = await dataSb.from('check_ins')
      .select('*, worker:workers(name, email), site:sites(name)')
      .not('clocked_out_at', 'is', null)
      .order('clocked_in_at', { ascending: false })
      .limit(100);
    setHistory(data || []);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const userName = currentUser?.user_metadata?.full_name || currentUser?.email || '';

  return (
    <>
      {/* Auth overlay */}
      <div className={`auth-overlay${currentUser ? ' hidden' : ''}`}>
        <div className="auth-box">
          <div>
            <Logo size={32} textSize="1rem" />
            <h2 style={{ marginTop: '0.75rem' }}>Agency Dashboard</h2>
            <p style={{ marginTop: '0.3rem' }}>Sign in to monitor live check-ins.</p>
          </div>
          <button className="btn btn-auth-google-agency" onClick={() => signIn('google')}>
            <GoogleSvg /> Continue with Gmail
          </button>
          <div className="or-line">or</div>
          <button className="btn btn-auth-microsoft-agency" onClick={() => signIn('azure')}>
            <MicrosoftSvg /> Continue with Outlook
          </button>
        </div>
      </div>

      {/* Header */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Logo size={28} textSize="0.95rem" />
          <span className="header-sub">Agency</span>
        </div>
        <div className="header-right">
          <span className="header-user">{userName}</span>
          <button className="signout-btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main>

        {/* Live — currently clocked in */}
        <div>
          <div className="section-title">
            <span>Live — Currently Clocked In</span>
            <button className="refresh-btn" onClick={loadAll}>↻ Refresh</button>
          </div>
          <div className="live-grid">
            {live === null ? (
              <div className="empty">Loading…</div>
            ) : live.length === 0 ? (
              <div className="empty">Nobody is currently clocked in.</div>
            ) : (
              live.map(ci => (
                <div className="locum-card" key={ci.id}>
                  <span className="locum-badge badge-in">● Clocked in</span>
                  <div className="locum-name">
                    <span className="status-dot dot-green"></span>
                    {ci.worker?.name || ci.worker?.email}
                  </div>
                  <div className="locum-site">{ci.site?.name}</div>
                  <div className="locum-meta">
                    Since {fmtTime(ci.clocked_in_at)}
                    {ci.clock_in_distance_m != null && ` · ${ci.clock_in_distance_m}m from site`}
                    {!ci.clock_in_geofence_passed && ' · ⚠ outside geofence'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* History */}
        <div>
          <div className="section-title">Check-in History</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Hospital</th>
                  <th>Date</th>
                  <th>Clocked In</th>
                  <th>Clocked Out</th>
                  <th>Duration</th>
                  <th>Distance In</th>
                  <th>Geofence</th>
                </tr>
              </thead>
              <tbody>
                {history === null ? (
                  <tr><td colSpan="8" className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan="8" className="empty">No check-ins recorded yet.</td></tr>
                ) : history.map(c => {
                  const dur    = c.duration_minutes != null
                    ? (c.duration_minutes >= 60
                        ? `${Math.floor(c.duration_minutes / 60)}h ${c.duration_minutes % 60}m`
                        : `${c.duration_minutes}m`)
                    : '—';
                  const dist   = c.clock_in_distance_m != null ? `${c.clock_in_distance_m}m` : '—';
                  const passed = c.clock_in_geofence_passed;
                  return (
                    <tr key={c.id}>
                      <td>{c.worker?.name || c.worker?.email || '—'}</td>
                      <td>{c.site?.name || '—'}</td>
                      <td>{fmtDate(c.clocked_in_at)}</td>
                      <td>{fmtTime(c.clocked_in_at)}</td>
                      <td>{c.clocked_out_at ? fmtTime(c.clocked_out_at) : '—'}</td>
                      <td>{dur}</td>
                      <td>{dist}</td>
                      <td style={{ color: passed ? 'var(--green)' : 'var(--orange)', fontWeight: 600 }}>
                        {passed ? '✓ Pass' : '⚠ Outside'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </>
  );
}
