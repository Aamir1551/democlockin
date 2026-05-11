import React, { useState, useEffect, useRef, useCallback } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import { checkSite } from '../lib/geo.js';
import Logo from '../components/Logo.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
}

// ── Google SVG ────────────────────────────────────────────────────────────────

const GoogleSvg = () => (
  <svg width="16" height="16" viewBox="0 0 48 48">
    <path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.3 5.5-4.8 7.2v6h7.7c4.5-4.2 7.1-10.3 7.1-17.3z"/>
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9H2.5v6.2C6.5 42.6 14.7 48 24 48z"/>
    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6v-6.2H2.5C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l8-6.2z"/>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.7 0 6.5 5.4 2.5 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"/>
  </svg>
);

const MicrosoftSvg = () => (
  <svg width="16" height="16" viewBox="0 0 21 21">
    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
);

// ── Main component ────────────────────────────────────────────────────────────

export default function WorkerApp() {
  // view: 'auth' | 'home' | 'active' | 'confirm'
  const [view, setView]               = useState('auth');
  const [currentUser, setCurrentUser] = useState(null);
  const [workerRow, setWorkerRow]     = useState(null);
  const [todayShift, setTodayShift]   = useState(null);
  const [activeCheckIn, setActiveCheckIn] = useState(null);
  const [clockInTime, setClockInTime] = useState(null);
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [homeAlert, setHomeAlert]     = useState(null); // { type, title, body, warnData }
  const [activeAlert, setActiveAlert] = useState(null);
  const [clockInLoading, setClockInLoading] = useState(false);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [confirmData, setConfirmData] = useState(null);

  const timerRef = useRef(null);

  // ── Timer ──────────────────────────────────────────────────────────────────

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback((fromTime) => {
    stopTimer();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - fromTime.getTime();
      setTimerDisplay(fmtDuration(elapsed));
    }, 1000);
  }, [stopTimer]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  // ── Auth ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        const worker = await ensureWorker(user);
        await loadTodayShift(user, worker);
      } else {
        stopTimer();
        setView('auth');
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function signIn(provider) {
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo: 'http://localhost:3000/' } });
  }

  async function signOut() {
    if (!confirm('Sign out?')) return;
    await authSb.auth.signOut();
    setCurrentUser(null); setWorkerRow(null); setTodayShift(null);
    setActiveCheckIn(null); setClockInTime(null);
    stopTimer();
    setView('auth');
  }

  // ── Worker profile ─────────────────────────────────────────────────────────

  async function ensureWorker(user) {
    const name  = user.user_metadata?.full_name || user.email.split('@')[0];
    const email = user.email;
    const { data, error } = await dataSb.from('workers')
      .upsert({ auth_user_id: user.id, name, email }, { onConflict: 'auth_user_id' })
      .select().single();
    if (!error) { setWorkerRow(data); return data; }
    return null;
  }

  // ── Load today's shift ─────────────────────────────────────────────────────

  async function loadTodayShift(user, worker) {
    const wr = worker || workerRow;
    if (!wr) return;

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);

    const { data: shifts } = await dataSb.from('shifts')
      .select('*, site:sites(*)')
      .eq('worker_id', wr.id)
      .gte('scheduled_start', todayStart.toISOString())
      .lte('scheduled_start', todayEnd.toISOString())
      .order('scheduled_start')
      .limit(1);

    const shift = shifts?.[0] ?? null;
    setTodayShift(shift);

    let ci = null;
    if (shift) {
      const { data } = await dataSb.from('check_ins')
        .select('*')
        .eq('shift_id', shift.id)
        .is('clocked_out_at', null)
        .maybeSingle();
      ci = data;
    }
    setActiveCheckIn(ci);

    if (ci) {
      const t = new Date(ci.clocked_in_at);
      setClockInTime(t);
      startTimer(t);
      setView('active');
    } else {
      setView('home');
    }
  }

  // ── Clock in ───────────────────────────────────────────────────────────────

  function clockIn() {
    setClockInLoading(true);
    setHomeAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const site   = todayShift.site;
      const result = checkSite(lat, lon, site);

      if (result.inside) {
        await doClockIn(lat, lon, result, true);
      } else {
        setClockInLoading(false);
        setHomeAlert({ type: 'warn', warnData: { lat, lon, result, site } });
      }
    }, (err) => {
      setClockInLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Request timed out.' };
      setHomeAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function doClockIn(lat, lon, result, geofencePassed) {
    setHomeAlert(null);
    const site = todayShift.site;
    const { data, error } = await dataSb.from('check_ins').insert({
      shift_id: todayShift.id,
      worker_id: workerRow.id,
      site_id: site.id,
      clocked_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lon: lon,
      clock_in_distance_m: result.distance,
      clock_in_geofence_passed: geofencePassed,
    }).select().single();

    if (!error) {
      setActiveCheckIn(data);
      await dataSb.from('shifts').update({ status: 'active' }).eq('id', todayShift.id);
      const t = new Date(data.clocked_in_at);
      setClockInTime(t);
      startTimer(t);
      setView('active');
    }
    setClockInLoading(false);
  }

  // ── Clock out ──────────────────────────────────────────────────────────────

  function clockOut() {
    setClockOutLoading(true);
    setActiveAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const now = new Date();
      const durationMins = Math.round((now - clockInTime) / 60000);
      const site = todayShift.site;
      const result = checkSite(lat, lon, site);

      await dataSb.from('check_ins').update({
        clocked_out_at: now.toISOString(),
        clock_out_lat: lat,
        clock_out_lon: lon,
        clock_out_distance_m: result.distance,
        duration_minutes: durationMins,
      }).eq('id', activeCheckIn.id);

      await dataSb.from('shifts').update({ status: 'complete' }).eq('id', todayShift.id);

      stopTimer();
      setConfirmData({ clockOutTime: now, durationMins, distOut: result.distance });
      setClockOutLoading(false);
      setView('confirm');
    }, (err) => {
      setClockOutLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Timed out.' };
      setActiveAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  // ── Go home (after confirm) ────────────────────────────────────────────────

  async function goHome() {
    setActiveCheckIn(null);
    setConfirmData(null);
    await loadTodayShift(currentUser, workerRow);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const workerName = workerRow?.name || currentUser?.user_metadata?.full_name || '';

  return (
    <div className="worker-body">

      {/* ── Auth view ── */}
      <div className={`view${view === 'auth' ? ' active' : ''}`}>
        <div className="auth-card">
          <div>
            <Logo size={40} textSize="1.25rem" />
            <div className="auth-title" style={{ marginTop: '1rem' }}>Sign in to start</div>
            <div className="auth-sub" style={{ marginTop: '0.4rem' }}>
              Use the same account your agency registered you with.
            </div>
          </div>
          <button className="action-btn btn-auth-google" onClick={() => signIn('google')}>
            <GoogleSvg /> Continue with Gmail
          </button>
          <div className="or-line">or</div>
          <button className="action-btn btn-auth-microsoft" onClick={() => signIn('azure')}>
            <MicrosoftSvg /> Continue with Outlook
          </button>
        </div>
      </div>

      {/* ── Home view ── */}
      <div className={`view${view === 'home' ? ' active' : ''}`}>
        <div className="topbar">
          <Logo size={26} textSize="0.9rem" />
          <div className="topbar-user" onClick={signOut}>{workerName || 'Sign out'}</div>
        </div>

        {todayShift ? (
          <>
            <div className="shift-card" style={{ width: '100%' }}>
              <div className="status-badge badge-upcoming">Today's Shift</div>
              <div className="shift-site">{todayShift.site.name}</div>
              {todayShift.ward && <div className="shift-ward">{todayShift.ward}</div>}
              <div className="shift-time">
                {fmtTime(new Date(todayShift.scheduled_start))} – {fmtTime(new Date(todayShift.scheduled_end))}
              </div>
              <div className="shift-worker">{workerName}</div>
            </div>

            <button
              className="action-btn btn-clock-in"
              style={{ marginTop: '1.5rem' }}
              onClick={clockIn}
              disabled={clockInLoading}
            >
              {clockInLoading ? 'Getting location…' : '▶ CLOCK IN'}
            </button>
          </>
        ) : (
          <div className="no-shift">
            <strong>No shift today</strong>
            You have no shifts scheduled for today.
          </div>
        )}

        {/* Home alerts */}
        {homeAlert && homeAlert.type === 'warn' && homeAlert.warnData && (
          <div className="alert warn" style={{ width: '100%' }}>
            <div className="alert-title">You're far from site</div>
            You appear to be <strong>{homeAlert.warnData.result.distance}m</strong> away from {homeAlert.warnData.site.name}.
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="action-btn btn-secondary"
                style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem' }}
                onClick={() => setHomeAlert(null)}
              >
                Cancel
              </button>
              <button
                className="action-btn btn-clock-in"
                style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem' }}
                onClick={() => doClockIn(
                  homeAlert.warnData.lat,
                  homeAlert.warnData.lon,
                  homeAlert.warnData.result,
                  false
                )}
              >
                Clock in anyway
              </button>
            </div>
          </div>
        )}
        {homeAlert && homeAlert.type === 'error' && (
          <div className="alert error" style={{ width: '100%' }}>
            <div className="alert-title">{homeAlert.title}</div>
            {homeAlert.body}
          </div>
        )}
      </div>

      {/* ── Active shift view ── */}
      <div className={`view${view === 'active' ? ' active' : ''}`}>
        <div className="topbar">
          <Logo size={26} textSize="0.9rem" />
          <div className="topbar-user">{workerName}</div>
        </div>

        {todayShift && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="status-badge badge-active">● Live</div>
            <div className="shift-site">{todayShift.site?.name}</div>
            <div className="shift-ward">{todayShift.ward || ''}</div>
            <div className="shift-time">
              {todayShift.scheduled_start && fmtTime(new Date(todayShift.scheduled_start))} –{' '}
              {todayShift.scheduled_end && fmtTime(new Date(todayShift.scheduled_end))}
            </div>
            <div className="shift-worker">
              {clockInTime ? `Clocked in at ${fmtTime(clockInTime)}` : ''}
            </div>
          </div>
        )}

        <div className="timer">{timerDisplay}</div>
        <div className="timer-label">time on shift</div>

        <button
          className="action-btn btn-clock-out"
          onClick={clockOut}
          disabled={clockOutLoading}
        >
          {clockOutLoading ? 'Getting location…' : '⏹ CLOCK OUT'}
        </button>

        {activeAlert && (
          <div className={`alert ${activeAlert.type}`} style={{ width: '100%' }}>
            <div className="alert-title">{activeAlert.title}</div>
            {activeAlert.body}
          </div>
        )}
      </div>

      {/* ── Confirmation view ── */}
      <div className={`view${view === 'confirm' ? ' active' : ''}`}>
        <div className="topbar">
          <Logo size={26} textSize="0.9rem" />
        </div>

        {confirmData && todayShift && (
          <div className="confirm-card">
            <div className="confirm-icon">✅</div>
            <div className="confirm-title">Shift complete</div>
            <div style={{ height: '0.5rem' }} />
            <div className="confirm-row">
              <span className="label">Site</span>
              <span className="value">{todayShift.site?.name}</span>
            </div>
            {todayShift.ward && (
              <div className="confirm-row">
                <span className="label">Ward</span>
                <span className="value">{todayShift.ward}</span>
              </div>
            )}
            <div className="confirm-row">
              <span className="label">Clocked in</span>
              <span className="value">{clockInTime ? fmtTime(clockInTime) : '—'}</span>
            </div>
            <div className="confirm-row">
              <span className="label">Clocked out</span>
              <span className="value">{fmtTime(confirmData.clockOutTime)}</span>
            </div>
            <div className="confirm-row">
              <span className="label">Duration</span>
              <span className="value">
                {confirmData.durationMins >= 60
                  ? `${Math.floor(confirmData.durationMins / 60)}h ${confirmData.durationMins % 60}m`
                  : `${confirmData.durationMins}m`}
              </span>
            </div>
            <div className="confirm-row">
              <span className="label">Exit distance</span>
              <span className="value">{confirmData.distOut}m from site</span>
            </div>
            <div className="confirm-row">
              <span className="label">Status</span>
              <span className="value" style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Verified</span>
            </div>
          </div>
        )}

        <button className="action-btn btn-secondary" style={{ border: '1px solid #d1d5db' }} onClick={goHome}>
          Done
        </button>
      </div>

    </div>
  );
}
