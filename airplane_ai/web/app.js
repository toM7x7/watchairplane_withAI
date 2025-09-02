// Minimal, encoding-safe entry for stable grid + flights rendering
import { geodeticToENU } from './geo.js';

async function loadThree() {
  try { return await import('./lib/three.module.js'); }
  catch { return await import('https://unpkg.com/three@0.161.0?module'); }
}

async function loadExample(local, cdn) {
  try { return await import(local); }
  catch { return await import(cdn); }
}

async function main() {
  const THREE = await loadThree();
  const { OrbitControls } = await loadExample(
    './lib/OrbitControls.js',
    'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js?module'
  );
  const { ARButton } = await loadExample(
    './lib/ARButton.js',
    'https://unpkg.com/three@0.161.0/examples/jsm/webxr/ARButton.js?module'
  );

  const app = document.getElementById('app');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e13);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 2, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  app.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5, 10, 7); scene.add(dir);

  const world = new THREE.Group(); scene.add(world);
  const grid = new THREE.GridHelper(20, 20, 0x93c5fd, 0x475569); scene.add(grid);

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32),
    new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
  ); reticle.rotation.x = -Math.PI / 2; reticle.visible = false; scene.add(reticle);

  // Config/state
  const cfg = (window.AI_CONFIG || {});
  const host = location.hostname || 'localhost';
  const proto = location.protocol === 'https:' ? 'https' : 'http';
  const FLIGHT_PROXY = cfg.FLIGHT_PROXY || `${proto}://${host}:8000`;
  const TTS_API = cfg.TTS_API || `${FLIGHT_PROXY}`;

  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  const markers = []; const labels = new Map();
  let currentFlights = []; let selectedIndex = -1; let isAR = false;
  let origin = { lat: 35.6812, lon: 139.7671, alt: 0 };
  let showFlights = true; let hitTestSource = null; let refSpace = null; let lastHitResult = null;

  function setLoading(v) { const el = document.getElementById('loading'); if (el) el.style.display = v ? 'block' : 'none'; }
  function setMarkersVisible(v) { markers.forEach(m => m.visible = v); labels.forEach(sp => sp.visible = v); }
  function updateStatus(source, count) {
    let el = document.getElementById('status'); if (!el) { el = document.createElement('div'); el.id = 'status';
      Object.assign(el.style, { position: 'absolute', top: '8px', right: '8px', fontSize: '12px', opacity: '0.8', background: 'rgba(17,24,39,.5)', padding: '4px 6px', borderRadius: '4px' }); document.body.appendChild(el); }
    el.textContent = `source: ${source} | flights: ${count}`;
  }

  function latLonToXZ(lat, lon) {
    const dLat = (lat - origin.lat) * 111000;
    const dLon = (lon - origin.lon) * 111000 * Math.cos(origin.lat * Math.PI / 180);
    return { x: dLon / 1000, z: -dLat / 1000 };
  }
  function makePlaneMarker(color = 0x3b82f6) {
    const g = new THREE.ConeGeometry(0.15, 0.5, 12);
    const m = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(g, m); mesh.rotation.x = Math.PI / 2; return mesh;
  }
  function makeLabel(text) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15,23,42,0.9)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#e5e7eb'; ctx.font = '28px system-ui, sans-serif'; ctx.fillText(String(text || ''), 16, 64);
    const tex = new THREE.CanvasTexture(canvas); return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  }

  async function fetchFlights() {
    try {
      const rEl = document.getElementById('radius'); const radius = Math.max(1, parseFloat(rEl?.value || rEl?.placeholder || '30'));
      const url = `${FLIGHT_PROXY}/flights?lat=${encodeURIComponent(origin.lat)}&lon=${encodeURIComponent(origin.lon)}&radius=${radius}`;
      const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json(); const flights = data.flights || []; updateStatus(data.source || 'unknown', flights.length); return flights;
    } catch (e) { console.warn('flights fetch failed:', e); updateStatus('error', 0); return []; }
  }

  function renderFlights(flights) {
    currentFlights = flights; markers.splice(0).forEach(m => world.remove(m)); labels.forEach(sp => world.remove(sp)); labels.clear();
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i]; const marker = makePlaneMarker();
      if (isAR) { const enu = geodeticToENU(f.lat, f.lon, (f.alt || 0), origin); marker.position.set(enu.e / 1000, Math.max(0.1, (f.alt || 0) / 5000), -enu.n / 1000); }
      else { const { x, z } = latLonToXZ(f.lat, f.lon); marker.position.set(x, 0.1 + (f.alt || 0) / 50000, z); }
      marker.rotation.y = THREE.MathUtils.degToRad(-(f.heading || 0)); world.add(marker); markers.push(marker);
      const label = makeLabel(`${i + 1}: ${f.callsign || f.id || 'FLIGHT'}`); label.position.copy(marker.position.clone().add(new THREE.Vector3(0, 0.25, 0))); world.add(label); labels.set(marker.uuid, label);
    }
    updateFlightList(flights); if (!flights.length) { const ghost = makePlaneMarker(0x64748b); ghost.position.set(0, 0.2, 0); world.add(ghost); markers.push(ghost); }
    setMarkersVisible(showFlights); setLoading(false);
  }

  async function refreshMarkers() { setLoading(true); const flights = await fetchFlights(); renderFlights(flights); }

  function updateFlightList(flights) {
    const list = document.getElementById('flightList'); if (!list) return; list.innerHTML = '';
    flights.forEach((f, idx) => {
      const div = document.createElement('div'); div.className = 'item'; const title = (f.callsign || f.id || 'FLIGHT').trim();
      const alt = Math.round((f.alt || 0)); const spd = Math.round((f.speed || 0) * 1.94384); const h = Math.round(f.heading || 0);
      div.innerHTML = `<div><div>${title}</div><div class="meta">alt ${alt}m / hdg ${h} / spd ${spd}kt</div></div><div>#${idx + 1}</div>`;
      div.addEventListener('click', () => selectFlight(idx, true)); list.appendChild(div);
    }); refreshListSelection();
  }
  function refreshListSelection() { const list = document.getElementById('flightList'); if (!list) return; Array.from(list.children).forEach((el, idx) => { el.classList.toggle('selected', idx === selectedIndex); }); }
  function selectFlight(index, announce) { const marker = markers[index]; if (!marker) return; selectedIndex = index; const COLOR_DEFAULT = 0x3b82f6, COLOR_SELECTED = 0xf59e0b; markers.forEach(m => m.material.color.setHex(COLOR_DEFAULT)); marker.material.color.setHex(COLOR_SELECTED); const lbl = labels.get(marker.uuid); if (lbl) lbl.visible = true; controls.target.copy(marker.position); camera.lookAt(marker.position); refreshListSelection(); updateHUD(); if (announce) { const f = currentFlights[index]; if (f) speak(`Flight ${f.callsign || f.id}`); } }
  function updateHUD() { const hud = document.getElementById('hud'); if (!hud) return; const f = currentFlights[selectedIndex]; if (!f) { hud.style.display = 'none'; return; } const enu = geodeticToENU(f.lat, f.lon, (f.alt||0), origin); const dist = Math.sqrt(enu.e*enu.e + enu.n*enu.n) / 1000; const bearing = Math.atan2(enu.e, enu.n) * 180 / Math.PI; const altm = Math.round(f.alt || 0); const spdkt = Math.round((f.speed || 0) * 1.94384); hud.innerHTML = `Selected <b>${(f.callsign || f.id || 'FLIGHT').trim()}</b> | dist ${dist.toFixed(1)} km | bearing ${Math.round((bearing+360)%360)}° | alt ${altm} m | spd ${spdkt} kt`; hud.style.display = 'block'; }

  async function speak(text) {
    try { const r = await fetch(`${TTS_API}/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); if (r.ok && (r.headers.get('Content-Type') || '').includes('audio/mpeg')) { const blob = await r.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audio.play(); return; } } catch {}
    try { const u = new SpeechSynthesisUtterance(String(text || '')); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch {}
  }

  // Toolbar
  const toggleBtn = document.getElementById('toggleFlights'); if (toggleBtn) toggleBtn.addEventListener('click', () => { showFlights = !showFlights; setMarkersVisible(showFlights); });
  const clearSelBtn = document.getElementById('clearSel'); if (clearSelBtn) clearSelBtn.addEventListener('click', () => { selectedIndex = -1; refreshListSelection(); updateHUD(); });
  const speakBtn = document.getElementById('speakBtn'); if (speakBtn) speakBtn.addEventListener('click', async () => { const flights = currentFlights.length ? currentFlights : await fetchFlights(); if (!flights.length) return speak('No flights'); const f = flights[0]; speak(`Flight ${f.callsign || f.id}.`); });
  const setCenterBtn = document.getElementById('setCenter'); if (setCenterBtn) setCenterBtn.addEventListener('click', async () => { const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon'); const lat = parseFloat(latEl?.value || latEl?.placeholder || '35.68'); const lon = parseFloat(lonEl?.value || lonEl?.placeholder || '139.76'); await setOrigin(lat, lon); refreshMarkers(); });
  const myLocBtn = document.getElementById('myLoc'); if (myLocBtn && navigator.geolocation) myLocBtn.addEventListener('click', () => { navigator.geolocation.getCurrentPosition(async (pos) => { await setOrigin(pos.coords.latitude, pos.coords.longitude); refreshMarkers(); }); });
  const fetchNowBtn = document.getElementById('fetchNow'); if (fetchNowBtn) fetchNowBtn.addEventListener('click', refreshMarkers);

  const PRESETS = { HND:{lat:35.5494,lon:139.7798}, NRT:{lat:35.7720,lon:140.3929}, KIX:{lat:34.4273,lon:135.2440}, ITM:{lat:34.7855,lon:135.4382}, NGO:{lat:34.8584,lon:136.8044}, FUK:{lat:33.5859,lon:130.4507}, OKA:{lat:26.2068,lon:127.6469}, JFK:{lat:40.6413,lon:-73.7781}, LAX:{lat:33.9416,lon:-118.4085}, LHR:{lat:51.4700,lon:-0.4543} };
  const presetSel = document.getElementById('presetSel'); const presetBtn = document.getElementById('jumpPreset'); if (presetBtn) presetBtn.addEventListener('click', async () => { const key = presetSel && presetSel.value; const p = PRESETS[key]; if (p) { await setOrigin(p.lat, p.lon); refreshMarkers(); } });
  async function setOrigin(lat, lon) { origin = { ...origin, lat, lon }; const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon'); if (latEl) latEl.value = String(lat.toFixed(4)); if (lonEl) lonEl.value = String(lon.toFixed(4)); }

  // AR minimal
  renderer.xr.enabled = true;
  const button = ARButton.createButton(renderer, { requiredFeatures: [], optionalFeatures: ['hit-test'] }); document.body.appendChild(button);
  renderer.xr.addEventListener('sessionstart', async () => { isAR = true; grid.visible = false; try { const s = renderer.xr.getSession(); refSpace = await s.requestReferenceSpace('local'); const viewer = await s.requestReferenceSpace('viewer'); hitTestSource = await s.requestHitTestSource({ space: viewer }); } catch { hitTestSource = null; } });
  renderer.xr.addEventListener('sessionend', () => { isAR = false; grid.visible = true; hitTestSource = null; refSpace = null; reticle.visible = false; refreshMarkers(); });

  renderer.setAnimationLoop((t, frame) => { controls.update(); if (isAR && frame && hitTestSource && refSpace) { const results = frame.getHitTestResults(hitTestSource); if (results && results.length) { const pose = results[0].getPose(refSpace); if (pose) { reticle.visible = true; reticle.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z); const o = pose.transform.orientation; reticle.quaternion.set(o.x, o.y, o.z, o.w); } } else { reticle.visible = false; } } renderer.render(scene, camera); });

  // init
  await setOrigin(origin.lat, origin.lon);
  refreshMarkers();
}

main().catch(console.error);

