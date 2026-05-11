import React, { useState, useEffect } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import { checkSite } from '../lib/geo.js';
import Logo from '../components/Logo.jsx';

function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

// Clock-in icon shown next to each shift card header
const ClockInIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);

export default function WorkerApp() {
  const [view, setView]               = useState('auth');
  const [currentUser, setCurrentUser] = useState(null);
  const [workerRow, setWorkerRow]     = useState(null);
  // Each shift has: ...shiftFields, site, checkIns: []
  const [todayShifts, setTodayShifts] = useState([]);
  // The shift + open check-in currently being worked
  const [activeShift, setActiveShift]       = useState(null);
  const [openCheckIn, setOpenCheckIn]       = useState(null);
  const [clockInTime, setClockInTime]       = useState(null);
  const [loadingShiftId, setLoadingShiftId] = useState(null);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [homeAlert, setHomeAlert]           = useState(null); // { type, title?, body?, warnData? }
  const [activeAlert, setActiveAlert]       = useState(null);

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
  }, []); // eslint-disable-line

  function signIn(provider) {
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo: 'http://localhost:3000/' } });
  }

  async function signOut() {
    if (!confirm('Sign out?')) return;
    await authSb.auth.signOut();
    setCurrentUser(null); setWorkerRow(null); setTodayShifts([]);
    setActiveShift(null); setOpenCheckIn(null);
    setView('auth');
  }

  // ── Worker profile ─────────────────────────────────────────────────────────

  async function ensureWorker(user) {
    const name = user.user_metadata?.full_name || user.email.split('@')[0];
    const { data, error } = await dataSb.from('workers')
      .upsert({ auth_user_id: user.id, name, email: user.email }, { onConflict: 'auth_user_id' })
      .select().single();
    if (!error) { setWorkerRow(data); return data; }
    return null;
  }

  // ── Load all today's shifts + all their check-ins ──────────────────────────

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

    if (!shifts?.length) { setTodayShifts([]); setView('home'); return; }

    // Fetch all check-ins for today's shifts in one query
    const { data: allCheckIns } = await dataSb.from('check_ins')
      .select('*')
      .in('shift_id', shifts.map(s => s.id))
      .order('clocked_in_at');

    const enriched = shifts.map(s => ({
      ...s,
      checkIns: (allCheckIns || []).filter(c => c.shift_id === s.id),
    }));

    setTodayShifts(enriched);

    // If any shift has an open check-in, go to active view
    const activeS = enriched.find(s => s.checkIns.some(c => !c.clocked_out_at));
    if (activeS) {
      const open = activeS.checkIns.find(c => !c.clocked_out_at);
      setActiveShift(activeS);
      setOpenCheckIn(open);
      setClockInTime(new Date(open.clocked_in_at));
      setView('active');
    } else {
      setActiveShift(null);
      setOpenCheckIn(null);
      setView('home');
    }
  }

  // ── Derive status for a shift ──────────────────────────────────────────────

  function shiftStatus(shift) {
    const now = new Date();
    if (shift.checkIns.some(c => !c.clocked_out_at)) return 'active';
    if (now >= new Date(shift.scheduled_end))          return 'expired';
    return 'available'; // includes shifts with past completed check-ins
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
      setActiveShift(shift);
      setOpenCheckIn(data);
      setClockInTime(new Date(data.clocked_in_at));
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
      }).eq('id', openCheckIn.id);

      // Mark shift upcoming again so it can be re-entered
      await dataSb.from('shifts').update({ status: 'upcoming' }).eq('id', activeShift.id);

      setClockOutLoading(false);
      // Reload all shifts and return to home
      await loadShifts(workerRow);
    }, (err) => {
      setClockOutLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Timed out.' };
      setActiveAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
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

      {/* ── Home view — all shifts ── */}
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
            const status    = shiftStatus(shift);
            const isLoading = loadingShiftId === shift.id;
            const isWarn    = homeAlert?.type === 'warn' && homeAlert.warnData?.shift.id === shift.id;
            const completed = shift.checkIns.filter(c => c.clocked_out_at);

            return (
              <div key={shift.id} className="shift-block">
                {/* Card header */}
                <div className={`shift-card${status === 'expired' ? ' shift-card--expired' : ''}`}>
                  <div className="shift-card-header">
                    <div>
                      {status === 'available' && <div className="status-badge badge-upcoming">Upcoming</div>}
                      {status === 'expired'   && <div className="status-badge badge-expired">Expired</div>}
                    </div>
                    {status === 'available' && (
                      <div className="shift-clock-hint"><ClockInIcon /> Clock in available</div>
                    )}
                  </div>

                  <div className="shift-site">{shift.site.name}</div>
                  {shift.ward && <div className="shift-ward">{shift.ward}</div>}
                  <div className="shift-time">
                    {fmtTime(shift.scheduled_start)} – {fmtTime(shift.scheduled_end)}
                  </div>
                  <div className="shift-worker">{workerName}</div>

                  {/* Past clock-in/out records for this shift */}
                  {completed.length > 0 && (
                    <div className="checkin-history">
                      {completed.map((ci, i) => (
                        <div key={ci.id} className="checkin-row">
                          <span className="checkin-index">#{i + 1}</span>
                          <span className="checkin-times">
                            {fmtTime(ci.clocked_in_at)} → {fmtTime(ci.clocked_out_at)}
                          </span>
                          <span className="checkin-dur">{ci.duration_minutes}m</span>
                          {!ci.clock_in_geofence_passed && (
                            <span className="checkin-flag" title="Clocked in outside geofence">⚠</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action */}
                {status === 'available' && !isWarn && (
                  <button
                    className="action-btn btn-clock-in"
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => clockIn(shift)}
                    disabled={isLoading || loadingShiftId !== null}
                  >
                    <ClockInIcon />
                    {isLoading ? 'Getting location…' : completed.length > 0 ? '▶ CLOCK IN AGAIN' : '▶ CLOCK IN'}
                  </button>
                )}

                {status === 'expired' && (
                  <p className="shift-expired-note">Clock-in window closed</p>
                )}

                {/* Geo warning for this shift */}
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

      {/* ── Active view ── */}
      <div className={`view${view === 'active' ? ' active' : ''}`}>
        <div className="topbar">
          <Logo size={26} textSize="0.9rem" />
          <div className="topbar-user">{workerName}</div>
        </div>

        {activeShift && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="status-badge badge-active">● Clocked in</div>
            <div className="shift-site">{activeShift.site?.name}</div>
            {activeShift.ward && <div className="shift-ward">{activeShift.ward}</div>}
            <div className="shift-time">
              {fmtTime(activeShift.scheduled_start)} – {fmtTime(activeShift.scheduled_end)}
            </div>
            {clockInTime && (
              <div className="shift-worker">Clocked in at {fmtTime(clockInTime)}</div>
            )}
          </div>
        )}

        <button
          className="action-btn btn-clock-out"
          style={{ marginTop: '1rem' }}
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

    </div>
  );
}
