import React, { useState, useEffect } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import { checkSite } from '../lib/geo.js';
import Logo from '../components/Logo.jsx';

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}


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

export default function WorkerApp() {
  const [view, setView]                 = useState('auth');
  const [currentUser, setCurrentUser]   = useState(null);
  const [workerRow, setWorkerRow]       = useState(null);
  const [todayShifts, setTodayShifts]   = useState([]);   // all shifts for today
  const [activeShift, setActiveShift]   = useState(null); // shift currently clocked into
  const [activeCheckIn, setActiveCheckIn] = useState(null);
  const [clockInTime, setClockInTime]   = useState(null);
  const [homeAlert, setHomeAlert]       = useState(null); // { type, title?, body?, warnData? }
  const [activeAlert, setActiveAlert]   = useState(null);
  const [loadingShiftId, setLoadingShiftId] = useState(null); // which shift's btn is spinning
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [confirmData, setConfirmData]   = useState(null);

  // ── Auth ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        const worker = await ensureWorker(user);
        if (worker) await loadShifts(worker);
      } else {
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
    setCurrentUser(null); setWorkerRow(null); setTodayShifts([]);
    setActiveShift(null); setActiveCheckIn(null); setClockInTime(null);
    setView('auth');
  }

  // ── Worker profile ─────────────────────────────────────────────────────────

  async function ensureWorker(user) {
    const name  = user.user_metadata?.full_name || user.email.split('@')[0];
    const { data, error } = await dataSb.from('workers')
      .upsert({ auth_user_id: user.id, name, email: user.email }, { onConflict: 'auth_user_id' })
      .select().single();
    if (!error) { setWorkerRow(data); return data; }
    return null;
  }

  // ── Load all today's shifts ────────────────────────────────────────────────

  async function loadShifts(worker) {
    const wr = worker || workerRow;
    if (!wr) return;

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const { data: shifts } = await dataSb.from('shifts')
      .select('*, site:sites(*)')
      .eq('worker_id', wr.id)
      .gte('scheduled_start', todayStart.toISOString())
      .lte('scheduled_start', todayEnd.toISOString())
      .order('scheduled_start');

    if (!shifts?.length) {
      setTodayShifts([]);
      setView('home');
      return;
    }

    // Load check-ins for all today's shifts in one query
    const shiftIds = shifts.map(s => s.id);
    const { data: checkIns } = await dataSb.from('check_ins')
      .select('*')
      .in('shift_id', shiftIds);

    // Attach check-in to each shift
    const enriched = shifts.map(s => ({
      ...s,
      checkIn: checkIns?.find(c => c.shift_id === s.id) ?? null,
    }));

    setTodayShifts(enriched);

    // If any shift is currently active (clocked in, not out), jump straight there
    const active = enriched.find(s => s.checkIn && !s.checkIn.clocked_out_at);
    if (active) {
      const t = new Date(active.checkIn.clocked_in_at);
      setActiveShift(active);
      setActiveCheckIn(active.checkIn);
      setClockInTime(t);
      setView('active');
    } else {
      setView('home');
    }
  }

  // ── Clock in ───────────────────────────────────────────────────────────────

  function clockIn(shift) {
    setLoadingShiftId(shift.id);
    setHomeAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = checkSite(lat, lon, shift.site);

      if (result.inside) {
        await doClockIn(shift, lat, lon, result, true);
      } else {
        setLoadingShiftId(null);
        setHomeAlert({ type: 'warn', warnData: { shift, lat, lon, result } });
      }
    }, (err) => {
      setLoadingShiftId(null);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Request timed out.' };
      setHomeAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function doClockIn(shift, lat, lon, result, geofencePassed) {
    setHomeAlert(null);
    const { data, error } = await dataSb.from('check_ins').insert({
      shift_id: shift.id,
      worker_id: workerRow.id,
      site_id: shift.site.id,
      clocked_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lon: lon,
      clock_in_distance_m: result.distance,
      clock_in_geofence_passed: geofencePassed,
    }).select().single();

    if (!error) {
      await dataSb.from('shifts').update({ status: 'active' }).eq('id', shift.id);
      const t = new Date(data.clocked_in_at);
      setActiveShift({ ...shift, checkIn: data });
      setActiveCheckIn(data);
      setClockInTime(t);
      setView('active');
    }
    setLoadingShiftId(null);
  }

  // ── Clock out ──────────────────────────────────────────────────────────────

  function clockOut() {
    setClockOutLoading(true);
    setActiveAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const now = new Date();
      const durationMins = Math.round((now - clockInTime) / 60000);
      const result = checkSite(lat, lon, activeShift.site);

      await dataSb.from('check_ins').update({
        clocked_out_at: now.toISOString(),
        clock_out_lat: lat,
        clock_out_lon: lon,
        clock_out_distance_m: result.distance,
        duration_minutes: durationMins,
      }).eq('id', activeCheckIn.id);

      await dataSb.from('shifts').update({ status: 'complete' }).eq('id', activeShift.id);

      setConfirmData({ clockOutTime: now, durationMins, distOut: result.distance });
      setClockOutLoading(false);
      setView('confirm');
    }, (err) => {
      setClockOutLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Timed out.' };
      setActiveAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function goHome() {
    setActiveShift(null);
    setActiveCheckIn(null);
    setConfirmData(null);
    await loadShifts(workerRow);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const workerName = workerRow?.name || currentUser?.user_metadata?.full_name || '';

  function shiftStatus(shift) {
    const now = new Date();
    const end = new Date(shift.scheduled_end);
    if (shift.checkIn && !shift.checkIn.clocked_out_at) return 'active';
    if (shift.checkIn && shift.checkIn.clocked_out_at)  return 'complete';
    if (now >= end)                                       return 'expired';
    return 'available';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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

        {todayShifts.length === 0 ? (
          <div className="no-shift">
            <strong>No shifts today</strong>
            You have no shifts scheduled for today.
          </div>
        ) : (
          todayShifts.map(shift => {
            const status   = shiftStatus(shift);
            const start    = new Date(shift.scheduled_start);
            const end      = new Date(shift.scheduled_end);
            const isLoading = loadingShiftId === shift.id;
            const isWarn    = homeAlert?.type === 'warn' && homeAlert.warnData?.shift.id === shift.id;

            return (
              <div key={shift.id} style={{ width: '100%' }}>
                <div className={`shift-card${status === 'expired' ? ' shift-card--expired' : ''}`}>
                  {status === 'available' && <div className="status-badge badge-upcoming">Upcoming</div>}
                  {status === 'complete'  && <div className="status-badge badge-complete">✓ Complete</div>}
                  {status === 'expired'   && <div className="status-badge badge-expired">Expired</div>}

                  <div className="shift-site">{shift.site.name}</div>
                  {shift.ward && <div className="shift-ward">{shift.ward}</div>}
                  <div className="shift-time">{fmtTime(start)} – {fmtTime(end)}</div>
                  <div className="shift-worker">{workerName}</div>

                  {status === 'complete' && shift.checkIn && (
                    <div className="shift-worker" style={{ marginTop: '0.4rem' }}>
                      {fmtTime(new Date(shift.checkIn.clocked_in_at))} → {fmtTime(new Date(shift.checkIn.clocked_out_at))}
                      {' · '}{shift.checkIn.duration_minutes}m
                    </div>
                  )}
                </div>

                {status === 'available' && !isWarn && (
                  <button
                    className="action-btn btn-clock-in"
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => clockIn(shift)}
                    disabled={isLoading || loadingShiftId !== null}
                  >
                    {isLoading ? 'Getting location…' : '▶ CLOCK IN'}
                  </button>
                )}

                {status === 'expired' && (
                  <p className="shift-expired-note">Clock-in window closed</p>
                )}

                {/* Geo warning for this specific shift */}
                {isWarn && (
                  <div className="alert warn" style={{ marginTop: '0.75rem' }}>
                    <div className="alert-title">You're far from site</div>
                    You appear to be <strong>{homeAlert.warnData.result.distance}m</strong> away from {shift.site.name}.
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
                          homeAlert.warnData.shift,
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
              </div>
            );
          })
        )}

        {homeAlert?.type === 'error' && (
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

        {activeShift && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="status-badge badge-active">● Live</div>
            <div className="shift-site">{activeShift.site?.name}</div>
            {activeShift.ward && <div className="shift-ward">{activeShift.ward}</div>}
            <div className="shift-time">
              {fmtTime(new Date(activeShift.scheduled_start))} – {fmtTime(new Date(activeShift.scheduled_end))}
            </div>
            <div className="shift-worker">
              {clockInTime ? `Clocked in at ${fmtTime(clockInTime)}` : ''}
            </div>
          </div>
        )}

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

        {confirmData && activeShift && (
          <div className="confirm-card">
            <div className="confirm-icon">✅</div>
            <div className="confirm-title">Shift complete</div>
            <div style={{ height: '0.5rem' }} />
            <div className="confirm-row">
              <span className="label">Site</span>
              <span className="value">{activeShift.site?.name}</span>
            </div>
            {activeShift.ward && (
              <div className="confirm-row">
                <span className="label">Ward</span>
                <span className="value">{activeShift.ward}</span>
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
