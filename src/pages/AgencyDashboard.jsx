import React, { useState, useEffect } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import { fmtTime, fmtDate, fmtDuration } from '../lib/format.js';
import Logo from '../components/Logo.jsx';
import { GoogleIcon, MicrosoftIcon } from '../components/OAuthIcons.jsx';

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
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.href } });
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
            <GoogleIcon size={15} /> Continue with Gmail
          </button>
          <div className="or-line">or</div>
          <button className="btn btn-auth-microsoft-agency" onClick={() => signIn('azure')}>
            <MicrosoftIcon size={15} /> Continue with Outlook
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
                  const dur  = fmtDuration(c.duration_minutes);
                  const dist = c.clock_in_distance_m != null ? `${c.clock_in_distance_m}m` : '—';
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
