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

export default function WorkerApp() {
  const [view, setView]               = useState('auth');
  const [currentUser, setCurrentUser] = useState(null);
  const [workerRow, setWorkerRow]     = useState(null);

  const [sites, setSites]             = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteFilter, setSiteFilter]   = useState('');

  const [todayCheckIns, setTodayCheckIns] = useState([]);
  const [openCheckIn, setOpenCheckIn]     = useState(null);   // currently clocked in
  const [openSite, setOpenSite]           = useState(null);   // site of open check-in
  const [clockInTime, setClockInTime]     = useState(null);

  const [clockInLoading, setClockInLoading]   = useState(false);
  const [clockOutLoading, setClockOutLoading] = useState(false);
  const [alert, setAlert]             = useState(null); // { type, title?, body?, warnData? }

  // ── Auth ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        const worker = await ensureWorker(user);
        if (worker) await loadData(worker);
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
    setCurrentUser(null); setWorkerRow(null);
    setOpenCheckIn(null); setView('auth');
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

  // ── Load sites + today's check-ins ────────────────────────────────────────

  async function loadData(worker) {
    const wr = worker || workerRow;
    if (!wr) return;

    // Load all hospital sites (sorted alphabetically)
    const { data: siteRows } = await dataSb.from('sites')
      .select('*')
      .eq('type', 'hospital')
      .order('name');
    setSites(siteRows || []);

    // Load today's check-ins for this worker
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: cis } = await dataSb.from('check_ins')
      .select('*, site:sites(*)')
      .eq('worker_id', wr.id)
      .gte('clocked_in_at', todayStart.toISOString())
      .order('clocked_in_at');

    setTodayCheckIns(cis || []);

    const open = cis?.find(c => !c.clocked_out_at) ?? null;
    setOpenCheckIn(open);
    setOpenSite(open?.site ?? null);
    if (open) setClockInTime(new Date(open.clocked_in_at));

    setView(open ? 'active' : 'home');
  }

  // ── Clock in ───────────────────────────────────────────────────────────────

  function clockIn() {
    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) { setAlert({ type: 'error', title: 'Select a hospital first' }); return; }

    setClockInLoading(true);
    setAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const result = checkSite(lat, lon, site);

      if (result.inside) {
        await doClockIn(site, lat, lon, result, true);
      } else {
        setClockInLoading(false);
        setAlert({ type: 'warn', warnData: { site, lat, lon, result } });
      }
    }, (err) => {
      setClockInLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Request timed out.' };
      setAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function doClockIn(site, lat, lon, result, geofencePassed) {
    setAlert(null);
    const { data, error } = await dataSb.from('check_ins').insert({
      worker_id: workerRow.id,
      site_id: site.id,
      clocked_in_at: new Date().toISOString(),
      clock_in_lat: lat,
      clock_in_lon: lon,
      clock_in_distance_m: result.distance,
      clock_in_geofence_passed: geofencePassed,
    }).select('*, site:sites(*)').single();

    if (!error) {
      setOpenCheckIn(data);
      setOpenSite(data.site);
      setClockInTime(new Date(data.clocked_in_at));
      setView('active');
    }
    setClockInLoading(false);
  }

  // ── Clock out ──────────────────────────────────────────────────────────────

  function clockOut() {
    setClockOutLoading(true);
    setAlert(null);

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const now = new Date();
      const durationMins = Math.round((now - clockInTime) / 60000);
      const result = checkSite(lat, lon, openSite);

      await dataSb.from('check_ins').update({
        clocked_out_at: now.toISOString(),
        clock_out_lat: lat,
        clock_out_lon: lon,
        clock_out_distance_m: result.distance,
        duration_minutes: durationMins,
      }).eq('id', openCheckIn.id);

      setClockOutLoading(false);
      await loadData(workerRow);
    }, (err) => {
      setClockOutLoading(false);
      const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Timed out.' };
      setAlert({ type: 'error', title: 'Location error', body: msgs[err.code] || 'Unknown error.' });
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  // ── Filtered site list for search ──────────────────────────────────────────

  const filteredSites = siteFilter.trim().length < 2
    ? sites
    : sites.filter(s => s.name.toLowerCase().includes(siteFilter.toLowerCase()));

  const workerName = workerRow?.name || currentUser?.user_metadata?.full_name || '';
  const completedToday = todayCheckIns.filter(c => c.clocked_out_at);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="worker-body">

      {/* ── Auth ── */}
      <div className={`view${view === 'auth' ? ' active' : ''}`}>
        <div className="auth-card">
          <div>
            <Logo size={40} textSize="1.25rem" />
            <div className="auth-title" style={{ marginTop: '1rem' }}>Sign in to start</div>
            <div className="auth-sub" style={{ marginTop: '0.4rem' }}>
              Use your NHS or work account to clock in at any hospital.
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

      {/* ── Home ── */}
      <div className={`view${view === 'home' ? ' active' : ''}`}>
        <div className="topbar">
          <div>
            <Logo size={26} textSize="0.9rem" />
            <div className="topbar-signed-in">Signed in as {workerName || currentUser?.email}</div>
          </div>
          <button className="signout-btn" onClick={signOut}>Log out</button>
        </div>

        {/* Today's completed sessions */}
        {completedToday.length > 0 && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="shift-tag">Today's sessions</div>
            <div className="checkin-history" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              {completedToday.map((ci, i) => (
                <div key={ci.id} className="checkin-row">
                  <span className="checkin-index">#{i + 1}</span>
                  <span className="checkin-times">{ci.site?.name}</span>
                  <span className="checkin-dur">{fmtTime(ci.clocked_in_at)} → {fmtTime(ci.clocked_out_at)}</span>
                  {!ci.clock_in_geofence_passed && <span className="checkin-flag">⚠</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clock-in form */}
        <div className="shift-card" style={{ width: '100%' }}>
          <div className="shift-tag">Clock in</div>

          <label className="field-label" style={{ marginTop: '0.5rem' }}>Search hospital</label>
          <input
            type="text"
            placeholder="Type to filter…"
            value={siteFilter}
            onChange={e => { setSiteFilter(e.target.value); setSelectedSiteId(''); }}
            style={{ marginBottom: '0.5rem' }}
          />

          <label className="field-label">Select hospital</label>
          <select
            value={selectedSiteId}
            onChange={e => setSelectedSiteId(e.target.value)}
          >
            <option value="">— choose a hospital —</option>
            {filteredSites.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <button
          className="action-btn btn-clock-in"
          style={{ marginTop: '0.75rem' }}
          onClick={clockIn}
          disabled={clockInLoading || !selectedSiteId}
        >
          {clockInLoading ? 'Getting location…' : '▶ CLOCK IN'}
        </button>

        {/* Geo warning */}
        {alert?.type === 'warn' && alert.warnData && (
          <div className="alert warn" style={{ width: '100%' }}>
            <div className="alert-title">You're far from site</div>
            You appear to be <strong>{alert.warnData.result.distance}m</strong> away from {alert.warnData.site.name}.
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="action-btn btn-secondary"
                style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem' }}
                onClick={() => setAlert(null)}
              >
                Cancel
              </button>
              <button
                className="action-btn btn-clock-in"
                style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem' }}
                onClick={() => doClockIn(alert.warnData.site, alert.warnData.lat, alert.warnData.lon, alert.warnData.result, false)}
              >
                Clock in anyway
              </button>
            </div>
          </div>
        )}

        {alert?.type === 'error' && (
          <div className="alert error" style={{ width: '100%' }}>
            <div className="alert-title">{alert.title}</div>
            {alert.body}
          </div>
        )}
      </div>

      {/* ── Active ── */}
      <div className={`view${view === 'active' ? ' active' : ''}`}>
        <div className="topbar">
          <div>
            <Logo size={26} textSize="0.9rem" />
            <div className="topbar-signed-in">Signed in as {workerName || currentUser?.email}</div>
          </div>
          <button className="signout-btn" onClick={signOut}>Log out</button>
        </div>

        {openSite && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="status-badge badge-active">● Clocked in</div>
            <div className="shift-site">{openSite.name}</div>
            {clockInTime && (
              <div className="shift-time" style={{ marginTop: '0.5rem' }}>
                Since {fmtTime(clockInTime)}
              </div>
            )}
            {!openCheckIn?.clock_in_geofence_passed && (
              <div className="shift-worker" style={{ color: 'var(--orange)', marginTop: '0.3rem' }}>
                ⚠ Clocked in outside geofence
              </div>
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

        {alert?.type === 'error' && (
          <div className={`alert ${alert.type}`} style={{ width: '100%' }}>
            <div className="alert-title">{alert.title}</div>
            {alert.body}
          </div>
        )}
      </div>

    </div>
  );
}
