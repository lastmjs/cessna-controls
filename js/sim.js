// State of every control, the simple logic that connects them, and the demonstrations.
// The airplane is parked on the ramp with the engine idling when the page opens.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((d + 540) % 360) - 180;
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export const KEY_ANGLES = [-70, -35, 0, 35, 70]; // OFF R L BOTH START
export const FLAP_LEVER_Y = [0.036, 0.012, -0.012, -0.036];
const FLAP_PTR_Y = [0.0245, 0.0101, -0.0043, -0.0186];
const FIELD_ELEV = 1520; // feet
const RUNWAY_HDG = 341;
const VOR_BEARING = 32; // bearing to the station

export function initialState() {
  return {
    yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0, trim: 0.2,
    flapCmd: 0, flaps: 0,
    throttle: 0.05, mixture: 0, carbheat: 0, primer: 0, primerRot: 0,
    key: 3, bat: 1, alt: 1, avionics: 1,
    sw_beacon: 1, sw_land: 0, sw_taxi: 0, sw_nav: 0, sw_strobe: 0, sw_pitot: 0,
    fuelSel: 0, parkPull: 0, parkRot: 0, cabinheat: 0, cabinair: 0, altstatic: 0,
    dimmer: 0.15, baro: 29.92, hdgBug: 341, hiOffset: 0, obs1: 30, obs2: 120, aiKnob: 0,
    ptt: 0, ident: 0, glove: 0, visor: 0, seatPos: 0, seat2Pos: 0, breakerOut: 0,
    running: true, cranking: 0, rpm: 750, swap1: 0, swap2: 0,
  };
}

// Demonstrations: keyframes [seconds, {stateKey: value}]. Keys beginning with "d_" are
// temporary needle overrides and are removed when the demonstration ends.
const DEMOS = {
  yoke: [[0, {}], [1.2, { yokeRoll: -1 }], [2.6, { yokeRoll: 1 }], [3.6, { yokeRoll: 0 }], [4.6, { yokePitch: 1 }], [5.8, { yokePitch: -1 }], [6.8, { yokePitch: 0 }]],
  ptt: [[0, { ptt: 0 }], [0.2, { ptt: 1 }], [1.6, { ptt: 1 }], [1.8, { ptt: 0 }]],
  rudder: [[0, {}], [1.2, { rudder: -1 }], [2.6, { rudder: 1 }], [3.6, { rudder: 0 }]],
  toebrakes: [[0, {}], [0.8, { brakeL: 1, brakeR: 1 }], [1.8, { brakeL: 1, brakeR: 1 }], [2.4, { brakeL: 0, brakeR: 0 }], [3.0, { brakeL: 1 }], [3.6, { brakeL: 0 }], [4.2, { brakeR: 1 }], [4.8, { brakeR: 0 }]],
  trimwheel: [[0, {}], [2, { trim: 1 }], [4, { trim: -1 }], [5.5, { trim: 0.2 }]],
  flapswitch: [[0, { flapCmd: 0 }], [0.6, { flapCmd: 1 }], [4, { flapCmd: 1 }], [4.6, { flapCmd: 2 }], [8, { flapCmd: 2 }], [8.6, { flapCmd: 3 }], [12, { flapCmd: 3 }], [12.8, { flapCmd: 0 }], [22, { flapCmd: 0 }]],
  throttle: [[0, {}], [2, { throttle: 1 }], [4, { throttle: 1 }], [6, { throttle: 0.05 }]],
  mixture: [[0, {}], [1.5, { throttle: 0.5 }], [3.5, { mixture: 0.55 }], [5, { mixture: 0.55 }], [6.5, { mixture: 0 }], [7.5, { throttle: 0.05 }]],
  carbheat: [[0, {}], [1.5, { throttle: 0.5 }], [2.6, { carbheat: 1 }], [4.6, { carbheat: 1 }], [5.6, { carbheat: 0 }], [6.6, { throttle: 0.05 }]],
  primer: [[0, {}], [0.6, { primerRot: 1 }], [1.2, { primer: 1 }], [1.8, { primer: 0 }], [2.4, { primer: 1 }], [3.0, { primer: 0 }], [3.6, { primer: 1 }], [4.2, { primer: 0 }], [4.8, { primerRot: 0 }]],
  ignition: null, // custom
  fuelsel: [[0, {}], [1.2, { fuelSel: -90 }], [2.4, { fuelSel: -90 }], [4, { fuelSel: 90 }], [5.2, { fuelSel: 90 }], [6.4, { fuelSel: 0 }]],
  parkbrake: [[0, {}], [0.6, { brakeL: 1, brakeR: 1 }], [1.4, { parkPull: 1 }], [2.0, { parkRot: 1 }], [2.6, { brakeL: 0, brakeR: 0 }], [4.6, { parkRot: 1, parkPull: 1 }], [5.2, { parkRot: 0 }], [5.8, { parkPull: 0 }]],
  cabinheat: [[0, {}], [1, { cabinheat: 1 }], [2.6, { cabinheat: 1 }], [3.6, { cabinheat: 0 }]],
  cabinair: [[0, {}], [1, { cabinair: 1 }], [2.6, { cabinair: 1 }], [3.6, { cabinair: 0 }]],
  altstatic: [[0, {}], [1, { altstatic: 1 }], [2.6, { altstatic: 1 }], [3.6, { altstatic: 0 }]],
  dimmer: [[0, {}], [1.5, { dimmer: 1 }], [3, { dimmer: 1 }], [4.5, { dimmer: 0.15 }]],
  alt_knob: [[0, {}], [2, { baro: 30.22 }], [3, { baro: 30.22 }], [5, { baro: 29.92 }]],
  ai_knob: [[0, {}], [1, { aiKnob: 1 }], [2.2, { aiKnob: -1 }], [3.2, { aiKnob: 0 }]],
  hi_knob: [[0, {}], [2, { hiOffset: 60 }], [4, { hiOffset: 0 }]],
  hdgbug_knob: [[0, {}], [2, { hdgBug: 341 + 90 }], [4, { hdgBug: 341 - 60 }], [5.5, { hdgBug: 341 }]],
  obs1: [[0, {}], [2.5, { obs1: 80 }], [5, { obs1: 30 }]],
  vor1: [[0, {}], [2.5, { obs1: 80 }], [5, { obs1: 30 }]],
  obs2: [[0, {}], [2.5, { obs2: 200 }], [5, { obs2: 120 }]],
  vor2: [[0, {}], [2.5, { obs2: 200 }], [5, { obs2: 120 }]],
  glovebox: [[0, {}], [1, { glove: 1 }], [3, { glove: 1 }], [4, { glove: 0 }]],
  visor: [[0, {}], [1, { visor: 1 }], [3, { visor: 1 }], [4, { visor: 0 }]],
  seat: [[0, {}], [1.2, { seatPos: 1 }], [2.4, { seatPos: -1 }], [3.4, { seatPos: 0 }]],
  seat2: [[0, {}], [1.2, { seat2Pos: 1 }], [2.4, { seat2Pos: -1 }], [3.4, { seat2Pos: 0 }]],
  breakers: [[0, {}], [0.5, { breakerOut: 1 }], [2, { breakerOut: 1 }], [2.5, { breakerOut: 0 }]],
  xpdr: [[0, {}], [0.2, { ident: 1 }], [0.6, { ident: 1 }], [0.8, { ident: 0 }], [4, { ident: 0 }]],
  navcom1: [[0, {}], [0.4, { swap1: 1 }], [2.5, { swap1: 1 }], [2.9, { swap1: 0 }]],
  navcom2: [[0, {}], [0.4, { swap2: 1 }], [2.5, { swap2: 1 }], [2.9, { swap2: 0 }]],
  // Needle sweeps that show each instrument's markings
  asi: [[0, { d_asi: 0 }], [2, { d_asi: 85 }], [3.5, { d_asi: 129 }], [5, { d_asi: 163 }], [6, { d_asi: 163 }], [8, { d_asi: 0 }]],
  alt: [[0, { d_alt: FIELD_ELEV }], [4, { d_alt: 5500 }], [6, { d_alt: 5500 }], [9, { d_alt: FIELD_ELEV }]],
  vsi: [[0, { d_vsi: 0 }], [1.5, { d_vsi: 700 }], [3, { d_vsi: 700 }], [4.5, { d_vsi: -500 }], [6, { d_vsi: -500 }], [7, { d_vsi: 0 }]],
  ai: [[0, { d_pitch: 0, d_bank: 0 }], [1.5, { d_pitch: 8 }], [3, { d_pitch: 8, d_bank: -25 }], [4.5, { d_pitch: 0, d_bank: 25 }], [6, { d_pitch: -5, d_bank: 0 }], [7, { d_pitch: 0 }]],
  tc: [[0, { d_turn: 0, d_slip: 0 }], [1.5, { d_turn: -1 }], [3, { d_turn: -1, d_slip: 0.8 }], [4, { d_turn: -1, d_slip: 0 }], [5.5, { d_turn: 1 }], [6.5, { d_turn: 1 }], [7.5, { d_turn: 0 }]],
  hi: [[0, { d_hdg: 0 }], [3, { d_hdg: 90 }], [5, { d_hdg: -90 }], [6.5, { d_hdg: 0 }]],
  compass: [[0, { d_hdg: 0 }], [3, { d_hdg: 90 }], [5, { d_hdg: -90 }], [6.5, { d_hdg: 0 }]],
  tach: [[0, {}], [2, { throttle: 1 }], [4, { throttle: 1 }], [6, { throttle: 0.05 }]],
  suction: [[0, {}], [2, { throttle: 0.7 }], [4, { throttle: 0.7 }], [6, { throttle: 0.05 }]],
  ammeter: [[0, {}], [0.5, { alt: 0 }], [3, { alt: 0 }], [3.5, { alt: 1 }]],
  lowvolt: [[0, {}], [0.5, { alt: 0 }], [3, { alt: 0 }], [3.5, { alt: 1 }]],
  egt: [[0, {}], [1.5, { throttle: 0.6 }], [3.5, { mixture: 0.5 }], [5, { mixture: 0.5 }], [6.5, { mixture: 0 }], [7.5, { throttle: 0.05 }]],
  fuelqty: [[0, { d_fuelL: 0.8, d_fuelR: 0.72 }], [2, { d_fuelL: 0, d_fuelR: 0 }], [4, { d_fuelL: 1, d_fuelR: 1 }], [6, { d_fuelL: 0.8, d_fuelR: 0.72 }]],
  oilgauges: [[0, { d_oilT: 0.55, d_oilP: 0.6 }], [2, { d_oilT: 0.1, d_oilP: 0.05 }], [4.5, { d_oilT: 0.6, d_oilP: 0.65 }], [6, { d_oilT: 0.55, d_oilP: 0.6 }]],
  audiopanel: [[0, { d_mkr: 0 }], [6, { d_mkr: 6 }], [6.01, { d_mkr: 0 }]],
};
DEMOS.yoke2 = DEMOS.yoke; DEMOS.rudder2 = DEMOS.rudder; DEMOS.trimind = DEMOS.trimwheel;
DEMOS.flapind = DEMOS.flapswitch; DEMOS.mic = DEMOS.ptt;

// Two-position switches: "Operate" flips them.
const TOGGLES = ['avmaster', 'sw_beacon', 'sw_land', 'sw_taxi', 'sw_nav', 'sw_strobe', 'sw_pitot'];

export function hasAction(id) { return !!DEMOS[id] || TOGGLES.includes(id) || id === 'ignition' || id === 'master'; }
export function actionKind(id) { return (TOGGLES.includes(id) || id === 'master') ? 'toggle' : 'demo'; }

export function createSim(H) {
  const s = initialState();
  let demo = null;            // {tracks, t, dur, id}
  let lastAI = null;
  let lastBaro = null;
  let lastPower = null;
  let hobbs = 1184.3;

  function buildTracks(frames) {
    const tracks = {};
    for (const [t, vals] of frames) for (const k of Object.keys(vals)) (tracks[k] ||= []).push([t, vals[k]]);
    for (const k of Object.keys(tracks)) {
      if (tracks[k][0][0] > 0) tracks[k].unshift([0, s[k] ?? tracks[k][0][1]]);
    }
    return tracks;
  }

  function play(id) {
    if (id === 'avmaster') { s.avionics = s.avionics ? 0 : 1; return; }
    if (TOGGLES.includes(id)) { s[id] = s[id] ? 0 : 1; return; }
    if (id === 'master') { const on = s.bat && s.alt ? 0 : 1; s.bat = on; s.alt = on; return; }
    let frames = DEMOS[id];
    if (id === 'ignition') {
      if (s.running) frames = [[0, {}], [1, { throttle: 0.6 }], [2.5, { key: 3 }], [3.3, { key: 1 }], [5, { key: 1 }], [5.6, { key: 3 }], [7, { key: 3 }], [7.6, { key: 2 }], [9.3, { key: 2 }], [9.9, { key: 3 }], [11, { throttle: 0.05 }]];
      else frames = [[0, {}], [0.6, { key: 3 }], [1.2, { key: 4 }], [3.0, { key: 4 }], [3.4, { key: 3 }]];
    }
    if (!frames) return;
    const tracks = buildTracks(frames);
    // A sweep that shows the flap gauge needs actual flap travel time: commanded values are steps.
    const dur = Math.max(...frames.map(f => f[0]));
    demo = { id, tracks, t: 0, dur, step: id === 'flapswitch' || id === 'flapind' || id === 'audiopanel' };
  }

  function stop() {
    if (!demo) return;
    for (const k of Object.keys(demo.tracks)) if (k.startsWith('d_')) delete s[k];
    demo = null;
  }

  function runDemo(dt) {
    if (!demo) return;
    demo.t += dt;
    for (const [k, tr] of Object.entries(demo.tracks)) {
      let i = 0;
      while (i < tr.length - 1 && tr[i + 1][0] <= demo.t) i++;
      if (i >= tr.length - 1) { s[k] = tr[tr.length - 1][1]; continue; }
      const [t0, v0] = tr[i], [t1, v1] = tr[i + 1];
      const f = smooth(clamp((demo.t - t0) / (t1 - t0), 0, 1));
      s[k] = demo.step && (k === 'flapCmd' || k === 'd_mkr') ? (k === 'd_mkr' ? lerp(v0, v1, (demo.t - t0) / (t1 - t0)) : (f > 0.5 ? v1 : v0)) : lerp(v0, v1, f);
    }
    if (demo.t >= demo.dur) {
      if (demo.id === 'fuelsel') s.fuelSel = 0;
      stop();
    }
  }

  // When the simulator is running, `flight` is the flight model state and drives every gauge.
  let flight = null;
  function update(dt, now) {
    runDemo(dt);
    const keyPos = Math.round(s.key);
    const bus = s.bat > 0.5;
    if (flight) {
      s.running = flight.running; s.rpm = flight.rpm; s.flaps = flight.flaps;
      apply(now, bus, keyPos);
      return;
    }
    const fuelOn = Math.abs(wrap180(s.fuelSel - 180)) > 30;
    const mixtureOk = s.mixture < 0.85;
    if (keyPos === 4 && bus) {
      s.cranking += dt;
      if (s.cranking > 1.2 && fuelOn && mixtureOk) s.running = true;
    } else s.cranking = 0;
    if (keyPos === 0 || !fuelOn || !mixtureOk) s.running = false;

    let rpmTarget = 0;
    if (s.running) {
      rpmTarget = 700 + s.throttle * 1700;
      if (keyPos === 1 || keyPos === 2) rpmTarget -= 50 + 50 * s.throttle;
      rpmTarget -= s.carbheat * (60 + 90 * s.throttle);
      if (s.mixture > 0.3) rpmTarget -= (s.mixture - 0.3) * 900;
    } else if (keyPos === 4 && bus) rpmTarget = 180 + Math.sin(now * 30) * 30;
    s.rpm += (rpmTarget - s.rpm) * Math.min(1, dt * 2.5);

    // Electric flaps move at about 3 degrees per second
    const flapTarget = s.flapCmd * 10;
    if (bus) s.flaps += clamp(flapTarget - s.flaps, -3 * dt, 3 * dt);

    if (s.running) hobbs += dt / 3600;
    apply(now, bus, keyPos);
  }

  function apply(now, bus, keyPos) {
    // ---------- flight controls
    for (const y of [H.yoke, H.yoke2]) {
      y.slide.position.z = s.yokePitch * 0.07;
      y.roll.rotation.z = -s.yokeRoll * 0.9;
    }
    for (const set of [H.pedals, H.pedals2]) {
      set[0].piv.rotation.x = s.rudder * 0.2;
      set[1].piv.rotation.x = -s.rudder * 0.2;
      set[0].toe.rotation.x = -s.brakeL * 0.35;
      set[1].toe.rotation.x = -s.brakeR * 0.35;
    }
    H.pttBtn.position.y = 0.004 - s.ptt * 0.0018;
    H.trimWheel.rotation.x = -(s.trim - 0.2) * Math.PI * 3;
    H.trimPtr.position.y = 0.0002 + s.trim * 0.04;
    const fl = clamp(s.flapCmd, 0, 3);
    const fi = Math.floor(Math.min(fl, 2.999)), ff = fl - fi;
    H.flapLever.position.y = lerp(FLAP_LEVER_Y[fi], FLAP_LEVER_Y[fi + 1], ff);
    const fa = clamp(s.flaps / 10, 0, 3), ai = Math.floor(Math.min(fa, 2.999));
    H.flapPtr.position.y = lerp(FLAP_PTR_Y[ai], FLAP_PTR_Y[ai + 1], fa - ai);

    // ---------- engine controls
    H.throttle.slider.position.z = (1 - s.throttle) * H.throttle.travel;
    H.mixture.slider.position.z = s.mixture * H.mixture.travel;
    H.carbheat.slider.position.z = s.carbheat * H.carbheat.travel;
    H.primer.slider.position.z = s.primer * H.primer.travel;
    H.primer.slider.rotation.z = -s.primerRot * Math.PI / 2;
    H.cabinheat.slider.position.z = s.cabinheat * H.cabinheat.travel;
    H.cabinair.slider.position.z = s.cabinair * H.cabinair.travel;
    H.altstatic.slider.position.z = s.altstatic * H.altstatic.travel;
    H.parkbrake.slider.position.z = s.parkPull * 0.045;
    H.parkbrake.rot.rotation.z = s.parkRot * Math.PI / 2;
    {
      const k = clamp(s.key, 0, 4), i = Math.floor(Math.min(k, 3.999));
      H.key.rotation.z = -lerp(KEY_ANGLES[i], KEY_ANGLES[i + 1], k - i) * DEG;
    }
    H.fuelHandle.rotation.y = -s.fuelSel * DEG;

    // ---------- switches
    const rock = (piv, on) => { piv.rotation.x += ((on ? -0.28 : 0.28) - piv.rotation.x) * 0.35; };
    rock(H.switches.bat, s.bat > 0.5); rock(H.switches.alt, s.alt > 0.5);
    rock(H.switches.avmaster, s.avionics > 0.5);
    for (const id of ['sw_beacon', 'sw_land', 'sw_taxi', 'sw_nav', 'sw_strobe', 'sw_pitot']) rock(H.switches[id], s[id] > 0.5);
    H.breakers[3].position.z = 0.002 + s.breakerOut * 0.005;

    // ---------- knobs
    H.knobs.dimmer.rotation.z = -s.dimmer * 4.5;
    H.knobs.alt_knob.rotation.z = -(s.baro - 29.92) * 30;
    H.knobs.ai_knob.rotation.z = -s.aiKnob * 2;
    H.knobs.hi_knob.rotation.z = -s.hiOffset * DEG * 3;
    H.knobs.hdgbug_knob.rotation.z = -(s.hdgBug - 341) * DEG * 3;
    H.knobs.obs1.rotation.z = -s.obs1 * DEG * 2;
    H.knobs.obs2.rotation.z = -s.obs2 * DEG * 2;
    H.gloveDoor.rotation.x = s.glove * 1.2;
    H.visors.children.forEach(v => { v.rotation.x = s.visor * 1.25; });
    H.seats.seat.position.z = 0.82 + s.seatPos * 0.08;
    H.seats.seat2.position.z = 0.82 + s.seat2Pos * 0.08;
    H.identBtn.position.z = 0.004 - s.ident * 0.0025;

    // ---------- electrical
    const F = flight;
    const charging = F ? F.altOut : s.alt > 0.5 && s.running && bus;
    const amps = F ? F.ampsNet : !bus ? 0 : charging ? 4 + (s.sw_land ? 2 : 0) : -(6 + (s.avionics ? 4 : 0) + (s.sw_land ? 8 : 0) + (s.sw_pitot ? 10 : 0));
    const avPower = bus && s.avionics > 0.5 && !(keyPos === 4);
    const lowV = bus && !charging;
    H.lowVolt.emissive.setHex(lowV ? 0xff1a00 : 0x000000);
    H.lowVolt.emissiveIntensity = lowV ? 3 : 0;
    const glow = bus ? s.dimmer * 0.55 : 0;
    for (const m of H.glowMats) m.emissiveIntensity = glow;

    const powerKey = `${avPower}|${s.swap1 > 0.5}|${s.swap2 > 0.5}|${s.ident > 0.5}`;
    if (powerKey !== lastPower) {
      lastPower = powerKey;
      for (const [id, sw] of [['navcom1', s.swap1 > 0.5], ['navcom2', s.swap2 > 0.5]]) {
        const d = H.displays[id]; const f = d.freqs;
        d.d.draw(avPower, sw ? f[1] : f[0], sw ? f[0] : f[1], f[2], f[3]);
      }
      H.displays.xpdr.d.draw(avPower, '1200', s.ident > 0.5 ? 'IDENT' : 'ALT');
    }
    const mk = s.d_mkr;
    H.markers.forEach((m, i) => { m.emissiveIntensity = avPower && mk !== undefined && Math.floor(mk) % 3 === i && mk > 0 ? 3 : 0; });

    // ---------- gauges
    const N = H.needles;
    const rot = (n, deg) => { n.rotation.z = -deg * DEG; };
    rot(N.asi, asiDegOf(F ? F.ias / 0.514444 : (s.d_asi ?? 0)));
    const indAlt = Math.max(0, (F ? F.alt / 0.3048 : (s.d_alt ?? FIELD_ELEV)) + (s.baro - 29.92) * 1000);
    rot(N.alt100, (indAlt % 1000) / 1000 * 360);
    rot(N.alt1k, (indAlt % 10000) / 10000 * 360);
    rot(N.alt10k, indAlt / 100000 * 360);
    const baroR = Math.round(s.baro * 100) / 100;
    if (baroR !== lastBaro) { lastBaro = baroR; H.redrawAlt(baroR); }
    rot(N.vsi, vsiDegOf(F ? F.vsiLag * 196.85 : (s.d_vsi ?? 0)));
    rot(N.tach, tachDegOf(s.rpm));
    const suction = F ? F.suction : s.rpm < 300 ? s.rpm / 300 * 2 : clamp(3.4 + (s.rpm - 700) / 1700 * 1.9, 0, 6);
    rot(N.suction, 225 + suction / 10 * 270);
    rot(N.ammeter, clamp(amps, -60, 60) / 60 * 110);
    const egt = F ? F.egt : s.running ? clamp(0.3 + 0.3 * s.throttle + (s.mixture < 0.4 ? s.mixture * 0.6 : 0.24 - (s.mixture - 0.4) * 0.6), 0, 1) : 0;
    rot(N.egt, -60 + egt * 120);
    rot(N.egtRef, -60 + 0.72 * 120);
    const cl = (n, t) => rot(n, -55 + clamp(t, 0, 1) * 110);
    if (F) {
      cl(N.fuelL, bus ? F.fuelL / 26.5 : 0); cl(N.fuelR, bus ? F.fuelR / 26.5 : 0);
      cl(N.oilT, bus ? F.oilT : 0); cl(N.oilP, F.oilP);
    } else {
      cl(N.fuelL, bus ? (s.d_fuelL ?? 0.8) : 0);
      cl(N.fuelR, bus ? (s.d_fuelR ?? 0.72) : 0);
      cl(N.oilT, bus ? (s.d_oilT ?? 0.55) : 0);
      cl(N.oilP, bus ? (s.d_oilP ?? (s.running ? 0.45 + s.rpm / 2700 * 0.25 : 0)) : 0);
    }
    const d = new Date(now ? Date.now() : 0);
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    rot(N.clockS, sec * 6);
    rot(N.clockM, (d.getMinutes() + sec / 60) * 6);
    rot(N.clockH, ((d.getHours() % 12) + d.getMinutes() / 60) * 30);

    // Attitude indicator
    let pitch = (s.d_pitch ?? 0), bank = (s.d_bank ?? 0);
    if (F) {
      // A gyro that has not spun up yet sits tilted
      const e = 1 - F.gyro;
      pitch = F.pitch / DEG * F.gyro + e * 12; bank = F.roll / DEG * F.gyro + e * 28;
    }
    if (pitch !== lastAI) { lastAI = pitch; H.ai.draw(pitch); }
    H.ai.ball.rotation.z = bank * DEG;
    H.ai.plane.position.y = s.aiKnob * 0.006;
    // Turn coordinator
    H.tc.plane.rotation.z = -clamp(F ? F.turnInd / (3 * DEG) : (s.d_turn ?? 0), -1.6, 1.6) * 20 * DEG;
    const slip = F ? F.ball * 5 : s.d_slip ?? (-s.rudder * 0.5);
    H.tc.ball.position.x = clamp(slip, -1, 1) * H.tc.r * 0.32;
    H.tc.ball.position.y = -H.tc.r * 0.6 + Math.abs(clamp(slip, -1, 1)) * H.tc.r * 0.06;
    // Heading indicator and compass
    const hdg = F ? F.heading / DEG : RUNWAY_HDG + (s.d_hdg ?? 0);
    const hiHdg = F ? (F.hiHeading ?? hdg) + s.hiOffset : hdg + s.hiOffset;
    H.hi.card.rotation.z = hiHdg * DEG;
    H.hi.bug.rotation.z = -(s.hdgBug - hiHdg) * DEG;
    H.compassCard.rotation.y = F ? F.compass : hdg * DEG + Math.sin(now * 0.7) * 0.01;
    // VOR indicators
    for (const [id, obs] of [['vor1', s.obs1], ['vor2', s.obs2]]) {
      const v = H[id];
      v.card.rotation.z = obs * DEG;
      const dev = wrap180((F && F.vorBearing != null ? F.vorBearing : id === 'vor1' ? VOR_BEARING : 155) - obs);
      const to = Math.abs(dev) < 90;
      const cdiDev = to ? dev : -wrap180(dev + 180);
      v.cdi.rotation.z = clamp(cdiDev / 10, -1, 1) * 0.3 * (avPower ? 1 : 0);
      v.flag.rotation.z = to ? 0 : Math.PI;
      v.flag.visible = avPower;
      if (v.gs) v.gs.rotation.z = avPower ? 0.0 : 0.25;
    }
  }

  return {
    state: s, play, stop, update,
    setFlight(f) { flight = f; lastPower = null; },
    get playing() { return demo ? demo.id : null; },
    get hobbs() { return hobbs; },
  };
}

// Same mappings as the faces (kept here to avoid a circular import).
function asiDegOf(v) { return v <= 40 ? 12 + (v / 40) * 8 : 20 + (Math.min(v, 200) - 40) / 160 * 320; }
function vsiDegOf(fpm) {
  const f = clamp(fpm, -2000, 2000), sign = Math.sign(f), a = Math.abs(f);
  return 270 + sign * (a <= 1000 ? (a / 1000) * 105 : 105 + ((a - 1000) / 1000) * 65);
}
function tachDegOf(rpm) { return 210 + clamp(rpm, 0, 3500) / 3500 * 300; }
