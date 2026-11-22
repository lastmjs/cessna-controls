// Simulator mode: flies the airplane with the flight model, handles cameras, controls
// (keyboard, gamepad, touch), the systems panel, walking around, fueling and saving.
import * as THREE from 'three';
import { createFDM, toThree, KT, FT } from './fdm.js';
import { FIELD, SPAWN, RWY, PUMP, VOR, HANGAR } from './world.js';
import { buildPerson } from './person.js';
import { createAudio } from './audio.js';
import { BY_ID } from './components.js';

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SAVE = 'cessna-controls:sim:v1';
const FUEL_PRICE = 6.89; // USD per gallon of 100LL
const PUMP_GPM = 10;
const isTouch = matchMedia('(pointer: coarse)').matches;

const CHECKLIST = [
  { en: 'Before start', es: 'Antes del arranque', items: [
    ['Walk-around inspection done', 'Inspección exterior hecha', null],
    ['Chocks removed', 'Calzos quitados', (c) => !c.chocks],
    ['Fuel quantity checked', 'Cantidad de combustible revisada', (c) => c.f.fuelL + c.f.fuelR > 10],
    ['Fuel selector BOTH', 'Selector de combustible AMBOS', (c) => c.s.fuelSel % 360 === 0],
    ['Parking brake set', 'Freno de estacionamiento puesto', (c) => c.s.parkPull > 0.5],
  ] },
  { en: 'Engine start', es: 'Arranque del motor', items: [
    ['Mixture RICH', 'Mezcla RICA', (c) => c.s.mixture < 0.1],
    ['Carb heat COLD', 'Calefacción del carburador FRÍA', (c) => c.s.carbheat < 0.5],
    ['Prime 2–3 strokes (cold engine)', 'Cebar 2–3 veces (motor frío)', (c) => c.f.primed >= 1 || c.f.running],
    ['Throttle open ¼ inch', 'Acelerador abierto ¼ de pulgada', (c) => c.s.throttle > 0.05 && c.s.throttle < 0.25],
    ['Master switch ON', 'Interruptor maestro ENCENDIDO', (c) => c.s.bat > 0.5 && c.s.alt > 0.5],
    ['Beacon ON', 'Baliza ENCENDIDA', (c) => c.s.sw_beacon > 0.5],
    ['"Prop clear!" — ignition START', '"¡Hélice libre!" — encendido START', (c) => c.f.running],
    ['Oil pressure rising in 30 s', 'Presión de aceite subiendo en 30 s', (c) => c.f.oilP > 0.3],
    ['Avionics ON', 'Aviónica ENCENDIDA', (c) => c.s.avionics > 0.5],
  ] },
  { en: 'Run-up (1800 RPM)', es: 'Prueba de motor (1800 RPM)', items: [
    ['Magnetos: drop ≤125 RPM, difference ≤50', 'Magnetos: caída ≤125 RPM, diferencia ≤50', null],
    ['Carb heat: small RPM drop', 'Calefacción del carburador: pequeña caída', null],
    ['Suction and ammeter in the green', 'Succión y amperímetro en verde', (c) => c.f.suction > 4.4 && c.f.ampsNet >= -1],
    ['Flight controls free and correct', 'Controles libres y correctos', null],
    ['Trim set for takeoff', 'Compensador en DESPEGUE', (c) => Math.abs(c.s.trim - 0.2) < 0.1],
  ] },
  { en: 'Takeoff', es: 'Despegue', items: [
    ['Flaps 0°–10°', 'Flaps 0°–10°', (c) => c.f.flaps <= 10.5],
    ['Lights and transponder ON', 'Luces y transpondedor ENCENDIDOS', (c) => c.s.sw_land > 0.5 && c.s.sw_strobe > 0.5],
    ['Parking brake released', 'Freno de estacionamiento quitado', (c) => c.s.parkPull < 0.5],
    ['Full throttle, mixture RICH', 'Potencia máxima, mezcla RICA', null],
    ['Rotate at 55 KIAS, climb at 74 KIAS', 'Rotar a 55 KIAS, subir a 74 KIAS', null],
  ] },
  { en: 'Before landing', es: 'Antes de aterrizar', items: [
    ['Mixture RICH, carb heat ON', 'Mezcla RICA, calefacción del carburador ON', (c) => c.s.mixture < 0.1 && c.s.carbheat > 0.5],
    ['Flaps as needed below 85 KIAS', 'Flaps según necesidad bajo 85 KIAS', null],
    ['Final approach 60–70 KIAS', 'Aproximación final 60–70 KIAS', null],
  ] },
  { en: 'Shutdown', es: 'Apagado', items: [
    ['Avionics OFF', 'Aviónica APAGADA', (c) => c.s.avionics < 0.5],
    ['Mixture IDLE CUT-OFF', 'Mezcla CORTE EN RALENTÍ', (c) => c.s.mixture > 0.9],
    ['Ignition OFF, key out', 'Encendido OFF', (c) => Math.round(c.s.key) === 0],
    ['Master OFF', 'Maestro APAGADO', (c) => c.s.bat < 0.5],
    ['Chocks in, fuel up for the next flight', 'Calzos puestos, cargar combustible', (c) => c.chocks],
  ] },
];

export function createSimMode(o) {
  const { renderer, scene, camera, world, aircraft, cockpit, exterior, sim, WORLD_Y, pick, sun, controls: orbitControls } = o;
  const S = sim.state;
  const fdm = createFDM();
  const F = fdm.st;
  const audio = createAudio();
  const person = buildPerson();
  person.root.visible = false;
  world.group.add(person.root);

  let active = false, paused = false, started = false;
  let view = 'walk';          // cockpit | chase | orbit | walk
  let onFoot = true;
  let chocks = true;
  let primerQueue = 0;
  let fueledGal = 0;
  const walker = { x: SPAWN.x, z: SPAWN.z + 4, heading: 0, speed: 0, reach: 0 };
  const look = { yaw: 0, pitch: -0.14, fov: 62 };
  const ext = { yaw: 0.5, pitch: 0.16, dist: 13 };
  const walkCam = { yaw: 0.8, pitch: 0.25, dist: 4.2 };
  const touchYoke = { active: false, x: 0, y: 0 };
  const touchRudder = { active: false, x: 0 };
  const walkPad = { active: false, x: 0, y: 0 };
  const keys = new Set();
  const kb = { pitch: 0, roll: 0, rudder: 0 };
  let brakeHeld = false;
  const settings = Object.assign({ wind: 'light', hud: true, assist: isTouch, sound: true, touchUI: isTouch, quality: isTouch ? 'low' : 'high' }, loadJSON('cessna-controls:sim:settings') || {});
  const windState = { dir: 320, kt: 6, gust: [0, 0, 0], gustT: 0 };
  let crashShown = false;
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();

  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  const saveSettings = () => saveJSON('cessna-controls:sim:settings', settings);

  // ------------------------------------------------------------ coordinate helpers
  const worldOf = (ned) => new THREE.Vector3(ned[1], -ned[2], -ned[0]);         // NED -> world (MSL)
  const env = {
    groundAt: (n, e) => world.groundAt(e, -n),
    wind: [0, 0, 0], gust: [0, 0, 0],
    collide: (pts) => world.collide(pts.map(p => [p[1], -p[2], -p[0]])),
  };
  const localToMSL = (x, y, z) => { const v = aircraft.localToWorld(new THREE.Vector3(x, y, z)); v.y -= WORLD_Y; return v; };

  // ------------------------------------------------------------ UI
  const ui = document.createElement('div');
  ui.id = 'sim-ui';
  ui.innerHTML = `
    <div id="sim-hud"></div>
    <div id="sim-msg" hidden></div>
    <div id="sim-prompt" hidden><button id="sim-prompt-btn"></button></div>
    <div id="sim-buttons">
      <button data-a="view" title="Camera (C)">🎥<span>View · Vista</span></button>
      <button data-a="systems" title="Systems (Y)">⚙<span>Systems · Sistemas</span></button>
      <button data-a="door" id="sim-door">🚪<span>Get out · Bajar</span></button>
      <button data-a="pause" title="Pause (P)">⏸<span>Pause · Pausa</span></button>
      <button data-a="menu">☰<span>Menu · Menú</span></button>
    </div>
    <div id="sim-touch">
      <div id="sim-throttle-wrap"><span>THR</span><input id="sim-throttle" type="range" min="0" max="100" value="0" orient="vertical"><span id="sim-thr-val">0%</span></div>
      <div id="sim-yoke"><div class="knob"></div><span class="lbl">YOKE · VOLANTE</span></div>
      <div id="sim-rudder"><div class="knob"></div><span class="lbl">RUDDER · TIMÓN</span></div>
      <div id="sim-tb">
        <button data-hold="brake">BRAKE<br>FRENO</button>
        <button data-a="flapDn">FLAPS ▼</button><button data-a="flapUp">FLAPS ▲</button>
        <button data-hold="trimUp">TRIM ▲<small>nose up</small></button><button data-hold="trimDn">TRIM ▼<small>nose dn</small></button>
      </div>
    </div>
    <div id="sim-walkpad"><div class="knob"></div></div>
    <div id="sim-systems" hidden></div>
    <div id="sim-overlay" hidden></div>`;
  ui.hidden = true;
  document.body.appendChild(ui);
  const $ = (q) => ui.querySelector(q);
  const hud = $('#sim-hud'), msgEl = $('#sim-msg'), prompt = $('#sim-prompt'), promptBtn = $('#sim-prompt-btn');
  const sysEl = $('#sim-systems'), overlay = $('#sim-overlay');
  let msgTimer = null;
  function toast(en, es, ms = 3500) {
    msgEl.innerHTML = `<b>${en}</b>${es ? `<span>${es}</span>` : ''}`;
    msgEl.hidden = false;
    clearTimeout(msgTimer); msgTimer = setTimeout(() => { msgEl.hidden = true; }, ms);
  }

  // Buttons
  ui.querySelector('#sim-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    audio.start();
    const a = b.dataset.a;
    if (a === 'view') cycleView();
    if (a === 'systems') { sysEl.hidden = !sysEl.hidden; if (!sysEl.hidden) renderSystems(); }
    if (a === 'door') onFoot ? tryBoard() : tryGetOut();
    if (a === 'pause') setPaused(!paused);
    if (a === 'menu') showMenu();
  });
  const holds = {};
  ui.querySelectorAll('[data-hold]').forEach(b => {
    const k = b.dataset.hold;
    const on = (e) => { e.preventDefault(); holds[k] = true; audio.start(); b.classList.add('on'); };
    const off = () => { holds[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  });
  $('#sim-tb').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    if (b.dataset.a === 'flapDn') flapStep(1); else flapStep(-1);
  });
  const thr = $('#sim-throttle');
  thr.addEventListener('input', () => { S.throttle = thr.value / 100; });
  // Virtual sticks
  function pad(el, state, opts) {
    const knob = el.querySelector('.knob');
    let id = null;
    const setFrom = (e) => {
      const r = el.getBoundingClientRect();
      state.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      state.y = opts.horizontal ? 0 : clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      knob.style.transform = `translate(${state.x * r.width * 0.36}px, ${state.y * r.height * 0.36}px)`;
    };
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); state.active = true; audio.start(); setFrom(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) setFrom(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; state.active = false; state.x = 0; state.y = 0; knob.style.transform = ''; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  pad($('#sim-yoke'), touchYoke, {});
  pad($('#sim-rudder'), touchRudder, { horizontal: true });
  pad($('#sim-walkpad'), walkPad, {});

  // ------------------------------------------------------------ systems panel
  function renderSystems() {
    const sw = (key, label, on) => `<button class="sw ${on ? 'on' : ''}" data-sw="${key}">${label}</button>`;
    const seg = (key, opts, cur) => `<div class="seg2">${opts.map(([v, l]) => `<button data-seg="${key}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const fs = ((Math.round(S.fuelSel) % 360) + 360) % 360;
    const ctx = { s: S, f: F, chocks };
    sysEl.innerHTML = `
      <div class="sys-head"><b>Systems · Sistemas</b><button class="x" data-close>✕</button></div>
      <div class="sys-grid">
        <section><h4>Electrical · Eléctrico</h4>
          ${sw('bat', 'BAT', S.bat > 0.5)}${sw('alt', 'ALT', S.alt > 0.5)}${sw('avionics', 'AVIONICS', S.avionics > 0.5)}
          ${sw('sw_beacon', 'BEACON', S.sw_beacon > 0.5)}${sw('sw_nav', 'NAV', S.sw_nav > 0.5)}${sw('sw_strobe', 'STROBE', S.sw_strobe > 0.5)}
          ${sw('sw_taxi', 'TAXI', S.sw_taxi > 0.5)}${sw('sw_land', 'LAND', S.sw_land > 0.5)}${sw('sw_pitot', 'PITOT HT', S.sw_pitot > 0.5)}
          <p class="muted">Battery · Batería ${(F.battery * 100).toFixed(0)}% · ${F.ampsNet >= 0 ? '+' : ''}${F.ampsNet.toFixed(0)} A</p>
        </section>
        <section><h4>Engine · Motor</h4>
          <label>Ignition · Encendido</label>${seg('key', [[0, 'OFF'], [1, 'R'], [2, 'L'], [3, 'BOTH']], Math.min(3, Math.round(S.key)))}
          <button class="start" data-hold-start>START (hold · mantener)</button>
          <button class="sw" data-primer>PRIMER ×1 <small>(${F.primed.toFixed(0)})</small></button>
          ${sw('carbheat', 'CARB HEAT', S.carbheat > 0.5)}
          <label>Mixture · Mezcla <span class="muted">RICH ← → CUT-OFF</span></label>
          <input type="range" min="0" max="100" value="${Math.round(S.mixture * 100)}" data-range="mixture">
          <label>Throttle · Acelerador</label>
          <input type="range" min="0" max="100" value="${Math.round(S.throttle * 100)}" data-range="throttle">
          <p class="muted">${F.running ? 'Running · En marcha' : 'Stopped · Detenido'} · ${F.rpm.toFixed(0)} RPM · ${F.fuelFlowGph.toFixed(1)} GPH${F.flooded ? ' · FLOODED · AHOGADO' : ''}</p>
        </section>
        <section><h4>Fuel · Combustible</h4>
          ${seg('fuelSel', [[270, 'LEFT'], [0, 'BOTH'], [90, 'RIGHT'], [180, 'OFF']], fs)}
          <p>L ${F.fuelL.toFixed(1)} gal · R ${F.fuelR.toFixed(1)} gal <span class="muted">(26.5 max each)</span></p>
          <p class="muted">Weight · Peso ${(fdm.mass() * 2.20462).toFixed(0)} lb · Fuel bought · Comprado ${fueledGal.toFixed(1)} gal ($${(fueledGal * FUEL_PRICE).toFixed(2)})</p>
        </section>
        <section><h4>Flight · Vuelo</h4>
          ${sw('park', 'PARKING BRAKE', S.parkPull > 0.5)}
          <label>Flaps</label>${seg('flaps', [[0, '0°'], [1, '10°'], [2, '20°'], [3, '30°']], Math.round(S.flapCmd))}
          <label>Altimeter · Altímetro ${S.baro.toFixed(2)} inHg</label>
          <div class="seg2"><button data-baro="-1">−</button><button data-baro="0">29.92</button><button data-baro="1">+</button></div>
          <label>Wind · Viento</label>${seg('wind', [['calm', 'Calm'], ['light', 'Light'], ['gusty', 'Gusty']], settings.wind)}
          <label>Help · Ayuda</label>
          <label>Quality · Calidad</label>${seg('quality', [['low', 'Phone · Teléfono'], ['high', 'High · Alta']], settings.quality)}
          ${sw('assist', 'Auto-rudder assist', settings.assist)}${sw('hud', 'HUD', settings.hud)}${sw('sound', 'Sound · Sonido', settings.sound)}${sw('touchUI', 'Touch controls', settings.touchUI)}
        </section>
        <section class="wide"><h4>Checklist · Lista de chequeo</h4>
          ${CHECKLIST.map(g => `<details><summary>${g.en} · ${g.es}</summary><ul>${g.items.map(([en, es, fn]) => `<li class="${fn ? (fn(ctx) ? 'ok' : 'no') : ''}"><span>${en}</span><span class="es">${es}</span></li>`).join('')}</ul></details>`).join('')}
        </section>
      </div>`;
  }
  let sysTimer = 0;
  sysEl.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    audio.start(); audio.click();
    if (t.dataset.close !== undefined) { sysEl.hidden = true; return; }
    if (t.dataset.sw) {
      const k = t.dataset.sw;
      if (k === 'park') setParking(S.parkPull < 0.5);
      else if (['assist', 'hud', 'sound', 'touchUI'].includes(k)) { settings[k] = !settings[k]; saveSettings(); applySettings(); }
      else S[k] = S[k] > 0.5 ? 0 : 1;
    }
    if (t.dataset.seg) {
      const k = t.dataset.seg, v = t.dataset.v;
      if (k === 'key') S.key = Number(v);
      if (k === 'fuelSel') S.fuelSel = Number(v);
      if (k === 'flaps') S.flapCmd = Number(v);
      if (k === 'wind') { settings.wind = v; saveSettings(); setWind(); }
      if (k === 'quality') { settings.quality = v; saveSettings(); applySettings(); }
    }
    if (t.dataset.primer !== undefined) prime();
    if (t.dataset.baro !== undefined) { const d = Number(t.dataset.baro); S.baro = d === 0 ? 29.92 : clamp(Math.round((S.baro + d * 0.01) * 100) / 100, 28.5, 31); }
    renderSystems();
  });
  sysEl.addEventListener('input', (e) => { const r = e.target.closest('[data-range]'); if (r) S[r.dataset.range] = r.value / 100; });
  sysEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-hold-start]')) { audio.start(); holds.start = true; e.target.closest('button').classList.add('on'); }
  });
  const endStart = () => { if (holds.start) { holds.start = false; sysEl.querySelector('[data-hold-start]')?.classList.remove('on'); } };
  sysEl.addEventListener('pointerup', endStart); sysEl.addEventListener('pointerleave', endStart); sysEl.addEventListener('pointercancel', endStart);

  function prime() {
    if (F.running) { toast('The engine is already running', 'El motor ya está en marcha'); return; }
    primerQueue++;
    S.primerRot = 1; S.primer = 1;
    setTimeout(() => { S.primer = 0; }, 300); setTimeout(() => { S.primerRot = 0; }, 600);
  }
  function setParking(on) { S.parkPull = on ? 1 : 0; S.parkRot = on ? 1 : 0; }
  function flapStep(d) { S.flapCmd = clamp(Math.round(S.flapCmd) + d, 0, 3); audio.click(); }

  // ------------------------------------------------------------ menu, crash, start
  function showMenu(first = false) {
    setPaused(true);
    const saved = loadJSON(SAVE);
    overlay.hidden = false;
    overlay.innerHTML = `<div class="card">
      <h2>Flight simulator · Simulador de vuelo</h2>
      <p class="muted">Cessna 172 · 160 hp · Airport elevation 1520 ft · Runway 18/36, 5000 ft</p>
      <div class="starts">
        ${saved ? `<button data-start="continue">▶ Continue · Continuar<small>${saved.onFoot ? 'On foot' : 'In the airplane'} · fuel ${(saved.fuelL + saved.fuelR).toFixed(0)} gal</small></button>` : ''}
        <button data-start="hangar">🏠 Hangar, cold &amp; dark<small>Walk around, remove the chocks, fuel up, start the engine · Desde el hangar, avión apagado</small></button>
        <button data-start="runway">🛫 Runway 36, ready for takeoff<small>Engine running · Motor en marcha</small></button>
        <button data-start="final">🛬 3 mile final, runway 36<small>1000 ft, 70 knots, flaps 20 · Aproximación final</small></button>
      </div>
      ${first ? '' : '<button class="resume" data-start="resume">Resume · Reanudar</button>'}
      <button class="study" data-start="study">📘 Back to study mode · Volver al modo de estudio</button>
      <p class="keys muted">Keys: ↑↓ pitch · ←→ roll · Q/E rudder · +/− throttle · B brakes · Shift+B parking brake · F/V flaps · [ ] trim · M/N mixture · H carb heat · K magnetos, Shift+K start · C camera · Y systems · P pause · Enter get in/out · walking: WASD, Shift to run</p>
    </div>`;
    overlay.querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
      audio.start();
      const k = b.dataset.start;
      if (k === 'study') { o.onExit(); return; }
      overlay.hidden = true;
      if (k === 'resume') { setPaused(false); return; }
      if (k === 'continue') restore(saved); else startAt(k);
      setPaused(false);
    });
  }
  function showCrash(reason) {
    crashShown = true;
    overlay.hidden = false;
    const [en, es] = reason.split(' · ');
    overlay.innerHTML = `<div class="card crash"><h2>💥 ${en}</h2><p>${es || ''}</p>
      <p class="muted">Touchdown sink rate · Velocidad vertical: ${(F.touchVs / FT * 60).toFixed(0)} fpm · Speed ${(F.gs / KT).toFixed(0)} kt</p>
      <div class="starts"><button data-start="hangar">🏠 Hangar</button><button data-start="runway">🛫 Runway · Pista</button><button data-start="final">🛬 Final</button></div></div>`;
    overlay.querySelectorAll('[data-start]').forEach(b => b.onclick = () => { overlay.hidden = true; crashShown = false; startAt(b.dataset.start); setPaused(false); });
  }

  function coldAndDark() {
    Object.assign(S, { bat: 0, alt: 0, avionics: 0, key: 0, mixture: 1, throttle: 0, carbheat: 0, fuelSel: 0, flapCmd: 0, trim: 0.2,
      sw_beacon: 0, sw_land: 0, sw_taxi: 0, sw_nav: 0, sw_strobe: 0, sw_pitot: 0, yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0 });
    setParking(true);
    Object.assign(F, { running: false, rpm: 0, oilT: 0.12, oilP: 0, egt: 0.05, gyro: 0, flaps: 0, primed: 0, flooded: false, bowl: 0.08, crank: 0 });
  }
  function hot() {
    Object.assign(S, { bat: 1, alt: 1, avionics: 1, key: 3, mixture: 0, throttle: 0.08, carbheat: 0, fuelSel: 0, trim: 0.2,
      sw_beacon: 1, sw_land: 1, sw_taxi: 0, sw_nav: 1, sw_strobe: 1, sw_pitot: 0, yokeRoll: 0, yokePitch: 0, rudder: 0 });
    setParking(false);
    Object.assign(F, { running: true, rpm: 800, oilT: 0.5, oilP: 0.5, egt: 0.4, gyro: 1, battery: 0.95, bowl: 0.08, flooded: false });
  }
  function startAt(kind) {
    started = true; crashShown = false;
    F.crashed = null; F.events.length = 0; F.hiDrift = 0; S.hiOffset = 0; S.baro = 29.92;
    if (kind === 'hangar') {
      coldAndDark();
      F.fuelL = 9.5; F.fuelR = 10.5; F.battery = 0.9;
      fdm.placeOnGround(-SPAWN.z, SPAWN.x, FIELD + 0.05, SPAWN.heading);
      chocks = true; onFoot = true; view = 'walk';
      walker.x = SPAWN.x + 1.5; walker.z = SPAWN.z + 3.5; walker.heading = 200;
      walkCam.yaw = 2.6;
      toast('You are in the hangar. Walk around the airplane, remove the chocks and get in.', 'Está en el hangar. Inspeccione el avión, quite los calzos y súbase.', 7000);
    } else if (kind === 'runway') {
      hot(); F.fuelL = F.fuelR = 20; S.flapCmd = 0; F.flaps = 0;
      fdm.placeOnGround(-(RWY.z1 - 40), RWY.x, FIELD + 0.05, 0);
      chocks = false; onFoot = false; view = 'cockpit';
      S.parkPull = 0; S.sw_taxi = 1;
      toast('Runway 36. Full throttle, rotate at 55 knots.', 'Pista 36. Potencia máxima, rote a 55 nudos.', 6000);
    } else {
      hot(); F.fuelL = F.fuelR = 15; S.flapCmd = 2; F.flaps = 20; S.trim = -0.1; S.throttle = 0.35; S.carbheat = 1;
      const dist = 5600;
      fdm.placeOnGround(-(RWY.z1 + dist), RWY.x, FIELD + 0.05, 0);
      F.pos[2] = -(FIELD + 0.05 + dist * Math.tan(3 * D2R) + 1.2);
      const v = 70 * KT;
      F.vel = [v * Math.cos(3 * D2R), 0, v * Math.sin(3 * D2R)];
      F.q = [Math.cos(0.5 * 1.5 * D2R), 0, Math.sin(0.5 * 1.5 * D2R), 0]; // slight nose-up pitch
      F.rpm = 1640; F.airborneTime = 5;
      chocks = false; onFoot = false; view = 'cockpit';
      toast('3 miles out. Keep 65–70 knots, aim at the runway numbers.', 'A 3 millas. Mantenga 65–70 nudos, apunte a los números de la pista.', 6000);
    }
    look.yaw = 0; look.pitch = -0.14;
    if (kind === 'final') look.pitch = -0.08;
    setWind();
    fueledGal = 0;
  }
  function restore(sv) {
    started = true;
    Object.assign(S, sv.S || {});
    F.fuelL = sv.fuelL; F.fuelR = sv.fuelR; F.battery = sv.battery ?? 0.9; F.tach = sv.tach ?? F.tach; F.hobbs = sv.hobbs ?? F.hobbs;
    fdm.placeOnGround(sv.n, sv.e, FIELD + 0.05, sv.heading);
    const gh = world.groundAt(sv.e, -sv.n).h;
    fdm.placeOnGround(sv.n, sv.e, gh, sv.heading);
    Object.assign(F, { running: false, rpm: 0, oilT: 0.15, gyro: 0, flaps: (S.flapCmd || 0) * 10 });
    S.key = 0; S.mixture = 1;
    chocks = sv.chocks; onFoot = sv.onFoot; view = onFoot ? 'walk' : 'cockpit';
    if (sv.walker) Object.assign(walker, sv.walker);
    fueledGal = sv.fueledGal || 0;
    setWind();
  }
  // Save when parked (engine off, stopped)
  let saveT = 0;
  function maybeSave(dt) {
    saveT += dt;
    if (saveT < 3) return;
    saveT = 0;
    if (!started || F.crashed || F.running || F.gs > 0.2 || !F.onGround) return;
    const h = ((F.heading / D2R) + 360) % 360;
    saveJSON(SAVE, { n: F.pos[0], e: F.pos[1], heading: h, fuelL: F.fuelL, fuelR: F.fuelR, battery: F.battery, tach: F.tach, hobbs: F.hobbs,
      chocks, onFoot, walker: { x: walker.x, z: walker.z, heading: walker.heading }, fueledGal,
      S: { trim: S.trim, flapCmd: S.flapCmd, fuelSel: S.fuelSel, parkPull: S.parkPull, parkRot: S.parkRot, baro: S.baro, bat: 0, alt: 0, avionics: 0 } });
  }

  function setWind() {
    const w = { calm: [0, 0], light: [320, 6], gusty: [300, 14] }[settings.wind] || [320, 6];
    windState.dir = w[0]; windState.kt = w[1];
  }
  function setPaused(p) {
    paused = p;
    if (p) audio.suspend(); else if (settings.sound) audio.start();
  }

  // ------------------------------------------------------------ cockpit clicks in simulator mode
  const TAP = {
    master: () => { const on = S.bat > 0.5 && S.alt > 0.5 ? 0 : 1; S.bat = on; S.alt = on; },
    avmaster: () => { S.avionics = S.avionics > 0.5 ? 0 : 1; },
    ignition: () => { S.key = (Math.round(S.key) + 1) % 4; },
    mixture: () => { S.mixture = S.mixture > 0.5 ? 0 : 1; },
    carbheat: () => { S.carbheat = S.carbheat > 0.5 ? 0 : 1; },
    primer: prime,
    parkbrake: () => setParking(S.parkPull < 0.5),
    fuelsel: () => { S.fuelSel = (((Math.round(S.fuelSel) + 90) % 360) + 360) % 360; },
    flapswitch: () => { S.flapCmd = (Math.round(S.flapCmd) + 1) % 4; },
    cabinheat: () => { S.cabinheat = S.cabinheat > 0.5 ? 0 : 1; },
    cabinair: () => { S.cabinair = S.cabinair > 0.5 ? 0 : 1; },
    altstatic: () => { S.altstatic = S.altstatic > 0.5 ? 0 : 1; },
    alt_knob: () => { S.baro = 29.92; toast('Altimeter set to 29.92', 'Altímetro ajustado a 29.92'); },
    hi_knob: () => { S.hiOffset = -F.hiDrift / D2R; toast('Heading indicator set to the compass', 'Indicador de rumbo ajustado a la brújula'); },
    hdgbug_knob: () => { S.hdgBug = ((F.heading / D2R) + 360) % 360; },
    obs1: () => { S.obs1 = (S.obs1 + 10) % 360; }, obs2: () => { S.obs2 = (S.obs2 + 10) % 360; },
    dimmer: () => { S.dimmer = S.dimmer > 0.6 ? 0.1 : S.dimmer + 0.3; },
    navcom1: () => { S.swap1 = S.swap1 > 0.5 ? 0 : 1; }, navcom2: () => { S.swap2 = S.swap2 > 0.5 ? 0 : 1; },
    xpdr: () => { S.ident = 1; setTimeout(() => { S.ident = 0; }, 800); },
    glovebox: () => { S.glove = S.glove > 0.5 ? 0 : 1; },
    visor: () => { S.visor = S.visor > 0.5 ? 0 : 1; },
    throttle: () => toast('Use the throttle slider or + / − keys', 'Use el control deslizante o las teclas + / −'),
  };
  for (const id of ['sw_beacon', 'sw_land', 'sw_taxi', 'sw_nav', 'sw_strobe', 'sw_pitot']) TAP[id] = () => { S[id] = S[id] > 0.5 ? 0 : 1; };

  // ------------------------------------------------------------ pointer: look, zoom, tap
  const ptrs = new Map();
  let pinch0 = 0, tapStart = null, keyHoldTimer = null;
  const dom = renderer.domElement;
  function onDown(e) {
    if (!active) return;
    audio.start();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (view === 'cockpit') {
      const id = pick(e.clientX, e.clientY);
      if (id === 'ignition') keyHoldTimer = setTimeout(() => { holds.start = true; keyHoldTimer = 'held'; }, 450);
    }
  }
  function onMove(e) {
    if (!active || !ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) zoom(pinch0 / d);
      pinch0 = d; return;
    }
    const k = 0.005;
    if (view === 'cockpit') { look.yaw = clamp(look.yaw - dx * k, -2.6, 2.6); look.pitch = clamp(look.pitch - dy * k, -1.2, 1.1); }
    else if (view === 'walk') { walkCam.yaw -= dx * k; walkCam.pitch = clamp(walkCam.pitch + dy * k, -0.3, 1.3); }
    else { ext.yaw -= dx * k; ext.pitch = clamp(ext.pitch + dy * k, -0.4, 1.4); }
  }
  function onUp(e) {
    if (!active) return;
    ptrs.delete(e.pointerId);
    if (keyHoldTimer) { if (keyHoldTimer === 'held') holds.start = false; else clearTimeout(keyHoldTimer); const was = keyHoldTimer; keyHoldTimer = null; if (was === 'held') return; }
    if (!tapStart) return;
    const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
    if (moved < 8 && performance.now() - tapStart.t < 500 && view === 'cockpit') {
      const id = pick(e.clientX, e.clientY);
      if (id && TAP[id]) { TAP[id](); audio.click(); }
      if (id && BY_ID[id]) toast(BY_ID[id].en, BY_ID[id].es, 1800);
    }
    tapStart = null;
  }
  function zoom(f) {
    if (view === 'cockpit') look.fov = clamp(look.fov * f, 25, 80);
    else if (view === 'walk') walkCam.dist = clamp(walkCam.dist * f, 1.5, 12);
    else ext.dist = clamp(ext.dist * f, 6, 60);
  }
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', (e) => { if (!active) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

  // ------------------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    if (!active || e.target.matches('input, textarea')) return;
    audio.start();
    const k = e.key;
    keys.add(k.length === 1 ? k.toLowerCase() : k);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    const lk = k.toLowerCase();
    if (lk === 'c') cycleView();
    if (lk === 'p') setPaused(!paused);
    if (lk === 'y') { sysEl.hidden = !sysEl.hidden; if (!sysEl.hidden) renderSystems(); }
    if (k === 'Escape') { if (!sysEl.hidden) sysEl.hidden = true; else showMenu(); }
    if (k === 'Enter') onFoot ? (nearAction ? nearAction.fn() : tryBoard()) : tryGetOut();
    if (onFoot) { if (lk === 'e' && nearAction && !nearAction.hold) nearAction.fn(); return; }
    if (lk === 'b' && e.shiftKey) setParking(S.parkPull < 0.5);
    if (lk === 'f') flapStep(1);
    if (lk === 'v') flapStep(-1);
    if (lk === 'h') S.carbheat = S.carbheat > 0.5 ? 0 : 1;
    if (lk === 'k' && !e.shiftKey) S.key = (Math.round(S.key) + 1) % 4;
    if (lk === 'k' && e.shiftKey) holds.start = true;
    if (lk === 'u') { settings.hud = !settings.hud; saveSettings(); applySettings(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key; keys.delete(k.length === 1 ? k.toLowerCase() : k);
    if (k.toLowerCase() === 'k' || k === 'Shift') holds.start = false;
  });
  window.addEventListener('blur', () => keys.clear());

  // ------------------------------------------------------------ views
  function cycleView() {
    if (onFoot) { view = view === 'walk' ? 'orbit' : 'walk'; return; }
    view = { cockpit: 'chase', chase: 'orbit', orbit: 'cockpit' }[view] || 'cockpit';
    toast({ cockpit: 'Cockpit view', chase: 'Chase view', orbit: 'Orbit view' }[view], { cockpit: 'Vista de cabina', chase: 'Vista de persecución', orbit: 'Vista orbital' }[view], 1200);
  }

  // ------------------------------------------------------------ getting in and out
  const DOOR_L = [-1.35, -1.15, 0.45];
  function tryGetOut() {
    if (F.gs > 0.3 || !F.onGround) { toast('Stop the airplane first', 'Detenga el avión primero'); return; }
    if (F.running) { toast('Shut down the engine first: mixture to IDLE CUT-OFF', 'Apague el motor primero: mezcla a CORTE EN RALENTÍ'); return; }
    const p = localToMSL(...DOOR_L);
    walker.x = p.x; walker.z = p.z; walker.heading = ((F.heading / D2R) + 270) % 360;
    onFoot = true; view = 'walk'; walkCam.yaw = -F.heading + Math.PI * 0.75;
    sysEl.hidden = true;
  }
  function tryBoard() {
    const p = localToMSL(...DOOR_L);
    if (Math.hypot(p.x - walker.x, p.z - walker.z) > 2.2) { toast('Walk to the left door to get in', 'Camine a la puerta izquierda para subir'); return; }
    onFoot = false; view = 'cockpit'; look.yaw = 0; look.pitch = -0.14;
  }

  // ------------------------------------------------------------ walking
  function aircraftObstacles() {
    const out = [];
    const fus = [[-2.0, 0.42], [-1.4, 0.52], [-0.6, 0.58], [0.2, 0.62], [1.0, 0.62], [1.8, 0.6], [2.6, 0.48], [3.4, 0.36], [4.2, 0.26], [5.0, 0.2], [5.7, 0.16]];
    for (const [z, r] of fus) { const p = localToMSL(0, -0.3, z); out.push([p.x, p.z, r + 0.05]); }
    for (const x of [-1.6, -1.1, -0.6, 0.6, 1.1, 1.6]) { const p = localToMSL(x, 0.2, 5.5); out.push([p.x, p.z, 0.4]); }
    for (const [x, z, r] of [[-1.27, 1.05, 0.35], [1.27, 1.05, 0.35], [0, -0.6, 0.3]]) { const p = localToMSL(x, -1, z); out.push([p.x, p.z, r]); }
    if (F.rpm > 100) { const p = localToMSL(0, 0, -2.2); out.push([p.x, p.z, 1.1]); }
    return out;
  }
  let nearAction = null;
  function updateWalker(dt) {
    let mx = 0, mz = 0;
    if (keys.has('w') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('s') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('a') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) mx += 1;
    if (walkPad.active) { mx = walkPad.x; mz = walkPad.y; }
    const mag = Math.min(1, Math.hypot(mx, mz));
    const run = keys.has('Shift') || (walkPad.active && mag > 0.92);
    const target = mag * (run ? 3.4 : 1.45);
    walker.speed += (target - walker.speed) * Math.min(1, dt * 6);
    if (mag > 0.05) {
      // Movement is relative to the camera direction
      const camYaw = walkCam.yaw;
      const dx = mx * Math.cos(camYaw) + mz * Math.sin(camYaw);
      const dz = -mx * Math.sin(camYaw) + mz * Math.cos(camYaw);
      const want = Math.atan2(dx, -dz) / D2R;
      let d = ((want - walker.heading + 540) % 360) - 180;
      walker.heading += clamp(d, -540 * dt, 540 * dt);
    }
    const h = walker.heading * D2R;
    let nx = walker.x + Math.sin(h) * walker.speed * dt, nz = walker.z - Math.cos(h) * walker.speed * dt;
    // Collisions with buildings and walls
    const gy = world.groundAt(nx, nz);
    for (const c of world.colliders) {
      if (gy.h + 1.8 < c.y0 || gy.h > c.y1) continue;
      const r = 0.3;
      if (nx > c.x0 - r && nx < c.x1 + r && nz > c.z0 - r && nz < c.z1 + r) {
        const pen = [nx - (c.x0 - r), c.x1 + r - nx, nz - (c.z0 - r), c.z1 + r - nz];
        const m = Math.min(...pen), i = pen.indexOf(m);
        if (i === 0) nx = c.x0 - r; else if (i === 1) nx = c.x1 + r; else if (i === 2) nz = c.z0 - r; else nz = c.z1 + r;
      }
    }
    for (const [ox, oz, r] of aircraftObstacles()) {
      const dx = nx - ox, dz = nz - oz, d = Math.hypot(dx, dz), rr = r + 0.28;
      if (d < rr && d > 1e-4) { nx = ox + dx / d * rr; nz = oz + dz / d * rr; }
    }
    if (world.groundAt(nx, nz).type !== 'water') { walker.x = nx; walker.z = nz; }
    const g = world.groundAt(walker.x, walker.z);
    person.root.position.set(walker.x, g.h, walker.z);
    person.root.rotation.y = -walker.heading * D2R;
    person.animate(dt, walker.speed, walker.reach);

    // Nearby actions
    nearAction = null;
    const door = localToMSL(...DOOR_L);
    const dist = (p) => Math.hypot(p.x - walker.x, p.z - walker.z);
    if (dist(door) < 2.2) nearAction = { en: 'Get in the airplane', es: 'Subir al avión', fn: tryBoard };
    for (const side of [-1, 1]) {
      const w = localToMSL(side * 1.27, -1.1, 1.05);
      if (dist(w) < 1.8 && !nearAction) nearAction = chocks
        ? { en: 'Remove the chocks', es: 'Quitar los calzos', fn: () => { chocks = false; toast('Chocks removed', 'Calzos quitados'); } }
        : (F.gs < 0.1 ? { en: 'Put the chocks in', es: 'Poner los calzos', fn: () => { chocks = true; toast('Chocks in place', 'Calzos puestos'); } } : null);
    }
    walker.reach = Math.max(0, walker.reach - dt * 2);
    fueling = false;
    for (const side of ['L', 'R']) {
      const cap = exterior.H['fuelCap' + side];
      const p = localToMSL(cap.x, cap.y, cap.z);
      if (Math.hypot(p.x - walker.x, p.z - walker.z) < 1.9) {
        const pumpDist = Math.hypot(p.x - PUMP.x, p.z - PUMP.z);
        const key = side === 'L' ? 'fuelL' : 'fuelR';
        if (pumpDist > 22) nearAction = { en: `${side === 'L' ? 'Left' : 'Right'} tank: ${F[key].toFixed(1)} gal. Taxi to the fuel pump to refuel.`, es: `Tanque ${side === 'L' ? 'izquierdo' : 'derecho'}: ${F[key].toFixed(1)} gal. Lleve el avión a la bomba.`, fn: () => {} };
        else nearAction = { hold: true, en: `Hold to fuel the ${side === 'L' ? 'left' : 'right'} tank · ${F[key].toFixed(1)} / 26.5 gal`, es: `Mantenga para cargar el tanque ${side === 'L' ? 'izquierdo' : 'derecho'}`, key, fn: () => {} };
      }
    }
    if (nearAction && nearAction.hold && (holds.fuel || keys.has('e'))) {
      const add = Math.min(26.5 - F[nearAction.key], PUMP_GPM / 60 * dt);
      if (add > 0) { F[nearAction.key] += add; fueledGal += add; fueling = true; walker.reach = 1; }
    }
  }
  let fueling = false;
  promptBtn.addEventListener('click', () => { audio.start(); if (nearAction && !nearAction.hold) nearAction.fn(); });
  promptBtn.addEventListener('pointerdown', () => { if (nearAction && nearAction.hold) holds.fuel = true; });
  const stopFuel = () => { holds.fuel = false; };
  promptBtn.addEventListener('pointerup', stopFuel); promptBtn.addEventListener('pointerleave', stopFuel); promptBtn.addEventListener('pointercancel', stopFuel);

  // ------------------------------------------------------------ flight controls each frame
  function axis(pos, neg) { return (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0); }
  function controlsFrame(dt) {
    // Keyboard: deflections build up while a key is held and return to center when released
    const ramp = (cur, target, up = 1.8, back = 3.0) => { const r = target !== 0 ? up : back; return cur + clamp(target - cur, -r * dt, r * dt); };
    kb.pitch = ramp(kb.pitch, (axis('ArrowDown', 'ArrowUp') + axis('s', 'w')) * 0.75);
    kb.roll = ramp(kb.roll, (axis('ArrowRight', 'ArrowLeft') + axis('d', 'a')) * 0.8);
    kb.rudder = ramp(kb.rudder, axis('e', 'q'), 2.5, 3.5);
    let pitch = kb.pitch, roll = kb.roll, rudder = kb.rudder;
    let brake = keys.has('b') || holds.brake ? 1 : 0, brakeL = keys.has(',') ? 1 : 0, brakeR = keys.has('.') ? 1 : 0;
    // Gamepad
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
    if (gp) {
      const dz = (v) => Math.abs(v) < 0.08 ? 0 : v;
      roll += dz(gp.axes[0] || 0); pitch += dz(gp.axes[1] || 0); rudder += dz(gp.axes[2] || 0);
      if (gp.axes.length > 3 && Math.abs(gp.axes[3]) > 0.1) S.throttle = clamp(S.throttle - gp.axes[3] * dt * 0.6, 0, 1);
      if (gp.buttons[6]) brakeL = Math.max(brakeL, gp.buttons[6].value); if (gp.buttons[7]) brakeR = Math.max(brakeR, gp.buttons[7].value);
      if (gp.buttons[0]?.pressed) brake = 1;
      if (gp.buttons[12]?.pressed) S.trim = clamp(S.trim + dt * 0.25, -1, 1);
      if (gp.buttons[13]?.pressed) S.trim = clamp(S.trim - dt * 0.25, -1, 1);
    }
    if (touchYoke.active) { roll = touchYoke.x; pitch = touchYoke.y; }
    if (touchRudder.active) rudder = touchRudder.x;
    // Assists: coordinated rudder in the air, and steering with the yoke while taxiing
    if (settings.assist) {
      if (!F.onGround && F.ias > 20) rudder = clamp(rudder + clamp(F.beta * 5, -0.6, 0.6) + clamp(-F.w[2] * 0, 0, 0), -1, 1);
      else if (F.onGround && F.gs < 18 && !touchRudder.active && Math.abs(kb.rudder) < 0.05) rudder = clamp(rudder + roll, -1, 1);
    }
    S.yokePitch = clamp(pitch, -1, 1); S.yokeRoll = clamp(roll, -1, 1); S.rudder = clamp(rudder, -1, 1);
    S.brakeL = Math.max(brake, brakeL); S.brakeR = Math.max(brake, brakeR);
    // Throttle, trim, mixture
    if (keys.has('+') || keys.has('=') || keys.has('PageUp')) S.throttle = clamp(S.throttle + dt * 0.5, 0, 1);
    if (keys.has('-') || keys.has('_') || keys.has('PageDown')) S.throttle = clamp(S.throttle - dt * 0.5, 0, 1);
    if (keys.has(']') || holds.trimUp) S.trim = clamp(S.trim + dt * 0.22, -1, 1);
    if (keys.has('[') || holds.trimDn) S.trim = clamp(S.trim - dt * 0.22, -1, 1);
    if (keys.has('m')) S.mixture = clamp(S.mixture + dt * 0.25, 0, 1);
    if (keys.has('n')) S.mixture = clamp(S.mixture - dt * 0.4, 0, 1);
    // Ignition: START springs back to BOTH
    if (holds.start) S.key = 4; else if (Math.round(S.key) === 4) S.key = 3;
    if (document.activeElement !== thr) thr.value = Math.round(S.throttle * 100);
    $('#sim-thr-val').textContent = `${Math.round(S.throttle * 100)}%`;
  }

  // ------------------------------------------------------------ HUD
  let hudT = 0;
  function updateHUD(dt) {
    hudT += dt; if (hudT < 0.1) return; hudT = 0;
    const doorBtn = $('#sim-door span');
    doorBtn.textContent = onFoot ? 'Get in · Subir' : 'Get out · Bajar';
    if (nearAction && onFoot) {
      prompt.hidden = false;
      promptBtn.innerHTML = `${nearAction.en}<small>${nearAction.es}${isTouch ? '' : nearAction.hold ? ' · hold E' : ' · E'}</small>`;
      promptBtn.classList.toggle('active', fueling);
    } else prompt.hidden = true;
    if (!settings.hud) { hud.hidden = true; return; }
    hud.hidden = false;
    const hdg = Math.round(((F.heading / D2R) + 360) % 360);
    const chips = [];
    if (S.parkPull > 0.5) chips.push('<i class="w">PARK BRAKE</i>');
    if (chocks) chips.push('<i class="w">CHOCKS · CALZOS</i>');
    if (F.stallHorn > 0.3 && S.bat > 0.5) chips.push('<i class="r">STALL · PÉRDIDA</i>');
    if (F.fuelL + F.fuelR < 5) chips.push('<i class="r">LOW FUEL</i>');
    if (paused) chips.push('<i>PAUSED · PAUSA</i>');
    if (onFoot) {
      hud.innerHTML = `<div class="row"><b>On foot · A pie</b></div><div class="row muted">Fuel L ${F.fuelL.toFixed(1)} · R ${F.fuelR.toFixed(1)} gal</div><div class="chips">${chips.join('')}</div>`;
      return;
    }
    hud.innerHTML = `
      <div class="row"><span>IAS</span><b>${Math.round(F.ias / KT)}</b><small>kt</small><span>GS</span><b>${Math.round(F.gs / KT)}</b></div>
      <div class="row"><span>ALT</span><b>${Math.round((F.alt / FT + (S.baro - 29.92) * 1000) / 10) * 10}</b><small>ft</small><span>VS</span><b>${Math.round(F.vsiLag / FT * 60 / 10) * 10}</b></div>
      <div class="row"><span>HDG</span><b>${String(hdg).padStart(3, '0')}</b><span>RPM</span><b>${Math.round(F.rpm / 10) * 10}</b></div>
      <div class="row"><span>THR</span><b>${Math.round(S.throttle * 100)}%</b><span>MIX</span><b>${S.mixture > 0.9 ? 'CUT' : Math.round((1 - S.mixture) * 100) + '%'}</b></div>
      <div class="row"><span>FLAP</span><b>${Math.round(F.flaps)}°</b><span>TRIM</span><b>${(S.trim * 100).toFixed(0)}</b></div>
      <div class="row"><span>FUEL</span><b>${F.fuelL.toFixed(1)}</b><small>L</small><b>${F.fuelR.toFixed(1)}</b><small>R gal</small></div>
      <div class="chips">${chips.join('')}</div>`;
  }

  // Quality: phones skip shadows cast by small cockpit parts and use a smaller shadow map.
  const cockpitCasters = [];
  cockpit.root.traverse(o => { if (o.isMesh && o.castShadow) cockpitCasters.push(o); });
  function applySettings() {
    ui.classList.toggle('touch', settings.touchUI);
    audio.setMuted(!settings.sound);
    const high = settings.quality === 'high';
    for (const m of cockpitCasters) m.castShadow = high;
    const size = high ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    o.setMaxPixelRatio(high ? 2 : 1.5);
  }

  // ------------------------------------------------------------ frame
  const basis = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  let shakeT = 0;
  function frame(dt, now) {
    if (!active) return;
    if (!paused && !crashShown) {
      if (!onFoot) controlsFrame(dt); else { S.yokePitch = S.yokeRoll = S.rudder = 0; S.brakeL = S.brakeR = 0; if (Math.round(S.key) === 4) S.key = 3; }
      // Wind and gusts
      windState.gustT += dt;
      const gustAmp = settings.wind === 'gusty' ? 3.0 : settings.wind === 'light' ? 0.8 : 0;
      const agl = Math.max(0, F.agl);
      const wkt = windState.kt * (0.6 + 0.4 * Math.min(1, agl / 300));
      const wd = windState.dir * D2R;
      env.wind = [-Math.cos(wd) * wkt * KT, -Math.sin(wd) * wkt * KT, 0];
      const g = env.gust;
      for (let i = 0; i < 3; i++) g[i] += ((Math.random() * 2 - 1) * gustAmp * (i === 2 ? 0.5 : 1) - g[i]) * Math.min(1, dt * 0.8);
      // Physics: fixed 240 Hz steps
      physAcc += Math.min(dt, 0.1);
      const ctl = { ...S, parkBrake: S.parkPull > 0.5, chocks, bus: S.bat > 0.5, primerStrokes: primerQueue };
      primerQueue = 0;
      let n = 0;
      while (physAcc >= 1 / 240 && n < 48) { fdm.step(1 / 240, ctl, env); ctl.primerStrokes = 0; physAcc -= 1 / 240; n++; }
      if (onFoot) updateWalker(dt);
      // Events
      for (const ev of F.events.splice(0)) {
        if (ev === 'engine-start') toast('Engine started · Oil pressure should rise', 'Motor en marcha · La presión de aceite debe subir');
        if (ev === 'engine-stop' && !F.crashed) {
          const why = (F.fuelL + F.fuelR < 2) ? ['Out of fuel', 'Sin combustible'] : (((S.fuelSel % 360) + 360) % 360 === 180) ? ['Fuel selector is OFF', 'Selector de combustible en OFF'] : S.mixture > 0.85 ? ['Mixture at idle cut-off', 'Mezcla en corte'] : Math.round(S.key) === 0 ? ['Ignition off', 'Encendido apagado'] : ['Engine stopped', 'El motor se detuvo'];
          toast('Engine stopped: ' + why[0], 'Motor detenido: ' + why[1], 5000);
        }
        if (ev === 'touchdown') {
          const fpm = F.touchVs / FT * 60;
          const r = fpm < 120 ? ['Butter! Perfect landing', '¡Aterrizaje perfecto!'] : fpm < 300 ? ['Good landing', 'Buen aterrizaje'] : fpm < 550 ? ['Firm landing', 'Aterrizaje firme'] : ['Hard landing — have the gear inspected', 'Aterrizaje duro — revisar el tren'];
          toast(`${r[0]} · ${fpm.toFixed(0)} fpm`, r[1]);
          audio.thump(Math.min(1, fpm / 400)); shakeT = Math.min(0.4, fpm / 1500);
        }
        if (ev === 'tailstrike') toast('Tail strike! Less pitch on takeoff and landing', '¡Golpe de cola! Menos cabeceo');
      }
      if (F.crashed && !crashShown) showCrash(F.crashed);
      maybeSave(dt);
    }
    // Place the airplane
    const t = toThree(F);
    basis.makeBasis(new THREE.Vector3(...t.right), new THREE.Vector3(...t.up), new THREE.Vector3(...t.aft));
    aircraft.quaternion.setFromRotationMatrix(basis);
    aircraft.position.set(t.pos[0], t.pos[1] + WORLD_Y, t.pos[2]);
    aircraft.updateMatrixWorld(true);
    exterior.H.chocks.visible = chocks && F.onGround;
    exterior.H.update(F, S, paused ? 0 : dt, { nav: S.sw_nav > 0.5 && S.bat > 0.5, beacon: S.sw_beacon > 0.5 && S.bat > 0.5 && Math.sin(now * 7) > 0.6, strobe: S.sw_strobe > 0.5 && S.bat > 0.5 && (now % 1.1) < 0.06, landing: S.sw_land > 0.5 && S.bat > 0.5 });
    // VOR bearing for the CDIs, heading indicator gyro
    const cg = worldOf(F.pos);
    F.vorBearing = ((Math.atan2(VOR.x - cg.x, -(VOR.z - cg.z)) / D2R) + 360) % 360;
    F.hiHeading = F.gyro > 0.5 ? (F.heading + F.hiDrift) / D2R : (F.hiFrozen ?? (F.hiFrozen = F.heading / D2R));
    if (F.gyro > 0.5) F.hiFrozen = null;
    F.bus = S.bat > 0.5;
    sim.setFlight(F);
    person.root.visible = onFoot;

    // Camera
    camera.fov = 52;
    const lastView = prevView; prevView = view;
    if (view === 'cockpit') {
      const eye = aircraft.localToWorld(new THREE.Vector3(-0.28, 0.6, 0.86));
      tmpE.set(look.pitch, look.yaw, 0);
      tmpQ.setFromEuler(tmpE);
      camera.quaternion.copy(aircraft.quaternion).multiply(tmpQ);
      if (shakeT > 0) { eye.y += (Math.random() - 0.5) * shakeT * 0.05; shakeT -= dt; }
      // Rumble on the ground and buffet near the stall
      const rough = F.onGround ? Math.min(1, F.gs / 25) * 0.0025 : F.stallHorn * 0.004;
      eye.x += (Math.random() - 0.5) * rough; eye.y += (Math.random() - 0.5) * rough;
      camera.position.copy(eye);
      camera.fov = look.fov;
    } else {
      const focus = onFoot && view === 'walk' ? person.root.position.clone().add(new THREE.Vector3(0, WORLD_Y + 1.6, 0)) : aircraft.localToWorld(new THREE.Vector3(0, 0.1, 1.2));
      let yaw, pitch, dist;
      if (view === 'walk') { yaw = walkCam.yaw; pitch = walkCam.pitch; dist = walkCam.dist; }
      else if (view === 'chase') { yaw = -F.heading + (ext.yaw - 0.5); pitch = ext.pitch; dist = ext.dist; }
      else { yaw = ext.yaw; pitch = ext.pitch; dist = ext.dist; }
      const want = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(focus);
      // Keep the camera above the ground and smooth it
      const gh = world.heightAt(want.x, want.z) + WORLD_Y + 0.4;
      if (want.y < gh) want.y = gh;
      if (view === 'chase' && lastView === 'chase') camPos.lerp(want, Math.min(1, dt * 4)); else camPos.copy(want);
      camTarget.copy(focus);
      camera.position.copy(camPos);
      camera.lookAt(camTarget);
    }
    // Portrait phones: widen the field of view so the panel and the view ahead still fit
    if (camera.aspect < 1) camera.fov = clamp(camera.fov / camera.aspect * 0.62, camera.fov, 92);
    camera.updateProjectionMatrix();
    // Shadows follow what we are looking at
    const sfocus = onFoot ? person.root.position.clone().add(new THREE.Vector3(0, WORLD_Y, 0)) : aircraft.position;
    sun.target.position.copy(sfocus);
    sun.position.copy(sfocus).add(new THREE.Vector3(-30, 45, 25));
    sun.target.updateMatrixWorld();
    // Sky and sound
    world.update(camera.position.clone().sub(world.group.position), windState.dir, windState.kt);
    const camDist = camera.position.distanceTo(aircraft.position);
    audio.update(F, { inside: view === 'cockpit' && !onFoot, dist: camDist, fueling });
    updateHUD(dt);
    if (!sysEl.hidden) { sysTimer += dt; if (sysTimer > 0.5) { sysTimer = 0; if (!sysEl.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') renderSystems(); } }
    ui.classList.toggle('walking', onFoot);
  }
  let physAcc = 0;
  let prevView = null;

  return {
    get active() { return active; },
    get view() { return view; },
    fdm,
    enter() {
      active = true;
      document.body.classList.add('sim');
      ui.hidden = false;
      orbitControls.enabled = false;
      applySettings();
      sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 140; sun.shadow.camera.updateProjectionMatrix();
      exterior.H.chocks.visible = chocks;
      if (!started) showMenu(true); else showMenu();
    },
    exit() {
      active = false;
      setPaused(true);
      document.body.classList.remove('sim');
      ui.hidden = true;
      orbitControls.enabled = true;
      sim.setFlight(null);
      person.root.visible = false;
      exterior.H.chocks.visible = false;
    },
    frame,
  };
}
