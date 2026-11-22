// Flight dynamics for a Cessna 172-class airplane: 6 degrees of freedom rigid body,
// aerodynamic coefficients, a carbureted 160 hp engine with a fixed-pitch propeller,
// fuel, electrical and vacuum systems, and a three-wheel landing gear.
//
// No graphics here, so it can be tested in Node.
// Frames: NED world (north, east, down, meters) and body (x forward, y right, z down).
// The 3D model uses "three local" coordinates: X right, Y up, Z aft, origin at the
// instrument panel. Body vector = (-Z, X, -Y) relative to the center of gravity.

export const G0 = 9.80665;
export const KT = 0.514444;
export const FT = 0.3048;
export const GAL_KG = 2.72; // one US gallon of 100LL avgas, kg
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const PLANE = {
  S: 16.17, b: 11.0, c: 1.49,
  emptyKg: 767, occupantsKg: 82, oilKg: 7,
  I: [1285, 1825, 2667],            // Ixx, Iyy, Izz (kg m^2)
  cg: [0, 0.05, 0.80],              // three-local
  tankMaxGal: 26.5, unusableGal: 1.5,
  propD: 1.905,
  // Landing gear and other contact points (three-local, gear points at full extension)
  gear: [
    { id: 'nose', p: [0, -1.19, -0.60], k: 36000, c: 3600, steer: true, r: 0.17 },
    { id: 'left', p: [-1.27, -1.200, 1.05], k: 80000, c: 6500, brake: 'L', r: 0.19 },
    { id: 'right', p: [1.27, -1.200, 1.05], k: 80000, c: 6500, brake: 'R', r: 0.19 },
  ],
  hard: [ // rigid points: touching the ground here means damage
    { id: 'tail', p: [0, -0.35, 5.6] }, { id: 'belly', p: [0, -0.68, 0.6] },
    { id: 'prop', p: [0, -0.88, -1.97] }, { id: 'wingL', p: [-5.45, 1.12, 0.9] },
    { id: 'wingR', p: [5.45, 1.12, 0.9] }, { id: 'stab', p: [-1.7, 0.2, 5.6] }, { id: 'stab2', p: [1.7, 0.2, 5.6] },
    { id: 'nose', p: [0, 0.0, -2.12] }, { id: 'fin', p: [0, 1.55, 5.8] },
  ],
};

// ---------------------------------------------------------------- atmosphere
export function isa(hM, dT = 0) {
  const h = Math.min(hM, 11000);
  const T = 288.15 - 0.0065 * h + dT;
  const p = 101325 * Math.pow((288.15 - 0.0065 * h) / 288.15, 5.25588);
  return { T, p, rho: p / (287.053 * T) };
}

// ---------------------------------------------------------------- small vector / quaternion helpers
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
// q = [w, x, y, z], rotates body -> NED
function qRot(q, v) {
  const [w, x, y, z] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const qConj = (q) => [q[0], -q[1], -q[2], -q[3]];
const qRotInv = (q, v) => qRot(qConj(q), v);
function qMul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
function qNorm(q) { const l = Math.hypot(...q); return q.map(c => c / l); }
export function qFromEuler(yaw, pitch, roll) { // radians, aerospace order
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
export function eulerFromQ(q) {
  const [w, x, y, z] = q;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { roll, pitch, yaw };
}
// three-local point -> body vector from CG
const localToBody = (p) => [-(p[2] - PLANE.cg[2]), p[0] - PLANE.cg[0], -(p[1] - PLANE.cg[1])];
export { qRot, qRotInv, localToBody };

// ---------------------------------------------------------------- aerodynamic model
const AERO = {
  CL0: 0.31, CLa: 5.143, CLq: 3.9, CLad: 1.7, CLde: 0.43,
  CD0: 0.0300, k: 0.054, CDbeta: 0.17,
  CYb: -0.31, CYdr: -0.187, CYp: -0.037, CYr: 0.21,
  Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: -0.0147,
  Cm0: 0.04, Cma: -0.89, Cmq: -12.4, Cmad: -5.2, Cmde: -1.28,
  Cnb: 0.065, Cnp: -0.03, Cnr: -0.099, Cnda: -0.053, Cndr: 0.0657,
};
// Flap increments by deflection (deg): extra lift, drag, pitch and the reduction of stall angle
function flapEffects(deg) {
  const t = clamp(deg / 30, 0, 1);
  return { dCL: lerp(0, 0.62, Math.pow(t, 0.85)), dCD: 0.004 + 0.075 * t * t, dCm: 0.03 * t, dAlphaStall: -2.5 * t };
}
// Lift coefficient with a smooth stall break. aStall is the stall angle (rad).
function liftCoef(a, base, aStall) {
  const lin = base + AERO.CLa * a;
  const aNeg = -0.26;
  if (a > aStall) {
    const peak = base + AERO.CLa * aStall;
    const over = a - aStall;
    const post = peak - 1.9 * over - 4 * over * over;           // sharp break past the stall
    const plate = 2 * Math.sin(a) * Math.cos(a) * 1.05;           // flat plate far beyond
    return Math.max(post, plate * clamp(over / 0.3, 0, 1));
  }
  if (a < aNeg) return base + AERO.CLa * aNeg - 1.5 * (aNeg - a);
  return lin;
}

// ---------------------------------------------------------------- propeller and engine
// Fixed-pitch climb/cruise prop: thrust and power coefficients vs advance ratio J.
const propCt = (J) => Math.max(-0.08, 0.098 - 0.0145 * J - 0.0795 * J * J);
const propCp = (J) => 0.0585 + 0.004 * J - 0.0395 * J * J;
const ENGINE = {
  displacement: 0.00524, Ve: 0.80, kInd: 2.13, map0: 5.15, kFric: 0.0031,
  inertia: 1.75, ratedRpm: 2700,
};
// Power multiplier from fuel/air equivalence ratio phi (1 = stoichiometric)
function mixturePower(phi) {
  if (phi < 0.62 || phi > 2.1) return 0;
  if (phi < 0.8) return lerp(0, 0.78, (phi - 0.62) / 0.18);
  return Math.max(0, 1 - 1.9 * (phi - 1.17) * (phi - 1.17));
}

export function createFDM() {
  const st = {
    pos: v3(0, 0, -1.15),            // NED of the airplane's CG
    vel: v3(), q: qFromEuler(0, 0, 0), w: v3(), // body rates p q r
    rpm: 0, running: false, crank: 0, primed: 0, flooded: false,
    fuelL: 12, fuelR: 12, bowl: 0.08,  // gallons
    battery: 0.85, oilT: 0.12, oilP: 0, egt: 0, cht: 0.15,
    gyro: 0, hiDrift: 0, tach: 3127.4, hobbs: 1184.3,
    roll: 0, pitch: 0, heading: 0, agl: 0,
    flaps: 0, crashed: null, onGround: true, wowMain: true, onRunway: false,
    alphaPrev: 0, vsiLag: 0, ias: 0, tas: 0, alpha: 0, beta: 0, gs: 0, aoaWarn: false,
    specF: v3(0, 0, -G0), thrust: 0, fuelFlowGph: 0, alt: 0, vs: 0, mass: 0, airborneTime: 0,
    lastTouch: 0, touchVs: 0, events: [],
    compass: 0, compassRate: 0, turnInd: 0, ball: 0, tireSkid: 0, gearComp: [0, 0, 0],
    stallHorn: 0, starter: false, ampsNet: 0, suction: 0, map: 0, wheelRot: [0, 0, 0], noseSteer: 0,
  };

  function mass() {
    return PLANE.emptyKg + PLANE.occupantsKg + PLANE.oilKg + (st.fuelL + st.fuelR) * GAL_KG;
  }

  // controls: sim.state from the cockpit (yokeRoll, yokePitch, rudder, brakeL/R, parking brake,
  // trim, flapCmd, throttle, mixture, carbheat, key, bat, alt, fuelSel, primer stroke count...)
  // env: { groundAt(n, e) -> {h, type}, wind: [n,e,d], turb: 0..1, collide(points) -> hit|null }
  function step(dt, c, env) {
    if (st.crashed) return;
    const m = mass();
    st.mass = m;
    const [Ixx, Iyy, Izz] = PLANE.I;
    const alt = -st.pos[2];
    const atm = isa(alt);
    st.agl = alt - env.groundAt(st.pos[0], st.pos[1]).h - (PLANE.cg[1] + 1.15);
    const sigma = atm.rho / 1.225;

    // ------------ air-relative velocity in body axes
    const wind = env.wind || v3();
    const turb = env.gust || v3();
    const vAirNed = sub(st.vel, add(wind, turb));
    const vb = qRotInv(st.q, vAirNed);
    const V = Math.max(len(vb), 0.01);
    const alpha = Math.atan2(vb[2], Math.max(vb[0], 0.1) * (vb[0] < 0 ? -1 : 1));
    const beta = Math.asin(clamp(vb[1] / V, -1, 1));
    const qbar = 0.5 * atm.rho * V * V;
    const [p, qq, r] = st.w;
    const Vn = Math.max(V, 8);
    const ph = p * PLANE.b / (2 * Vn), qh = qq * PLANE.c / (2 * Vn), rh = r * PLANE.b / (2 * Vn);
    const adot = clamp((alpha - st.alphaPrev) / dt, -2, 2);
    st.alphaPrev = alpha;
    const adh = adot * PLANE.c / (2 * Vn);

    // ------------ control surfaces
    const flapTarget = clamp(Math.round(c.flapCmd ?? 0), 0, 3) * 10;
    if (c.bus) st.flaps += clamp(flapTarget - st.flaps, -3 * dt, 3 * dt);
    const trimDe = -(c.trim - 0.2) * 9 * D2R;            // trim tab, as an equivalent elevator angle
    const de = (c.yokePitch > 0 ? -c.yokePitch * 25 : -c.yokePitch * 20) * D2R + trimDe;
    const da = c.yokeRoll * 18 * D2R;
    const dr = c.rudder * 17 * D2R;
    const fl = flapEffects(st.flaps);

    // ------------ engine
    const keyPos = Math.round(c.key);
    const fuelSel = ((c.fuelSel % 360) + 360) % 360;
    const selBoth = fuelSel < 30 || fuelSel > 330, selL = Math.abs(fuelSel - 270) < 30, selR = Math.abs(fuelSel - 90) < 30;
    const usable = (g) => Math.max(0, g - PLANE.unusableGal / 2);
    const feedAvail = (selBoth && (usable(st.fuelL) > 0 || usable(st.fuelR) > 0)) || (selL && usable(st.fuelL) > 0) || (selR && usable(st.fuelR) > 0);
    const n = st.rpm / 60;
    const omega = Math.max(st.rpm * Math.PI / 30, 1);
    const throttle = clamp(c.throttle, 0, 1);
    const pAmbInHg = atm.p / 3386.39;
    const map = pAmbInHg * (0.27 + 0.73 * Math.pow(throttle, 0.75)) * (1 - 0.06 * clamp(st.rpm / 2700, 0, 1) * (1 - throttle));
    st.map = map;
    const mixKnob = clamp(c.mixture, 0, 1);
    const farRich = 0.083 / Math.sqrt(sigma) * (c.carbheat > 0.5 ? 1.06 : 1);
    const far = mixKnob > 0.9 ? 0 : farRich * (1 - 0.6 * mixKnob / 0.9);
    const phi = far / 0.0667;
    const airFlow = ENGINE.Ve * ENGINE.displacement * (st.rpm / 120) * atm.rho * (map / pAmbInHg) * (c.carbheat > 0.5 ? 0.93 : 1);
    const fuelFlowKg = st.running ? airFlow * far : 0;
    const mags = keyPos === 3 || keyPos === 4 ? 2 : keyPos === 1 || keyPos === 2 ? 1 : 0;
    const fuelToEngine = st.bowl > 0.0005;
    let combust = st.running && mags > 0 && fuelToEngine && phi > 0.62 && phi < 2.1;
    if (st.flooded) combust = combust && throttle > 0.6;
    let pInd = 0;
    if (combust) {
      pInd = ENGINE.kInd * st.rpm * Math.max(0, map - ENGINE.map0) * mixturePower(phi) * (mags === 1 ? 0.965 : 1) * (c.carbheat > 0.5 ? 0.92 : 1);
    }
    const pFric = ENGINE.kFric * st.rpm * st.rpm + 8 * omega * (st.rpm > 1 ? 1 : 0); // 8 N·m of breakaway friction
    // Starter
    st.starter = keyPos === 4 && c.bat > 0.5 && st.battery > 0.15;
    const qStarter = st.starter ? Math.max(0, 95 - st.rpm * 0.35) * clamp((st.battery - 0.15) / 0.3, 0, 1) : 0;
    if (st.starter) st.battery -= dt * 0.0012;
    // Propeller
    const J = n > 0.5 ? clamp(vb[0], -10, 100) / (n * PLANE.propD) : 0;
    const Ct = propCt(Math.max(J, 0)), Cp = propCp(Math.max(J, 0));
    const D4 = Math.pow(PLANE.propD, 4), D5 = D4 * PLANE.propD;
    const thrust = Ct * atm.rho * n * n * D4;
    let pProp = Cp * atm.rho * n * n * n * D5;
    // Windmilling: airflow drives the prop when the engine produces little power
    const windmill = Math.max(0, vb[0] - n * PLANE.propD * 0.95) * 0;
    const qNet = (pInd - pFric - pProp) / omega + qStarter + windmill;
    st.rpm = Math.max(0, st.rpm + (qNet / ENGINE.inertia) * dt * 30 / Math.PI);
    if (!combust && !st.starter && st.rpm < 30 && vb[0] < 15) st.rpm *= 0.9;
    // Windmill: a stopped prop in a fast glide still turns a little
    if (!combust && vb[0] > 25) st.rpm = Math.max(st.rpm, (vb[0] - 25) * 12);
    st.thrust = thrust;

    // Ignition logic: catch while cranking, stop when combustion is not possible
    if (!st.running) {
      if (st.starter && st.rpm > 120 && mags > 0 && feedAvail && phi > 0.62 && phi < 2.1) {
        st.crank += dt;
        const need = st.flooded ? (throttle > 0.6 ? 2.5 : 1e9) : st.primed >= 1 ? 1.1 : (st.oilT > 0.4 ? 1.2 : 4.5);
        if (st.crank > need) { st.running = true; st.flooded = false; st.events.push('engine-start'); }
      } else if (!st.starter) st.crank = Math.max(0, st.crank - dt);
    } else {
      if (mags === 0 || !fuelToEngine || phi < 0.62 || phi > 2.1 || st.rpm < 110) {
        st.running = false; st.events.push('engine-stop');
      }
    }
    // Priming: each stroke adds fuel; too many floods the engine. Prime evaporates over time.
    if (c.primerStrokes) { st.primed += c.primerStrokes; if (st.primed > 6) st.flooded = true; }
    if (st.running) st.primed = 0; else st.primed = Math.max(0, st.primed - dt * 0.004);

    // Fuel: bowl refills from the selected tanks; engine draws from the bowl
    const fuelGalPerS = fuelFlowKg / GAL_KG;
    st.fuelFlowGph = fuelGalPerS * 3600;
    st.bowl -= fuelGalPerS * dt;
    if (feedAvail && fuelSel !== 180) {
      const need = Math.max(0, 0.08 - st.bowl);
      const take = Math.min(need, 0.02 * dt + fuelGalPerS * dt);
      if (selBoth) {
        const lA = usable(st.fuelL) > 0, rA = usable(st.fuelR) > 0;
        if (lA && rA) { st.fuelL -= take * 0.52; st.fuelR -= take * 0.48; } else if (lA) st.fuelL -= take; else st.fuelR -= take;
      } else if (selL) st.fuelL -= take; else st.fuelR -= take;
      st.bowl += take;
    }
    st.fuelL = Math.max(0, st.fuelL); st.fuelR = Math.max(0, st.fuelR); st.bowl = Math.max(0, st.bowl);

    // Temperatures and pressures (normalized 0..1 for the gauges)
    const pwrFrac = clamp((pInd - pFric) / 119300, 0, 1.1);
    const oilTarget = st.running ? 0.42 + 0.25 * pwrFrac - 0.05 * clamp(V / 60, 0, 1) : 0.1;
    st.oilT += (oilTarget - st.oilT) * dt / (st.running ? 240 : 900);
    const oilPTarget = st.rpm > 200 ? clamp(0.25 + st.rpm / 2700 * 0.45 - (st.oilT - 0.5) * 0.15, 0, 1) : 0;
    st.oilP += (oilPTarget - st.oilP) * Math.min(1, dt * 1.5);
    const egtTarget = combust ? clamp(0.35 + 0.35 * pwrFrac + 0.45 * Math.exp(-((phi - 1.0) ** 2) / 0.02) * 0.5 - 0.15 * Math.max(0, phi - 1.2), 0, 1) : 0.05;
    st.egt += (egtTarget - st.egt) * Math.min(1, dt * 0.6);
    st.cht += ((combust ? 0.35 + 0.35 * pwrFrac : 0.12) - st.cht) * dt / 200;

    // Electrical
    const altOut = c.alt > 0.5 && st.rpm > 950 && c.bat > 0.5;
    const load = c.bat > 0.5 ? (4 + (c.avionics ? 5 : 0) + (c.sw_land ? 8 : 0) + (c.sw_taxi ? 6 : 0) + (c.sw_pitot ? 9 : 0) + (c.sw_strobe ? 3 : 0) + (c.sw_nav ? 3 : 0) + (c.sw_beacon ? 2 : 0) + (st.starter ? 150 : 0)) : 0;
    st.ampsNet = c.bat > 0.5 ? (altOut ? Math.min(60, load + (1 - st.battery) * 25) - load : -load) : 0;
    st.battery = clamp(st.battery + st.ampsNet * dt / (35 * 3600), 0, 1);
    st.altOut = altOut;
    // Vacuum and gyros
    st.suction = st.rpm < 300 ? st.rpm / 300 * 1.5 : clamp(3.2 + (st.rpm - 700) / 1700 * 2.0, 0, 6);
    st.gyro += ((st.suction > 3.6 ? 1 : st.suction / 3.6 * 0.4) - st.gyro) * dt / 25;
    st.tach += dt * clamp(st.rpm / 2400, 0, 1.2) / 3600;
    if (st.rpm > 300) st.hobbs += dt / 3600;

    // ------------ aerodynamic forces (body axes)
    // Ground effect lowers induced drag and raises lift close to the ground
    const hAgl = st.agl ?? 50;
    const hb = Math.max(hAgl + 0.8, 0.5) / PLANE.b;
    const ge = (16 * hb) ** 2 / (1 + (16 * hb) ** 2);
    const aStall = (15.5 + fl.dAlphaStall) * D2R;
    let CL = liftCoef(alpha, AERO.CL0 + fl.dCL, aStall) + AERO.CLq * qh + AERO.CLad * adh;
    CL *= 1 + 0.07 * (1 - ge);
    // Slipstream over the tail at high power and low speed
    const discA = Math.PI * PLANE.propD * PLANE.propD / 4;
    const dvSlip = Math.sqrt(Math.max(0, V * V + 2 * Math.max(thrust, 0) / (atm.rho * discA))) - V;
    const qTail = 0.5 * atm.rho * (V + dvSlip * 0.75) ** 2;
    const tailRatio = qbar > 1 ? qTail / qbar : 1;
    CL += AERO.CLde * de * Math.min(tailRatio, 3);
    // Asymmetric wing drop when deeply stalled
    const stalled = alpha > aStall;
    const CD = AERO.CD0 + AERO.k * ge * (CL - 0.15) ** 2 + fl.dCD + AERO.CDbeta * Math.abs(beta)
      + (stalled ? 1.1 * Math.sin(alpha - aStall) ** 1 : 0) + (alpha > 0.6 ? 0.8 * Math.sin(alpha) : 0);
    st.CL = CL; st.CD = CD; st.qbar = qbar;
    const CY = AERO.CYb * beta + AERO.CYdr * dr * Math.min(tailRatio, 4) + AERO.CYp * ph + AERO.CYr * rh;
    const Cl = AERO.Clb * beta + AERO.Clp * ph + AERO.Clr * rh + AERO.Clda * da + AERO.Cldr * dr * Math.min(tailRatio, 4)
      + (stalled ? 0.06 * Math.sin((st.tach * 3600) * 0.9) * clamp((alpha - aStall) / 0.1, 0, 1) : 0);
    const Cm = AERO.Cm0 + AERO.Cma * alpha + AERO.Cmq * qh + AERO.Cmad * adh + AERO.Cmde * de * Math.min(tailRatio, 4) + fl.dCm
      - (stalled ? 0.25 * (alpha - aStall) : 0);
    const Cn = AERO.Cnb * beta + AERO.Cnp * ph + AERO.Cnr * rh + AERO.Cnda * da + AERO.Cndr * dr * Math.min(tailRatio, 4);
    // Wind axes -> body: lift is perpendicular to the airflow, drag along it
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const L = qbar * PLANE.S * CL, Dg = qbar * PLANE.S * CD, Y = qbar * PLANE.S * CY;
    let Fb = [-Dg * ca + L * sa, Y, -Dg * sa - L * ca];
    if (vb[0] < -1) Fb = scl(vb, -qbar * PLANE.S * 1.2 / V); // flying backwards: just drag
    Fb[0] += thrust;
    let Mb = [qbar * PLANE.S * PLANE.b * Cl, qbar * PLANE.S * PLANE.c * Cm, qbar * PLANE.S * PLANE.b * Cn];
    // Propeller torque rolls left; slipstream and P-factor yaw left at high power and low speed
    const qProp = pProp / omega;
    Mb[0] -= qProp * 0.55;
    Mb[2] -= thrust * (0.055 + 0.25 * clamp(alpha, 0, 0.3)) * clamp(1 - V / 70, 0.15, 1);
    // Thrust line is slightly below the CG: power on pitches the nose up a little
    Mb[1] += thrust * 0.04;

    // ------------ gravity
    const Fg = qRotInv(st.q, [0, 0, m * G0]);
    let F = add(Fb, Fg);
    let M = Mb;

    // ------------ ground contact
    const R = (p) => qRot(st.q, localToBody(p));
    st.onGround = false; st.wowMain = false;
    let skid = 0;
    const brakeL = clamp(Math.max(c.brakeL, c.parkBrake ? 1 : 0), 0, 1), brakeR = clamp(Math.max(c.brakeR, c.parkBrake ? 1 : 0), 0, 1);
    st.noseSteer = c.rudder * 10 * D2R;
    PLANE.gear.forEach((g, gi) => {
      const rb = localToBody(g.p);
      const rw = qRot(st.q, rb);
      const pw = add(st.pos, rw);
      const gnd = env.groundAt(pw[0], pw[1]);
      const comp = Math.max(0, gnd.h - (-pw[2]));
      st.gearComp[gi] = comp;
      if (comp <= 0) return;
      if (gnd.type === 'water') { crash('Landed in the water · Aterrizó en el agua'); return; }
      st.onGround = true; if (gi > 0) st.wowMain = true;
      if (gnd.type === 'runway') st.onRunway = true;
      // Velocity of the contact point (NED)
      const vp = add(st.vel, qRot(st.q, cross(st.w, rb)));
      const vDown = vp[2];
      if (comp > 0.30) { crash(gi === 0 ? 'Nose gear collapsed · Se rompió el tren de nariz' : 'Main gear collapsed · Se rompió el tren principal'); return; }
      let N = g.k * comp + g.c * Math.max(vDown, -2) * (vDown > 0 ? 1 : 0.4);
      N = Math.max(0, N);
      // Wheel heading in the ground plane
      const fwdB = g.steer ? [Math.cos(st.noseSteer), Math.sin(st.noseSteer), 0] : [1, 0, 0];
      let fw = qRot(st.q, fwdB); fw = [fw[0], fw[1], 0]; const fl2 = Math.hypot(fw[0], fw[1]) || 1; fw = [fw[0] / fl2, fw[1] / fl2, 0];
      const lat = [-fw[1], fw[0], 0];
      const vLong = vp[0] * fw[0] + vp[1] * fw[1];
      const vLat = vp[0] * lat[0] + vp[1] * lat[1];
      const surfMu = gnd.type === 'runway' ? 0.8 : gnd.type === 'grass' ? 0.5 : 0.6;
      const roll = gnd.type === 'grass' ? 0.07 : 0.026;
      const brake = c.chocks && g.brake ? 1 : g.brake === 'L' ? brakeL : g.brake === 'R' ? brakeR : 0;
      const fLongMax = (roll + brake * surfMu * (c.chocks && g.brake ? 2.2 : 0.85)) * N;
      const fLong = -clamp(vLong * 9000, -fLongMax, fLongMax);
      const caster = g.steer && Math.abs(brakeL - brakeR) > 0.4 && Math.abs(c.rudder) > 0.8;
      const latMu = (caster ? 0.08 : 1) * surfMu;
      const fLat = -clamp(vLat * 12000, -latMu * N, latMu * N);
      if (Math.abs(vLat) > 1.5) skid = Math.max(skid, Math.abs(vLat));
      if (brake > 0.9 && Math.abs(vLong) > 6) skid = Math.max(skid, 1);
      const Fw = [fw[0] * fLong + lat[0] * fLat, fw[1] * fLong + lat[1] * fLat, -N];
      const Fbw = qRotInv(st.q, Fw);
      F = add(F, Fbw);
      M = add(M, cross(rb, Fbw));
      st.wheelRot[gi] += vLong / g.r * dt;
      if (vDown > 0.5 && st.airborneTime > 0.5) { st.touchVs = vDown; st.events.push('touchdown'); st.airborneTime = 0; }
    });
    st.tireSkid = skid;
    if (!st.onGround) st.airborneTime += dt; else st.airborneTime = 0;
    if (st.crashed) return;
    // Hard points: strikes are damage
    for (const h of PLANE.hard) {
      const pw = add(st.pos, qRot(st.q, localToBody(h.p)));
      const gnd = env.groundAt(pw[0], pw[1]);
      if (-pw[2] < gnd.h - 0.02) {
        const spd = len(st.vel);
        if (h.id === 'tail' && spd < 18 && -pw[2] > gnd.h - 0.08) { // gentle tail scrape
          const rb = localToBody(h.p); const N = 30000 * (gnd.h - (-pw[2]));
          const Fbw = qRotInv(st.q, [-st.vel[0] * 400, -st.vel[1] * 400, -N]);
          F = add(F, Fbw); M = add(M, cross(rb, Fbw)); st.events.push('tailstrike');
          continue;
        }
        const what = { prop: 'Propeller strike · Golpe de hélice', wingL: 'Left wingtip hit the ground · Punta de ala izquierda golpeó el suelo',
          wingR: 'Right wingtip hit the ground · Punta de ala derecha golpeó el suelo', belly: 'Belly landing · Aterrizaje de panza' }[h.id] || 'Crashed into the ground · Choque contra el suelo';
        crash(what); return;
      }
    }
    // Obstacles (hangar walls, buildings, the fuel pump)
    if (env.collide) {
      const pts = PLANE.hard.map(h => add(st.pos, qRot(st.q, localToBody(h.p))));
      const hit = env.collide(pts);
      if (hit) { crash(`Hit ${hit.en} · Chocó contra ${hit.es}`); return; }
    }

    // ------------ integrate
    const accB = scl(F, 1 / m);
    st.specF = scl(sub(F, Fg), 1 / m); // what the pilot feels (body)
    const accN = qRot(st.q, accB);
    st.vel = add(st.vel, scl(accN, dt));
    // Static friction holds a stopped airplane with brakes set
    if (st.onGround && len(st.vel) < 0.05 && ((brakeL > 0.5 && brakeR > 0.5) || c.chocks) && thrust < 0.25 * m * G0 * (c.chocks ? 1.6 : 0.8)) { st.vel = [0, 0, st.vel[2]]; }
    st.pos = add(st.pos, scl(st.vel, dt));
    const wdot = [
      (M[0] - (Izz - Iyy) * st.w[1] * st.w[2]) / Ixx,
      (M[1] - (Ixx - Izz) * st.w[2] * st.w[0]) / Iyy,
      (M[2] - (Iyy - Ixx) * st.w[0] * st.w[1]) / Izz,
    ];
    st.w = add(st.w, scl(wdot, dt));
    if (st.onGround && len(st.vel) < 0.03 && Math.abs(st.w[2]) < 0.002) st.w = [st.w[0] * 0.9, st.w[1] * 0.9, 0];
    const dq = qMul(st.q, [0, st.w[0] * 0.5 * dt, st.w[1] * 0.5 * dt, st.w[2] * 0.5 * dt]);
    st.q = qNorm([st.q[0] + dq[0], st.q[1] + dq[1], st.q[2] + dq[2], st.q[3] + dq[3]]);

    // ------------ derived values for instruments
    const vbTrue = qRotInv(st.q, st.vel);
    st.alpha = alpha; st.beta = beta; st.tas = V;
    st.ias = Math.sqrt(Math.max(0, 2 * qbar * Math.max(0.2, Math.cos(alpha)) / 1.225)); // m/s
    st.alt = alt; st.vs = -st.vel[2];
    st.gs = Math.hypot(st.vel[0], st.vel[1]);
    st.vsiLag += (st.vs - st.vsiLag) * Math.min(1, dt / 3.5);
    const aStallWarn = aStall - 5 * D2R;
    st.stallHorn = !st.onGround || V > 15 ? clamp((alpha - aStallWarn) / (2 * D2R), 0, 1) * (V > 8 ? 1 : 0) : 0;
    const e = eulerFromQ(st.q);
    st.roll = e.roll; st.pitch = e.pitch; st.heading = e.yaw;
    const yawRate = (st.w[1] * Math.sin(e.roll) + st.w[2] * Math.cos(e.roll)) / Math.max(0.2, Math.cos(e.pitch));
    st.turnInd += ((yawRate + 0.25 * st.w[0]) * (c.bus ? 1 : 0) - st.turnInd) * Math.min(1, dt * 4);
    const fz = Math.min(-1, st.specF[2]);
    st.ball += ((-st.specF[1] / -fz) - st.ball) * Math.min(1, dt * 5);
    // Magnetic compass: damped card swinging toward heading
    let dh = ((e.yaw - st.compass + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    st.compassRate += (dh * 6 - st.compassRate * 3.2) * dt;
    st.compass += st.compassRate * dt;
    st.hiDrift += dt * (0.25 / 60) * D2R; // about 3.75 degrees per 15 minutes
    st.vb = vbTrue;
  }

  function crash(reason) {
    if (st.crashed) return;
    st.crashed = reason; st.running = false; st.rpm = 0;
    st.events.push('crash');
  }

  // Place the airplane at rest: n,e = position of the CG on the ground plane, heading in degrees
  function placeOnGround(n, e, groundH, headingDeg) {
    const h = headingDeg * D2R;
    st.q = qFromEuler(h, 0, 0);
    // Static: mains compressed ~5 cm, nose ~8 cm. Find CG height so the gear points touch.
    const yMain = -1.15;
    st.pos = [n, e, -(groundH + (PLANE.cg[1] - yMain))];
    st.vel = v3(); st.w = v3(); st.crashed = null; st.airborneTime = 0;
    st.compass = h; st.compassRate = 0;
  }

  return { st, step, placeOnGround, mass, crash };
}

// Converts NED position + attitude quaternion to what three.js needs for the airplane group
// (origin at the panel, three-local axes). Returns {pos:[x,y,z], basis: [right, up, aft]} in three world.
export function toThree(st) {
  const nedToThree = (v) => [v[1], -v[2], -v[0]];
  const right = nedToThree(qRot(st.q, [0, 1, 0]));
  const up = nedToThree(qRot(st.q, [0, 0, -1]));
  const aft = nedToThree(qRot(st.q, [-1, 0, 0]));
  const cgW = nedToThree(st.pos);
  const [cx, cy, cz] = PLANE.cg;
  const origin = [0, 1, 2].map(i => cgW[i] - right[i] * cx - up[i] * cy - aft[i] * cz);
  return { pos: origin, right, up, aft };
}
