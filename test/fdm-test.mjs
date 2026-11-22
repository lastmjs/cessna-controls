// Checks the flight model against Cessna 172 book numbers. Run: node test/fdm-test.mjs
import { createFDM, KT, FT } from '../js/fdm.js';
const env = { groundAt: () => ({ h: 0, type: 'runway' }), wind: [0, 0, 0] };
const base = () => ({ yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0, parkBrake: 0, trim: 0.2, flapCmd: 0,
  throttle: 0, mixture: 0, carbheat: 0, key: 3, bat: 1, alt: 1, avionics: 1, fuelSel: 0, bus: 1 });
const DT = 1 / 240;
function run(f, c, secs, each) { for (let t = 0; t < secs; t += DT) { if (each) each(t); f.step(DT, c, env); if (f.st.crashed) { console.log('CRASH', f.st.crashed); return false; } } return true; }
function running(f) { f.st.running = true; f.st.rpm = 700; f.st.oilT = 0.5; f.st.gyro = 1; f.st.bowl = 0.08; f.st.fuelL = f.st.fuelR = 20; }
const out = [];
// 1 idle and static RPM
{ const f = createFDM(); f.placeOnGround(0, 0, 0, 0); running(f); const c = base(); c.parkBrake = 1;
  run(f, c, 8); out.push(['idle rpm (book ~600-700)', f.st.rpm.toFixed(0), 'fuel gph', f.st.fuelFlowGph.toFixed(1)]);
  c.throttle = 1; run(f, c, 8); out.push(['static full-throttle rpm (book 2300-2420)', f.st.rpm.toFixed(0), 'thrust N', f.st.thrust.toFixed(0), 'gph', f.st.fuelFlowGph.toFixed(1)]);
}
// 2 takeoff roll
{ const f = createFDM(); f.placeOnGround(0, 0, 0, 0); running(f); const c = base(); c.throttle = 1;
  let lift = null, t50 = null; let tt = 0;
  run(f, c, 40, (t) => { tt = t;
    const ias = f.st.ias / KT;
    if (ias > 55) { const target = 8 * Math.PI / 180; c.yokePitch = Math.max(-1, Math.min(1, (target - f.st.pitch) * 6 - f.st.w[1] * 2)); }
    if (!lift && f.st.agl > 0.3) lift = { d: f.st.pos[0], t, ias };
    if (!t50 && f.st.agl > 15.24) t50 = { d: f.st.pos[0], t };
  });
  out.push(['takeoff ground roll m (book ~240-290 at this weight)', lift && lift.d.toFixed(0), 'liftoff KIAS', lift && lift.ias.toFixed(0), 'over 50ft m (book ~500)', t50 && t50.d.toFixed(0)]);
}
// helper: fly level/climb with a simple autopilot
function flyAt(f, c, { ias, holdAlt = null, secs = 120 }) {
  let iErr = 0;
  run(f, c, secs, () => {
    const e = eulerish(f);
    // speed by pitch when climbing, altitude by pitch when level
    let pitchCmd;
    if (holdAlt == null) pitchCmd = (f.st.ias / KT - ias) * 0.012;
    else pitchCmd = (holdAlt - f.st.alt) * 0.004 - f.st.vs * 0.02 + 0.04;
    pitchCmd = Math.max(-0.25, Math.min(0.3, pitchCmd));
    iErr += (pitchCmd - e.pitch) * DT;
    c.yokePitch = Math.max(-1, Math.min(1, (pitchCmd - e.pitch) * 4 + iErr * 2 - f.st.w[1] * 1.5));
    c.yokeRoll = Math.max(-1, Math.min(1, -f.st.roll * 2 - f.st.w[0] * 0.5));
    c.rudder = Math.max(-1, Math.min(1, c.rudder + (f.st.beta * 4 - c.rudder) * 0.02));
  });
}
const eulerish = (f) => ({ pitch: f.st.pitch });
function airborne(alt, kias) { const f = createFDM(); f.placeOnGround(0, 0, 0, 0); running(f);
  f.st.pos[2] = -alt; f.st.vel = [kias * KT, 0, 0]; f.st.rpm = 2300; f.st.agl = alt; return f; }
// 3 max level speed at sea level and cruise at 8000 ft
{ const f = airborne(300, 110); const c = base(); c.throttle = 1; flyAt(f, c, { holdAlt: 300, secs: 400 });
  out.push(['max level KTAS at sea level (book ~123)', (f.st.tas / KT).toFixed(0), 'rpm', f.st.rpm.toFixed(0), 'gph', f.st.fuelFlowGph.toFixed(1), 'vs fpm', (f.st.vs / FT * 60).toFixed(0), 'alt', f.st.alt.toFixed(0), 'pitch', (f.st.pitch*57.3).toFixed(1), 'yoke', c.yokePitch.toFixed(2), 'CL', f.st.CL.toFixed(3), 'CD', f.st.CD.toFixed(4), 'D', (f.st.CD*f.st.qbar*16.17).toFixed(0), 'T', f.st.thrust.toFixed(0), 'alpha', (f.st.alpha*57.3).toFixed(2), 'beta', (f.st.beta*57.3).toFixed(2), 'flaps', f.st.flaps, 'rud', c.rudder.toFixed(2), 'ail', c.yokeRoll.toFixed(2)]); }
{ const f = airborne(8000 * FT, 105); const c = base(); c.throttle = 1; c.mixture = 0.2; flyAt(f, c, { holdAlt: 8000 * FT, secs: 220 });
  out.push(['8000 ft full throttle leaned: KTAS (book ~115-120)', (f.st.tas / KT).toFixed(0), 'rpm', f.st.rpm.toFixed(0), 'gph', f.st.fuelFlowGph.toFixed(1)]); }
// 4 climb at 74 KIAS
{ const f = airborne(300, 74); const c = base(); c.throttle = 1; flyAt(f, c, { ias: 74, secs: 60 });
  out.push(['climb fpm at 74 KIAS (book ~770 light)', (f.st.vs / FT * 60).toFixed(0), 'rpm', f.st.rpm.toFixed(0)]); }
// 5 glide at 68 KIAS idle
{ const f = airborne(1500, 68); const c = base(); c.throttle = 0; flyAt(f, c, { ias: 68, secs: 60 });
  out.push(['idle glide sink fpm at 68 KIAS (book ~700)', (-f.st.vs / FT * 60).toFixed(0), 'rpm', f.st.rpm.toFixed(0)]); }
// 6 stall speeds
for (const flaps of [0, 3]) {
  const f = airborne(1500, 70); const c = base(); c.throttle = 0; c.flapCmd = flaps; f.st.flaps = flaps * 10;
  let stall = null;
  run(f, c, 90, (t) => {
    const target = Math.max(30, 70 - t * 1.0);
    const pitchCmd = Math.max(-0.3, Math.min(0.5, (f.st.ias / KT - target) * 0.02 + 0.05));
    c.yokePitch = Math.max(-1, Math.min(1, (pitchCmd - f.st.pitch) * 4 - f.st.w[1] * 1.5));
    c.yokeRoll = Math.max(-1, Math.min(1, -f.st.roll * 2));
    if (!stall && f.st.alpha > (15.5 - 2.5 * flaps / 3) * Math.PI / 180) stall = f.st.ias / KT;
  });
  out.push([`stall KIAS flaps ${flaps * 10} (book ${flaps ? '~40-42' : '~46-48'})`, stall && stall.toFixed(0)]);
}
// 7 cruise fuel flow
{ const f = airborne(3000 * FT, 105); const c = base(); c.throttle = 0.72; flyAt(f, c, { holdAlt: 3000 * FT, secs: 200 });
  out.push(['partial throttle cruise: rpm, KTAS, gph (book 2400 rpm ~ 105 kt ~ 8 gph rich)', f.st.rpm.toFixed(0), (f.st.tas / KT).toFixed(0), f.st.fuelFlowGph.toFixed(1)]); }
for (const o of out) console.log(o.join('  |  '));
