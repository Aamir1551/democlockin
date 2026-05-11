import React, { useState, useEffect, useRef, useCallback } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function AgencyDashboard() {
  const [currentUser, setCurrentUser] = useState(null);
  const [liveShifts, setLiveShifts]   = useState(null); // null = loading
  const [history, setHistory]         = useState(null);
  const [allWorkers, setAllWorkers]   = useState([]);
  const [allSites, setAllSites]       = useState([]);
  const [modalOpen, setModalOpen]     = useState(false);
  const [modalWorker, setModalWorker] = useState('');
  const [modalSite, setModalSite]     = useState('');
  const [modalWard, setModalWard]     = useState('');
  const [modalStart, setModalStart]   = useState('');
  const [modalEnd, setModalEnd]       = useState('');
  const [modalErr, setModalErr]       = useState('');
  const [assignLoading, setAssignLoading] = useState(false);

  const autoRefreshRef = useRef(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        await loadAll();
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh live grid every 30s
  useEffect(() => {
    if (currentUser) {
      autoRefreshRef.current = setInterval(() => loadLive(), 30000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  function signIn(provider) {
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo: 'http://localhost:3000/agency' } });
  }

  async function signOut() {
    await authSb.auth.signOut();
    setCurrentUser(null);
  }

  // ── Load everything ────────────────────────────────────────────────────────

  async function loadAll() {
    await Promise.all([loadLive(), loadHistory(), loadWorkers(), loadSites()]);
  }

  async function loadLive() {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);

    const { data: shifts } = await dataSb.from('shifts')
      .select('*, worker:workers(name, email), site:sites(name), check_ins(*)')
      .gte('scheduled_start', todayStart.toISOString())
      .lte('scheduled_start', todayEnd.toISOString())
      .order('scheduled_start');

    setLiveShifts(shifts || []);
  }

  async function loadHistory() {
    const { data: checkIns } = await dataSb.from('check_ins')
      .select('*, worker:workers(name), site:sites(name), shift:shifts(scheduled_start, scheduled_end, status, ward)')
      .order('created_at', { ascending: false })
      .limit(50);

    setHistory(checkIns || []);
  }

  async function loadWorkers() {
    const { data } = await dataSb.from('workers').select('id, name, email').order('name');
    setAllWorkers(data || []);
  }

  async function loadSites() {
    const { data } = await dataSb.from('sites').select('id, name, type').order('name');
    setAllSites(data || []);
  }

  // ── Assign shift modal ─────────────────────────────────────────────────────

  function openAssignModal() {
    const today = new Date().toISOString().split('T')[0];
    setModalWorker('');
    setModalSite('');
    setModalWard('');
    setModalStart(`${today}T08:00`);
    setModalEnd(`${today}T16:00`);
    setModalErr('');
    setModalOpen(true);
  }

  async function assignShift() {
    setModalErr('');
    if (!modalWorker || !modalSite || !modalStart || !modalEnd) {
      setModalErr('Please fill in all required fields.');
      return;
    }
    if (new Date(modalEnd) <= new Date(modalStart)) {
      setModalErr('End time must be after start time.');
      return;
    }

    setAssignLoading(true);
    const { error } = await dataSb.from('shifts').insert({
      worker_id: modalWorker,
      site_id: modalSite,
      ward: modalWard.trim() || null,
      scheduled_start: new Date(modalStart).toISOString(),
      scheduled_end: new Date(modalEnd).toISOString(),
      status: 'upcoming',
    });
    setAssignLoading(false);

    if (error) {
      setModalErr(error.message);
    } else {
      setModalOpen(false);
      await loadAll();
    }
  }

  // ── Live grid card renderer ────────────────────────────────────────────────

  function renderLiveCard(s) {
    const ci = s.check_ins?.find(c => c.clocked_in_at);
    const start = new Date(s.scheduled_start);
    const lateThreshold = new Date(start.getTime() + 30 * 60000);
    const now = new Date();
    const isLate = !ci && now > lateThreshold;

    let badge, dot, meta;
    if (ci && !ci.clocked_out_at) {
      badge = <span className="locum-badge badge-in">● Clocked in</span>;
      dot = 'dot-green';
      meta = `In since ${fmtTime(new Date(ci.clocked_in_at))} · ${ci.clock_in_distance_m ?? '?'}m from site`;
    } else if (ci && ci.clocked_out_at) {
      badge = <span className="locum-badge badge-complete">✓ Complete</span>;
      dot = 'dot-grey';
      meta = `${fmtTime(new Date(ci.clocked_in_at))} – ${fmtTime(new Date(ci.clocked_out_at))}`;
    } else if (isLate) {
      badge = <span className="locum-badge badge-late">⚠ Late / No show</span>;
      dot = 'dot-red';
      meta = `Expected at ${fmtTime(start)}`;
    } else {
      badge = <span className="locum-badge badge-upcoming">Upcoming</span>;
      dot = 'dot-grey';
      meta = `Starts at ${fmtTime(start)}`;
    }

    return (
      <div className="locum-card" key={s.id}>
        {badge}
        <div className="locum-name">
          <span className={`status-dot ${dot}`}></span>
          {s.worker?.name || s.worker?.email}
        </div>
        <div className="locum-site">{s.site?.name}</div>
        <div className="locum-meta">{meta}</div>
      </div>
    );
  }

  // ── History row renderer ───────────────────────────────────────────────────

  function renderHistoryRow(c) {
    const date = c.clocked_in_at ? new Date(c.clocked_in_at).toLocaleDateString('en-GB') : '—';
    const inT  = c.clocked_in_at  ? fmtTime(new Date(c.clocked_in_at))  : '—';
    const outT = c.clocked_out_at ? fmtTime(new Date(c.clocked_out_at)) : '—';
    const dur  = c.duration_minutes
      ? `${Math.floor(c.duration_minutes / 60)}h ${c.duration_minutes % 60}m`
      : '—';
    const dist   = c.clock_in_distance_m != null ? `${c.clock_in_distance_m}m` : '—';
    const status = c.shift?.status || '—';
    const passed = c.clock_in_geofence_passed;

    return (
      <tr key={c.id}>
        <td>{c.worker?.name || '—'}</td>
        <td>
          {c.site?.name || '—'}
          {c.shift?.ward && <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.shift.ward}</div>}
        </td>
        <td>{date}</td>
        <td>{inT}</td>
        <td>{outT}</td>
        <td>{dur}</td>
        <td style={{ color: passed ? 'var(--green)' : 'var(--orange)' }}>
          {dist} {passed ? '✓' : '⚠'}
        </td>
        <td>
          <span className={`pill pill-${status}`}>{status.replace('_', ' ')}</span>
        </td>
      </tr>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const userName = currentUser?.user_metadata?.full_name || currentUser?.email || '';

  return (
    <>
      {/* Auth overlay */}
      <div className={`auth-overlay${currentUser ? ' hidden' : ''}`}>
        <div className="auth-box">
          <div>
            <div style={{ fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af' }}>
              Agency Dashboard
            </div>
            <h2 style={{ marginTop: '0.4rem' }}>Sign in</h2>
            <p style={{ marginTop: '0.3rem' }}>Sign in to view your agency's live check-ins.</p>
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
          <div className="header-brand">Locum Check-In</div>
          <div className="header-sub">Agency Dashboard</div>
        </div>
        <div className="header-right">
          <div className="header-user">{userName}</div>
          <button className="signout-btn" onClick={signOut}>Sign out</button>
          <button className="btn btn-primary" onClick={openAssignModal}>+ Assign Shift</button>
        </div>
      </header>

      <main>

        {/* Live view */}
        <div>
          <div className="section-title">
            <span>Live — Today's Shifts</span>
            <button className="refresh-btn" onClick={loadAll}>↻ Refresh</button>
          </div>
          <div className="live-grid">
            {liveShifts === null ? (
              <div className="empty">Loading…</div>
            ) : liveShifts.length === 0 ? (
              <div className="empty">No shifts scheduled today.</div>
            ) : (
              liveShifts.map(renderLiveCard)
            )}
          </div>
        </div>

        {/* Shift history */}
        <div>
          <div className="section-title">Shift History</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Site</th>
                  <th>Date</th>
                  <th>Clocked In</th>
                  <th>Clocked Out</th>
                  <th>Duration</th>
                  <th>Distance In</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history === null ? (
                  <tr><td colSpan="8" className="empty">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan="8" className="empty">No check-ins recorded yet.</td></tr>
                ) : (
                  history.map(renderHistoryRow)
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      {/* Assign shift modal */}
      <div
        className={`modal-bg${modalOpen ? '' : ' hidden'}`}
        onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Assign Shift</h3>

          <div>
            <label className="field-label">Worker</label>
            <select value={modalWorker} onChange={e => setModalWorker(e.target.value)}>
              <option value="">Select worker…</option>
              {allWorkers.map(w => (
                <option key={w.id} value={w.id}>{w.name || w.email}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label">Site</label>
            <select value={modalSite} onChange={e => setModalSite(e.target.value)}>
              <option value="">Select site…</option>
              {allSites.map(s => (
                <option key={s.id} value={s.id}>[{s.type}] {s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label">Ward / Location detail (optional)</label>
            <input
              type="text"
              placeholder="e.g. Ward 7, A&E, ICU"
              value={modalWard}
              onChange={e => setModalWard(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">Shift start</label>
            <input
              type="datetime-local"
              value={modalStart}
              onChange={e => setModalStart(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">Shift end</label>
            <input
              type="datetime-local"
              value={modalEnd}
              onChange={e => setModalEnd(e.target.value)}
            />
          </div>

          {modalErr && (
            <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>{modalErr}</div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={assignShift} disabled={assignLoading}>
              {assignLoading ? 'Saving…' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
