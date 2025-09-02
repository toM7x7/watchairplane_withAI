// Three.js + WebXR with AR hit-test placement (Quest-ready), desktop fallback
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

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // World group (can be moved by AR hit-test placement)
  const world = new THREE.Group();
  scene.add(world);

  // Desktop grid helper
  const grid = new THREE.GridHelper(20, 20, 0x93c5fd, 0x475569);
  scene.add(grid);

  // Reticle for AR hit-test
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32),
    new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.visible = false;
  scene.add(reticle);

  // State
  const cfg = (window.AI_CONFIG || {});
  // Derive defaults from current page host so Quest/remote devices hit the PC, not their own localhost
  const host = (location && location.hostname) ? location.hostname : 'localhost';
  const proto = (location && location.protocol === 'https:') ? 'https' : 'http';
  const FLIGHT_PROXY = cfg.FLIGHT_PROXY || `${proto}://${host}:8000`;
  const TTS_API = cfg.TTS_API || `${FLIGHT_PROXY}`; // default: proxy provides /speak
  const CHAT_API = cfg.CHAT_API || `${FLIGHT_PROXY}`; // proxy base URL
  let chatHistory = [];
  function buildSystemPrompt(persona) {
    const role = persona || '航空に詳しいガイド';
    return [
      `あなたは${role}です。`,
      '利用者が見ている周辺の飛行機について、簡潔で親しみやすい日本語で説明します。',
      '以下の要素を可能な範囲で含めてください:',
      '- 方向（方位/相対方角: 北東/南西 など）、距離（おおよそ）、高度（m/ftのどちらかで統一）、速度（kt 目安）',
      '- 便名/コールサイン、地理的な位置感（湾上空/空港の◯◯km手前 など）',
      '1〜2文で短く、推測は断定しすぎない表現で。安全とプライバシーに配慮し、煽らない表現にする。',
    ].join('\n');
  }
  let systemPrompt = buildSystemPrompt('航空に詳しいガイド');
  let typewriterRunning = false;
  const SCALE = 0.001; // meters -> world units for AR ENU
  let observeMode = false; let lastObserveAt = 0; const OBS_COOLDOWN = 2000;
  let gazeCandidate = null; let gazeStreak = 0; const GAZE_FRAMES = 12;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const markers = [];
  const labels = new Map();
  let currentFlights = [];
  let selectedIndex = -1;
  let isAR = false;
  let origin = { lat: 35.6812, lon: 139.7671, alt: 0 };
  let showFlights = true;
  let xrSession = null;
  let refSpace = null;
  let viewerSpace = null;
  let hitTestSource = null;
  let lastHitResult = null;
  let worldAnchor = null; // XRAnchor when available
  const planeMeshes = new Map(); // XRPlane -> THREE.Mesh (debug viz)
  let chatPanel = null; // 3Dチャットパネル
  let largestPlaneId = null;
  const pinchState = new Map(); // inputSource -> boolean

  // UI helpers
  function setLoading(v) { const el = document.getElementById('loading'); if (el) el.style.display = v ? 'block' : 'none'; }
  function setTip(v) { const el = document.getElementById('tip'); if (el) el.style.display = v ? 'block' : 'none'; }
  function setGuide(text, show=true, timeoutMs=0) {
    const el = document.getElementById('guide'); if (!el) return; el.textContent = String(text||''); el.style.display = show ? 'block' : 'none'; if (show && timeoutMs>0) setTimeout(()=>{ el.style.display='none'; }, timeoutMs);
  }
  function setMarkersVisible(v) { markers.forEach(m => m.visible = v); labels.forEach(sp => sp.visible = v); }

  // Geometry
  function makePlaneMarker(color = 0x3b82f6) {
    const g = new THREE.BoxGeometry(0.3, 0.1, 0.6);
    const m = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; return mesh;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill(); }
  function makeLabel(text) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    const pad = 6, fs = 22, font = `${fs}px system-ui, sans-serif`; ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2; const h = fs + pad * 2;
    canvas.width = w * 2; canvas.height = h * 2; const ctx2 = canvas.getContext('2d');
    ctx2.scale(2, 2); ctx2.font = font; ctx2.fillStyle = 'rgba(17,24,39,0.85)'; roundRect(ctx2, 0, 0, w, h, 6);
    ctx2.fillStyle = '#e5e7eb'; ctx2.fillText(text, pad, h - pad - 2);
    const tex = new THREE.CanvasTexture(canvas); const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sp = new THREE.Sprite(mat); sp.scale.set(w / 100, h / 100, 1); return sp;
  }

  // Desktop mapping: relative to current origin
  function latLonToXZ(lat, lon) {
    const Rkm = 111; const dLat = (lat - origin.lat); const dLon = (lon - origin.lon);
    const m = Math.cos(THREE.MathUtils.degToRad((lat + origin.lat) / 2));
    const dxKm = dLon * Rkm * m; const dzKm = dLat * Rkm; const KM_TO_UNIT = 0.05; // 1 unit = 20km
    return { x: dxKm * KM_TO_UNIT, z: dzKm * KM_TO_UNIT };
  }

  // Preset airports/cities for quick jumps
  const PRESETS = {
    HND: { lat: 35.5494, lon: 139.7798 },
    NRT: { lat: 35.7730, lon: 140.3860 },
    KIX: { lat: 34.4340, lon: 135.2320 },
    ITM: { lat: 34.7855, lon: 135.4382 },
    NGO: { lat: 34.8583, lon: 136.8050 },
    FUK: { lat: 33.5859, lon: 130.4510 },
    OKA: { lat: 26.2068, lon: 127.6469 },
    JFK: { lat: 40.6413, lon: -73.7781 },
    LAX: { lat: 33.9416, lon: -118.4085 },
    LHR: { lat: 51.4700, lon: -0.4543 },
  };

  async function setOrigin(lat, lon) {
    origin.lat = lat; origin.lon = lon;
    const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon');
    if (latEl) latEl.value = lat.toFixed(4); if (lonEl) lonEl.value = lon.toFixed(4);
    await refreshMarkers();
  }

  async function fetchFlights() {
    try {
      const rEl = document.getElementById('radius'); const radius = Math.max(1, parseFloat((rEl && (rEl.value || rEl.placeholder)) || '30'));
      const url = `${FLIGHT_PROXY}/flights?lat=${encodeURIComponent(origin.lat)}&lon=${encodeURIComponent(origin.lon)}&radius=${radius}`;
      const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json(); const flights = data.flights || []; updateStatus(data.source || 'unknown', flights.length); return flights;
    } catch (e) { console.warn('flights fetch failed:', e); updateStatus('error', 0); return []; }
  }

  function updateStatus(source, count) {
    let el = document.getElementById('status'); if (!el) { el = document.createElement('div'); el.id = 'status';
      Object.assign(el.style, { position: 'absolute', top: '8px', right: '8px', fontSize: '12px', opacity: '0.8', background: 'rgba(17,24,39,.5)', padding: '4px 6px', borderRadius: '4px' }); document.body.appendChild(el); }
    el.textContent = `source: ${source} | flights: ${count}`;
  }

  // 3Dチャットパネル（Canvas描画）
  class ChatPanel {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024; this.canvas.height = 512;
      this.ctx = this.canvas.getContext('2d');
      this.tex = new THREE.CanvasTexture(this.canvas);
      const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
      this.mesh.renderOrder = 999; // draw on top
      this.lastDrawnCount = -1;
    }
    draw(history, persona, flight) {
      const ctx = this.ctx; const W = this.canvas.width, H = this.canvas.height;
      ctx.clearRect(0,0,W,H);
      // background
      ctx.fillStyle = 'rgba(15,23,42,0.92)'; ctx.fillRect(0,0,W,H);
      // header
      ctx.fillStyle = '#e5e7eb'; ctx.font = '28px system-ui, sans-serif';
      ctx.fillText('AI対話（3Dパネル）', 24, 44);
      ctx.font = '16px system-ui, sans-serif';
      const personaText = persona ? `Persona: ${persona}` : '';
      const flightText = flight ? `Flight: ${(flight.callsign||flight.id||'')}` : '';
      ctx.fillStyle = '#93c5fd'; ctx.fillText(personaText, 24, 72);
      ctx.fillStyle = '#a7f3d0'; ctx.fillText(flightText, 24, 96);
      // messages (last 6)
      const msgs = (history || []).slice(-6);
      let y = 130;
      for (const m of msgs) {
        const role = m.role === 'assistant' ? 'AI' : 'You';
        ctx.fillStyle = m.role === 'assistant' ? '#fef3c7' : '#c7d2fe';
        ctx.fillText(`${role}:`, 24, y);
        ctx.fillStyle = '#e5e7eb';
        const lines = wrapText(ctx, String(m.text || ''), 24, y+6, W-48, 22);
        y += 22 * (lines + 1);
        if (y > H - 24) break;
      }
      this.tex.needsUpdate = true;
      this.lastDrawnCount = (history || []).length;
    }
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/); let line = ''; let count = 0;
    for (let n = 0; n < words.length; n++) {
      const test = line + words[n] + ' ';
      if (ctx.measureText(test).width > maxWidth && n > 0) { ctx.fillText(line, x, y); line = words[n] + ' '; y += lineHeight; count++; }
      else { line = test; }
    }
    ctx.fillText(line, x, y); return count + 1;
  }

  function renderFlights(flights) {
    currentFlights = flights;
    // clear
    markers.splice(0).forEach(m => world.remove(m)); labels.forEach(sp => world.remove(sp)); labels.clear();
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i]; const marker = makePlaneMarker();
      if (isAR) { const enu = geodeticToENU(f.lat, f.lon, (f.alt || 0), origin); marker.position.set(enu.e * SCALE, Math.max(0.1, enu.u * SCALE), -enu.n * SCALE); }
      else { const { x, z } = latLonToXZ(f.lat, f.lon); marker.position.set(x, 0.1 + (f.alt || 0) / 50000, z); }
      marker.rotation.y = THREE.MathUtils.degToRad(-(f.heading || 0)); world.add(marker); markers.push(marker);
      const label = makeLabel(`${i + 1}: ${f.callsign || f.id || 'FLIGHT'}`);
      label.position.copy(marker.position.clone().add(new THREE.Vector3(0, 0.25, 0))); world.add(label); labels.set(marker.uuid, label);
    }
    updateFlightList(flights);
    if (!flights.length) { const ghost = makePlaneMarker(0x64748b); ghost.position.set(0, 0.2, 0); world.add(ghost); markers.push(ghost); }
    setMarkersVisible(showFlights); setLoading(false);
  }

  async function refreshMarkers() {
    setLoading(true); const flights = await fetchFlights(); renderFlights(flights);
  }

  function updateFlightList(flights) {
    const list = document.getElementById('flightList'); if (!list) return; list.innerHTML = '';
    flights.forEach((f, idx) => {
      const div = document.createElement('div'); div.className = 'item'; const title = (f.callsign || f.id || 'FLIGHT').trim();
      const alt = Math.round((f.alt || 0)); const spd = Math.round((f.speed || 0) * 1.94384); const h = Math.round(f.heading || 0);
      div.innerHTML = `<div><div>${title}</div><div class="meta">alt ${alt}m / hdg ${h} / spd ${spd}kt</div></div><div>#${idx + 1}</div>`;
      div.addEventListener('click', () => selectFlight(idx, true));
      list.appendChild(div);
    });
    refreshListSelection();
  }

  function refreshListSelection() {
    const list = document.getElementById('flightList'); if (!list) return;
    Array.from(list.children).forEach((el, idx) => { if (el.classList) el.classList.toggle('selected', idx === selectedIndex); });
  }

  function selectFlight(index, announce) {
    const marker = markers[index]; if (!marker) return; selectedIndex = index;
    const COLOR_DEFAULT = 0x3b82f6, COLOR_SELECTED = 0xf59e0b;
    markers.forEach(m => m.material.color.setHex(COLOR_DEFAULT)); marker.material.color.setHex(COLOR_SELECTED);
    const lbl = labels.get(marker.uuid); if (lbl) lbl.visible = true; controls.target.copy(marker.position); camera.lookAt(marker.position);
    refreshListSelection(); updateHUD(); if (announce) { const f = currentFlights[index]; if (f) { const msg = `フライト ${f.callsign || f.id}、高度 ${Math.round((f.alt||0)/100)}百フィート、方位 ${Math.round(f.heading||0)}。`; speak(msg); } }
  }

  function updateHUD() {
    const hud = document.getElementById('hud'); if (!hud) return; const f = currentFlights[selectedIndex]; if (!f) { hud.style.display = 'none'; return; }
    const enu = geodeticToENU(f.lat, f.lon, (f.alt||0), origin); const dist = Math.sqrt(enu.e*enu.e + enu.n*enu.n) / 1000; const bearing = Math.atan2(enu.e, enu.n) * 180 / Math.PI; const altm = Math.round(f.alt || 0); const spdkt = Math.round((f.speed || 0) * 1.94384);
    hud.innerHTML = `選択: <b>${(f.callsign || f.id || 'FLIGHT').trim()}</b> | 距離 ${dist.toFixed(1)} km | 方位 ${Math.round((bearing+360)%360)}° | 高度 ${altm} m | 速度 ${spdkt} kt`;
    hud.style.display = 'block';
  }

  function highlightByGaze() {
    if (!markers.length) return null;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
    let best = null, bestCost = 1e9, bestAng = 180;
    for (const m of markers) {
      const to = m.position.clone().sub(camPos); const dist = to.length();
      const v = to.clone().normalize();
      const d = THREE.MathUtils.clamp(forward.dot(v), -1, 1);
      const ang = THREE.MathUtils.radToDeg(Math.acos(d)); // 0..180
      const distNorm = Math.min(50, dist); // clamp
      const cost = ang + 0.3 * distNorm; // weight distance lightly
      if (cost < bestCost) { bestCost = cost; best = m; bestAng = ang; }
    }
    const COLOR_DEFAULT = 0x3b82f6, COLOR_SELECTED = 0xf59e0b; const glow = 0xfbbf24;
    const selected = selectedIndex >= 0 ? markers[selectedIndex] : null;
    markers.forEach(m => {
      if (m === selected) m.material.color.setHex(COLOR_SELECTED);
      else if (m === best && bestAng < 18) m.material.color.setHex(glow);
      else m.material.color.setHex(COLOR_DEFAULT);
      const lbl = labels.get(m.uuid); if (lbl) { lbl.visible = (m === selected) || (m === best && bestAng < 22); lbl.lookAt(camera.position); }
    });
    return bestAng < 20 ? best : null;
  }

  async function speak(text) {
    try {
      const r = await fetch(`${TTS_API}/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'ja-JP' })
      });
      if (r.ok) {
        const ct = (r.headers.get('Content-Type') || '').toLowerCase();
        if (ct.includes('audio')) {
          const buf = await r.arrayBuffer();
          const blob = new Blob([buf], { type: ct.includes('mpeg') ? 'audio/mpeg' : 'audio/ogg' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play().catch(() => {});
          return;
        }
      }
    } catch (e) {
      // fall through to Web Speech
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      try { speechSynthesis.speak(u); } catch {}
    }
  }
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } }

  // Override: richer chat with persona/history and voice
  function logChat(text, cls) { const log = document.getElementById('chatLog'); if (!log) return; const line = document.createElement('div'); if (cls) line.className = cls; line.textContent = text; log.appendChild(line); log.scrollTop = log.scrollHeight; }
  async function chatSend(text) {
    const body = { input: text };
    if (systemPrompt) body.system = systemPrompt;
    if (chatHistory.length) body.history = chatHistory.slice(-10);
    const useFlight = document.getElementById('ctxFlight')?.checked;
    if (useFlight && selectedIndex >= 0 && currentFlights[selectedIndex]) body.flight = currentFlights[selectedIndex];
    try { const r = await fetch(`${CHAT_API}/chat2`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('chat http ' + r.status); const j = await r.json(); return j.text; } catch (e) { console.warn('chat failed', e); return '（通信に失敗しました）'; }
  }
  function typeOut(text) { const log = document.getElementById('chatLog'); if (!log) return; const line = document.createElement('div'); log.appendChild(line); let i = 0; typewriterRunning = true; const AC = window.AudioContext || window.webkitAudioContext; const ctx = AC ? new AC() : null; let last = 0; if (document.getElementById('voiceOut')?.checked) speak(text.slice(0, 300)); const step = () => { if (!typewriterRunning) { line.textContent = text; return; } line.textContent = text.slice(0, i++); log.scrollTop = log.scrollHeight; if (ctx && i - last > 3) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type='square'; o.frequency.value=880; g.gain.value=0.02; o.connect(g).connect(ctx.destination); o.start(); setTimeout(()=>{o.stop(); o.disconnect(); g.disconnect();}, 40); last = i; } if (i <= text.length) requestAnimationFrame(step); else typewriterRunning = false; }; requestAnimationFrame(step); }

  function logChat(text) { const log = document.getElementById('chatLog'); if (!log) return; const line = document.createElement('div'); line.textContent = text; log.appendChild(line); log.scrollTop = log.scrollHeight; }
  async function chatSend(text) { try { const r = await fetch(`${CHAT_API}/chat2`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }) }); if (!r.ok) throw new Error('chat http ' + r.status); const j = await r.json(); return j.text; } catch { return '（通信に失敗しました）'; } }
  function typeOut(text) { const log = document.getElementById('chatLog'); if (!log) return; const line = document.createElement('div'); log.appendChild(line); let i = 0; const AC = window.AudioContext || window.webkitAudioContext; const ctx = AC ? new AC() : null; let last = 0; const t = setInterval(() => { line.textContent = text.slice(0, i++); log.scrollTop = log.scrollHeight; if (ctx && i - last > 3) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type='square'; o.frequency.value=880; g.gain.value=0.02; o.connect(g).connect(ctx.destination); o.start(); setTimeout(()=>{o.stop(); o.disconnect(); g.disconnect();}, 40); last = i; } if (i > text.length) clearInterval(t); }, 15); }

  // UI wiring
  const speakBtn = document.getElementById('speakBtn'); if (speakBtn) speakBtn.addEventListener('click', async () => { const flights = currentFlights.length ? currentFlights : await fetchFlights(); if (!flights.length) return speak('フライト情報が取得できませんでした。'); const f = flights[0]; const msg = `フライト ${f.callsign || f.id}、高度 ${Math.round((f.alt||0)/100)}百フィート、方位 ${f.heading||0} です。`; speak(msg); });
  const setBtn = document.getElementById('setCenter'); if (setBtn) setBtn.addEventListener('click', async () => { const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon'); const lat = parseFloat(latEl.value || latEl.placeholder); const lon = parseFloat(lonEl.value || lonEl.placeholder); if (Number.isFinite(lat) && Number.isFinite(lon)) { origin.lat = lat; origin.lon = lon; await refreshMarkers(); speak(`中心を緯度${lat.toFixed(3)}、経度${lon.toFixed(3)}に設定しました。`); } });
  const myLocBtn = document.getElementById('myLoc'); if (myLocBtn && navigator.geolocation) myLocBtn.addEventListener('click', () => { navigator.geolocation.getCurrentPosition(async (pos) => { origin.lat = pos.coords.latitude; origin.lon = pos.coords.longitude; await refreshMarkers(); speak('現在地を中心に設定しました。'); const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon'); if (latEl) latEl.value = origin.lat.toFixed(4); if (lonEl) lonEl.value = origin.lon.toFixed(4); }); });
  const fetchBtn = document.getElementById('fetchNow'); if (fetchBtn) fetchBtn.addEventListener('click', () => refreshMarkers());
  const toggleBtn = document.getElementById('toggleFlights'); if (toggleBtn) toggleBtn.addEventListener('click', () => { showFlights = !showFlights; setMarkersVisible(showFlights); });
  const clearSelBtn = document.getElementById('clearSel'); if (clearSelBtn) clearSelBtn.addEventListener('click', clearSelection);
  const personaSel = document.getElementById('persona'); if (personaSel) { const setPersona = () => { const p = personaSel.value; systemPrompt = buildSystemPrompt(p); }; personaSel.addEventListener('change', setPersona); setPersona(); }
  const sendBtn = document.getElementById('sendPrompt'); if (sendBtn) sendBtn.addEventListener('click', async () => { const ta = document.getElementById('prompt'); const content = (ta && ta.value.trim()) || ''; if (!content) return; ta.value=''; chatHistory.push({ role: 'user', text: content }); logChat('> ' + content, 'user'); const text = await chatSend(content) || '（応答なし）'; chatHistory.push({ role: 'assistant', text }); typeOut(text); });
  const clearChatBtn = document.getElementById('clearChat'); if (clearChatBtn) clearChatBtn.addEventListener('click', () => { const log = document.getElementById('chatLog'); if (log) log.innerHTML = ''; chatHistory = []; });
  const skipBtn = document.getElementById('skipAnim'); if (skipBtn) skipBtn.addEventListener('click', () => { typewriterRunning = false; });
  const promptTa = document.getElementById('prompt'); if (promptTa) { promptTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } }); }

  // Deselect on background click
  const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  function clearSelection() { selectedIndex = -1; markers.forEach(m => m.material.color.setHex(0x3b82f6)); const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none'; refreshListSelection(); labels.forEach(sp => sp.visible = false); }
  renderer.domElement.addEventListener('pointerdown', (ev) => { const rect = renderer.domElement.getBoundingClientRect(); mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(mouse, camera); const hits = raycaster.intersectObjects(markers, false); if (hits && hits.length) { const idx = markers.indexOf(hits[0].object); if (idx >= 0) selectFlight(idx, true); } else clearSelection(); });

  // WebXR (AR)
  if (navigator.xr) {
    renderer.xr.enabled = true;
    const button = ARButton.createButton(renderer, { requiredFeatures: [], optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'hand-tracking'] });
    document.body.appendChild(button);
    renderer.xr.addEventListener('sessionstart', async () => {
      isAR = true; grid.visible = false; setTip(true);
      setGuide('床の平面で緑のレチクルが見えたら Select/タップで原点を設置できます', true, 4000);
      try { origin = await new Promise((resolve) => { if (!navigator.geolocation) return resolve(origin); navigator.geolocation.getCurrentPosition((pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude || 0 }), () => resolve(origin), { enableHighAccuracy: true, timeout: 3000 }); }); } catch {}
      xrSession = renderer.xr.getSession();
      try { refSpace = await xrSession.requestReferenceSpace('local'); viewerSpace = await xrSession.requestReferenceSpace('viewer'); hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace }); } catch { hitTestSource = null; }
      xrSession.addEventListener('inputsourceschange', () => {
        // reset pinch states when controllers/hands change
        pinchState.clear();
      });
      await refreshMarkers();
    });
    renderer.xr.addEventListener('sessionend', () => { isAR = false; grid.visible = true; setTip(false); setGuide('', false); hitTestSource = null; refSpace = null; viewerSpace = null; xrSession = null; reticle.visible = false; refreshMarkers(); });
    renderer.xr.addEventListener('sessionstart', () => { const s = renderer.xr.getSession(); s.addEventListener('select', async () => { if (reticle.visible) { if (lastHitResult && typeof lastHitResult.createAnchor === 'function') {
            try { worldAnchor = await lastHitResult.createAnchor(); } catch {}
          }
          world.position.copy(reticle.position); setTip(false); speak('原点を配置しました。');
        } else { const m = highlightByGaze(); if (!m) return; const idx = markers.indexOf(m); if (idx >= 0) { selectFlight(idx, true); setGuide('視線方向の機体を選択しました', true, 2000); } } }); });
  }

  // Resize
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

  // Initial
  // SSE stream for smooth updates (desktop by default)
  let sse = null; let sseEnabled = true;
  function openSSE() {
    try {
      if (!window.EventSource) { sseEnabled = false; return; }
      if (sse) { sse.close(); sse = null; }
      const rEl = document.getElementById('radius');
      const radius = Math.max(1, parseFloat((rEl && (rEl.value || rEl.placeholder)) || '30'));
      const url = `${FLIGHT_PROXY}/flights/stream?lat=${encodeURIComponent(origin.lat)}&lon=${encodeURIComponent(origin.lon)}&radius=${radius}&interval=3000`;
      sse = new EventSource(url);
      sse.onmessage = (ev) => {
        try { const data = JSON.parse(ev.data); updateStatus(data.source || 'unknown', (data.flights||[]).length); renderFlights(data.flights || []); } catch {}
      };
      sse.onerror = () => { /* keep trying; fallback to polling if closed */ };
    } catch { sseEnabled = false; }
  }

  await refreshMarkers(); if (!isAR) { openSSE(); setInterval(() => { if (!isAR && !sseEnabled) refreshMarkers(); }, 10000); }

  // Render loop
  renderer.setAnimationLoop((t, frame) => {
    controls.update();
    // AR reticle update via hit-test
    if (isAR && frame && hitTestSource && refSpace) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results && results.length) { lastHitResult = results[0]; const pose = lastHitResult.getPose(refSpace); if (pose) { reticle.visible = true; reticle.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z); const o = pose.transform.orientation; reticle.quaternion.set(o.x, o.y, o.z, o.w); } }
      else { reticle.visible = false; }
    }
    // Anchor follow (reduce drift)
    if (isAR && frame && worldAnchor && refSpace) {
      try { const pose = frame.getPose(worldAnchor.anchorSpace, refSpace); if (pose) { world.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z); } } catch {}
    }
    // Plane detection (visualize and pick largest plane for chat UI panel)
    if (isAR && frame && frame.worldInformation && frame.worldInformation.detectedPlanes && refSpace) {
      let largest = { area: 0, id: null, pose: null };
      for (const plane of frame.worldInformation.detectedPlanes) {
        let mesh = planeMeshes.get(plane);
        const pose = frame.getPose(plane.planeSpace, refSpace);
        if (!pose) continue;
        // approximate radius from polygon extents
        let r = 0.3; try { if (plane.polygon && plane.polygon.length) { for (const p of plane.polygon) { const d = Math.hypot(p.x, p.z); if (d > r) r = d; } } } catch {}
        if (!mesh) {
          mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x22c55e, opacity: 0.12, transparent: true }));
          mesh.rotation.x = -Math.PI / 2; planeMeshes.set(plane, mesh); scene.add(mesh);
        } else {
          // resize if plane grew
          if (mesh.geometry.parameters.radius < r) mesh.geometry = new THREE.CircleGeometry(r, 32);
        }
        mesh.position.set(pose.transform.position.x, pose.transform.position.y + 0.001, pose.transform.position.z);
        const area = Math.PI * r * r;
        if (area > largest.area) largest = { area, id: plane, pose };
      }
      if (largest.area > 0) {
        if (!chatPanel) { chatPanel = new ChatPanel(); scene.add(chatPanel.mesh); }
        largestPlaneId = largest.id;
        chatPanel.mesh.position.set(largest.pose.transform.position.x, largest.pose.transform.position.y + 0.01, largest.pose.transform.position.z);
        chatPanel.mesh.lookAt(camera.position);
        // redraw if new messages arrived
        const persona = document.getElementById('persona')?.value || '';
        const flight = (selectedIndex >= 0) ? currentFlights[selectedIndex] : null;
        if (chatPanel.lastDrawnCount !== chatHistory.length) chatPanel.draw(chatHistory, persona, flight);
      }
    }
    // Hand tracking pinch to select/place
    if (isAR && frame && xrSession && xrSession.inputSources) {
      for (const src of xrSession.inputSources) {
        if (!src.hand) continue;
        try {
          const iTip = src.hand.get('index-finger-tip');
          const tTip = src.hand.get('thumb-tip');
          const p1 = frame.getJointPose(iTip, refSpace); const p2 = frame.getJointPose(tTip, refSpace);
          if (p1 && p2) {
            const dist = Math.hypot(p1.transform.position.x - p2.transform.position.x, p1.transform.position.y - p2.transform.position.y, p1.transform.position.z - p2.transform.position.z);
            const prev = pinchState.get(src) || false; const now = dist < 0.02; // ~2cm
            if (!prev && now) {
              // pinch start
              if (reticle.visible) { world.position.copy(reticle.position); setTip(false); }
              else { const m = highlightByGaze(); if (m) { const idx = markers.indexOf(m); if (idx>=0) selectFlight(idx, true); } }
            }
            pinchState.set(src, now);
          }
        } catch {}
      }
    }
    const bestNow = highlightByGaze();
    if (observeMode) {
      if (bestNow && (!gazeCandidate || bestNow !== gazeCandidate)) { gazeCandidate = bestNow; gazeStreak = 1; }
      else if (bestNow && bestNow === gazeCandidate) { gazeStreak++; }
      else { gazeCandidate = null; gazeStreak = 0; }
      if (gazeCandidate && gazeStreak >= GAZE_FRAMES) {
        const now = performance.now();
        if (now - lastObserveAt > OBS_COOLDOWN) {
          const idx = markers.indexOf(gazeCandidate);
          if (idx >= 0 && idx !== selectedIndex) { selectFlight(idx, false); lastObserveAt = now; }
        }
        gazeCandidate = null; gazeStreak = 0;
      }
    }
    renderer.render(scene, camera);
  });

  // Reopen SSE on center/radius changes (desktop)
  const _sc = document.getElementById('setCenter'); if (_sc) _sc.addEventListener('click', () => { if (!isAR) openSSE(); });
  const _ml = document.getElementById('myLoc'); if (_ml && navigator.geolocation) _ml.addEventListener('click', () => { if (!isAR) setTimeout(openSSE, 50); });
  const _ra = document.getElementById('radius'); if (_ra) _ra.addEventListener('change', () => { if (!isAR) openSSE(); });

  // Preset / Observe / Geolocate helpers
  const presetSel = document.getElementById('presetSel');
  const presetBtn = document.getElementById('jumpPreset'); if (presetBtn) presetBtn.addEventListener('click', async () => {
    const key = presetSel && presetSel.value; if (key && PRESETS[key]) { const p = PRESETS[key]; await setOrigin(p.lat, p.lon); speak(`${key} に移動しました。`); if (!isAR) openSSE(); }
  });
  const observeBtn = document.getElementById('observeToggle'); if (observeBtn) observeBtn.addEventListener('click', () => { observeMode = !observeMode; observeBtn.textContent = observeMode ? '観察ON' : '観察モード'; });
  const myLocBtn2 = document.getElementById('myLoc'); if (myLocBtn2 && navigator.geolocation) myLocBtn2.addEventListener('click', () => { navigator.geolocation.getCurrentPosition(async (pos) => { await setOrigin(pos.coords.latitude, pos.coords.longitude); speak('現在地を中心に設定しました。'); if (!isAR) openSSE(); }); });

  // Local command handler and chat override (placed late to override earlier defs)
  function tryHandleLocalCommand(input) {
    const s = String(input || '').trim();
    if (!s) return false;
    // center lat,lon
    let m = s.match(/^(?:中心|center)[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*[,、\s]\s*([+-]?\d+(?:\.\d+)?)/i);
    if (m) { const lat = parseFloat(m[1]), lon = parseFloat(m[2]); if (Number.isFinite(lat) && Number.isFinite(lon)) { setOrigin(lat, lon); speak(`中心を 緯度${lat.toFixed(3)} 経度${lon.toFixed(3)} に設定しました。`); return true; } }
    // radius absolute
    m = s.match(/^(?:半径|radius)[:：]?\s*(\d+(?:\.\d+)?)/i);
    if (m) { const rEl = document.getElementById('radius'); if (rEl) { rEl.value = m[1]; } refreshMarkers(); speak(`半径を ${m[1]} キロに設定しました。`); return true; }
    // radius relative: +10 / -10
    m = s.match(/^(?:半径|radius)\s*([+-])\s*(\d+(?:\.\d+)?)/i);
    if (m) { const sign = m[1] === '-' ? -1 : 1; const val = parseFloat(m[2]); const rEl = document.getElementById('radius'); const cur = Math.max(1, parseFloat(rEl?.value || rEl?.placeholder || '30') || 30); const next = Math.max(1, cur + sign * val); if (rEl) rEl.value = String(next); refreshMarkers(); speak(`半径を ${next} キロに設定しました。`); return true; }
    // current location
    if (/^(?:現在地|my(?:\s*)loc|here)$/i.test(s)) { if (navigator.geolocation) { navigator.geolocation.getCurrentPosition(async (pos) => { await setOrigin(pos.coords.latitude, pos.coords.longitude); speak('現在地を中心に設定しました。'); }); } return true; }
    // preset place name
    const presetMap = { '羽田': 'HND', '成田': 'NRT', '関空': 'KIX', '伊丹': 'ITM', '中部': 'NGO', '福岡': 'FUK', '那覇': 'OKA' };
    const key = Object.keys(presetMap).find(k => s.includes(k)) || Object.keys(PRESETS).find(k => new RegExp(`\\b${k}\\b`, 'i').test(s));
    if (key) { const code = presetMap[key] || key; const p = PRESETS[code]; if (p) { setOrigin(p.lat, p.lon); speak(`${code} 付近へ移動しました。`); return true; } }
    // select by index (#N)
    m = s.match(/^#?(\d{1,2})$/);
    if (m) { const idx = parseInt(m[1], 10) - 1; if (currentFlights[idx]) { selectFlight(idx, true); return true; } }
    // observe on/off
    m = s.match(/^(?:観察|observe)\s*(on|off|オン|オフ)?$/i);
    if (m) { const v = m[1]; if (!v) observeMode = !observeMode; else observeMode = /on|オン/i.test(v); speak(`観察モードを${observeMode?'オン':'オフ'}にしました。`); return true; }
    return false;
  }

  async function chatSend(text) {
    // Intercept local commands
    if (tryHandleLocalCommand(text)) {
      return 'ローカル操作を実行しました。';
    }
    const body = { input: text };
    if (systemPrompt) body.system = systemPrompt;
    if (chatHistory.length) body.history = chatHistory.slice(-10);
    const useFlight = document.getElementById('ctxFlight')?.checked;
    if (useFlight && selectedIndex >= 0 && currentFlights[selectedIndex]) {
      const f = currentFlights[selectedIndex];
      body.flight = f;
      try {
        const enu = geodeticToENU(f.lat, f.lon, (f.alt||0), origin);
        const distKm = Math.sqrt(enu.e*enu.e + enu.n*enu.n) / 1000;
        const bearing = Math.atan2(enu.e, enu.n) * 180 / Math.PI; // 0=N
        body.flight_context = {
          distance_km: Number(distKm.toFixed(2)),
          bearing_deg: Math.round((bearing + 360) % 360),
          altitude_m: Math.round(f.alt || 0),
          speed_kt: Math.round((f.speed || 0) * 1.94384),
          origin: { lat: origin.lat, lon: origin.lon }
        };
      } catch {}
    }
    try {
      const r = await fetch(`${CHAT_API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('chat http ' + r.status);
      const j = await r.json();
      return j.text;
    } catch (e) {
      console.warn('chat failed', e);
      return '（通信に失敗しました）';
    }
  }
}

main().catch(console.error);
