import React, { useState, useEffect } from 'react';
import { authSb, dataSb } from '../lib/supabase.js';
import { checkSite, getLocation } from '../lib/geo.js';
import { fmtTime } from '../lib/format.js';
import Logo from '../components/Logo.jsx';
import { GoogleIcon, MicrosoftIcon } from '../components/OAuthIcons.jsx';

export default function WorkerApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const [workerRow, setWorkerRow]     = useState(null);
  const [sites, setSites]             = useState([]);
  const [siteFilter, setSiteFilter]   = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [checkIns, setCheckIns]       = useState([]); // today's check-ins
  const [loading, setLoading]         = useState(null); // 'in' | 'out' | null
  const [alert, setAlert]             = useState(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const openCheckIn    = checkIns.find(c => !c.clocked_out_at) ?? null;
  const completedToday = checkIns.filter(c => c.clocked_out_at);
  const workerName     = workerRow?.name || currentUser?.user_metadata?.full_name || '';
  const filteredSites  = siteFilter.trim().length < 2
    ? sites
    : sites.filter(s => s.name.toLowerCase().includes(siteFilter.toLowerCase()));
  const view = !currentUser ? 'auth' : openCheckIn ? 'active' : 'home';

  // ── Auth ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function handleUser(user) {
      setCurrentUser(user);
      if (user) {
        const worker = await ensureWorker(user);
        if (worker) await loadData(worker.id);
      } else {
        setWorkerRow(null);
        setCheckIns([]);
      }
    }

    // Explicit getSession covers mobile Safari where INITIAL_SESSION can
    // fire before the listener below is registered.
    authSb.auth.getSession().then(({ data: { session } }) => {
      handleUser(session?.user ?? null);
    });

    const { data: { subscription } } = authSb.auth.onAuthStateChange(async (_e, session) => {
      handleUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function signIn(provider) {
    const redirectTo = window.location.origin + window.location.pathname;
    authSb.auth.signInWithOAuth({ provider, options: { redirectTo } });
  }

  async function signOut() {
    if (!confirm('Sign out?')) return;
    await authSb.auth.signOut();
    // onAuthStateChange handles state cleanup
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

  // ── Data ───────────────────────────────────────────────────────────────────
  async function loadData(workerId) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [{ data: siteRows }, { data: cis }] = await Promise.all([
      dataSb.from('sites').select('*').eq('type', 'hospital').order('name'),
      dataSb.from('check_ins')
        .select('*, site:sites(*)')
        .eq('worker_id', workerId)
        .gte('clocked_in_at', todayStart.toISOString())
        .order('clocked_in_at'),
    ]);
    setSites(siteRows || []);
    setCheckIns(cis || []);
  }

  // ── Clock in ───────────────────────────────────────────────────────────────
  async function clockIn() {
    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) { setAlert({ type: 'error', title: 'Select a hospital first' }); return; }

    setLoading('in');
    setAlert(null);

    try {
      const { lat, lon } = await getLocation();
      const result = checkSite(lat, lon, site);
      if (result.inside) {
        await doClockIn(site, lat, lon, result, true);
      } else {
        setAlert({ type: 'warn', warnData: { site, lat, lon, result } });
      }
    } catch (err) {
      setAlert({ type: 'error', title: 'Location error', body: err.message });
    } finally {
      setLoading(null);
    }
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

    if (error) {
      setAlert({ type: 'error', title: 'Clock-in failed', body: error.message });
    } else {
      setCheckIns(prev => [...prev, data]); // view derives to 'active' automatically
    }
  }

  // ── Clock out ──────────────────────────────────────────────────────────────
  async function clockOut() {
    setLoading('out');
    setAlert(null);

    try {
      const { lat, lon } = await getLocation();
      const now = new Date();
      await dataSb.from('check_ins').update({
        clocked_out_at: now.toISOString(),
        clock_out_lat: lat,
        clock_out_lon: lon,
        clock_out_distance_m: checkSite(lat, lon, openCheckIn.site).distance,
        duration_minutes: Math.round((now - new Date(openCheckIn.clocked_in_at)) / 60000),
      }).eq('id', openCheckIn.id);

      await loadData(workerRow.id);
    } catch (err) {
      setAlert({ type: 'error', title: 'Location error', body: err.message });
    } finally {
      setLoading(null);
    }
  }

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
              Sign in with the email address agreed with your agency.
            </div>
          </div>
          <button className="action-btn btn-auth-google" onClick={() => signIn('google')}>
            <GoogleIcon /> Continue with Gmail
          </button>
          <div className="or-line">or</div>
          <button className="action-btn btn-auth-microsoft" onClick={() => signIn('azure')}>
            <MicrosoftIcon /> Continue with Outlook
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
          <select value={selectedSiteId} onChange={e => setSelectedSiteId(e.target.value)}>
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
          disabled={loading === 'in' || !selectedSiteId}
        >
          {loading === 'in' ? 'Getting location…' : '▶ CLOCK IN'}
        </button>

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

        {openCheckIn && (
          <div className="shift-card" style={{ width: '100%' }}>
            <div className="status-badge badge-active">● Clocked in</div>
            <div className="shift-site">{openCheckIn.site.name}</div>
            <div className="shift-time" style={{ marginTop: '0.5rem' }}>
              Since {fmtTime(openCheckIn.clocked_in_at)}
            </div>
            {!openCheckIn.clock_in_geofence_passed && (
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
          disabled={loading === 'out'}
        >
          {loading === 'out' ? 'Getting location…' : '⏹︎ CLOCK OUT'}
        </button>

        {alert?.type === 'error' && (
          <div className="alert error" style={{ width: '100%' }}>
            <div className="alert-title">{alert.title}</div>
            {alert.body}
          </div>
        )}
      </div>

    </div>
  );
}
