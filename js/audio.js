// Synthesized airplane sounds (no audio files): engine, propeller, wind, stall horn, starter, tires.
export function createAudio() {
  let ctx = null, nodes = null, muted = false;

  function noiseBuffer(c, seconds = 2, brown = false) {
    const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    // Cabin filter: inside the cockpit the engine is muffled
    const cabin = ctx.createBiquadFilter(); cabin.type = 'lowpass'; cabin.frequency.value = 1400; cabin.connect(master);
    // Engine: two detuned sawtooth oscillators at the firing frequency, plus a sub harmonic
    const eng = ctx.createGain(); eng.gain.value = 0;
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500; engFilter.Q.value = 1.5;
    eng.connect(engFilter); engFilter.connect(cabin);
    const oscs = [0, 7, -5].map((det, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth'; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.4; o.connect(g); g.connect(eng); o.start(); return o;
    });
    // Exhaust rumble: brown noise amplitude-modulated at the firing rate
    const rumbleSrc = ctx.createBufferSource(); rumbleSrc.buffer = noiseBuffer(ctx, 2, true); rumbleSrc.loop = true;
    const rumbleAM = ctx.createGain(); rumbleAM.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; const lfoG = ctx.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(rumbleAM.gain); lfo.start();
    rumbleSrc.connect(rumbleAM); rumbleAM.connect(eng); rumbleSrc.start();
    // Propeller swish: band-passed noise
    const propSrc = ctx.createBufferSource(); propSrc.buffer = noiseBuffer(ctx); propSrc.loop = true;
    const propBp = ctx.createBiquadFilter(); propBp.type = 'bandpass'; propBp.Q.value = 0.8;
    const propG = ctx.createGain(); propG.gain.value = 0;
    propSrc.connect(propBp); propBp.connect(propG); propG.connect(cabin); propSrc.start();
    // Wind
    const windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuffer(ctx); windSrc.loop = true;
    const windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 600; windF.Q.value = 0.5;
    const windG = ctx.createGain(); windG.gain.value = 0;
    windSrc.connect(windF); windF.connect(windG); windG.connect(master); windSrc.start();
    // Stall horn: reed-like tone with vibrato
    const horn = ctx.createOscillator(); horn.type = 'square'; horn.frequency.value = 1550;
    const vib = ctx.createOscillator(); vib.frequency.value = 22; const vibG = ctx.createGain(); vibG.gain.value = 30; vib.connect(vibG); vibG.connect(horn.frequency); vib.start();
    const hornF = ctx.createBiquadFilter(); hornF.type = 'bandpass'; hornF.frequency.value = 1550; hornF.Q.value = 4;
    const hornG = ctx.createGain(); hornG.gain.value = 0;
    horn.connect(hornF); hornF.connect(hornG); hornG.connect(master); horn.start();
    // Starter motor whine
    const st = ctx.createOscillator(); st.type = 'sawtooth'; st.frequency.value = 180;
    const stG = ctx.createGain(); stG.gain.value = 0; const stF = ctx.createBiquadFilter(); stF.type = 'lowpass'; stF.frequency.value = 900;
    st.connect(stF); stF.connect(stG); stG.connect(cabin); st.start();
    // Tire squeal
    const tireSrc = ctx.createBufferSource(); tireSrc.buffer = noiseBuffer(ctx); tireSrc.loop = true;
    const tireF = ctx.createBiquadFilter(); tireF.type = 'bandpass'; tireF.frequency.value = 2400; tireF.Q.value = 6;
    const tireG = ctx.createGain(); tireG.gain.value = 0;
    tireSrc.connect(tireF); tireF.connect(tireG); tireG.connect(master); tireSrc.start();
    // Footsteps and fuel nozzle
    const fuelSrc = ctx.createBufferSource(); fuelSrc.buffer = noiseBuffer(ctx); fuelSrc.loop = true;
    const fuelF = ctx.createBiquadFilter(); fuelF.type = 'lowpass'; fuelF.frequency.value = 700;
    const fuelG = ctx.createGain(); fuelG.gain.value = 0;
    fuelSrc.connect(fuelF); fuelF.connect(fuelG); fuelG.connect(master); fuelSrc.start();
    nodes = { master, cabin, eng, engFilter, oscs, lfo, propBp, propG, windG, windF, hornG, stG, st, tireG, fuelG, rumbleAM };
  }
  const set = (param, v, t = 0.08) => { if (ctx) param.setTargetAtTime(v, ctx.currentTime, t); };

  return {
    start,
    get ready() { return !!ctx; },
    setMuted(m) { muted = m; if (nodes) set(nodes.master.gain, m ? 0 : 0.9, 0.05); },
    get muted() { return muted; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    // f: flight state, inside: camera in the cockpit, dist: camera distance from the airplane
    update(f, { inside, dist = 0, fueling = false }) {
      if (!nodes) return;
      const rpm = f ? f.rpm : 0;
      const fire = Math.max(1, rpm / 60 * 2);       // 4-cylinder 4-stroke: 2 firings per revolution
      nodes.oscs[0].frequency.setTargetAtTime(fire, ctx.currentTime, 0.05);
      nodes.oscs[1].frequency.setTargetAtTime(fire * 2, ctx.currentTime, 0.05);
      nodes.oscs[2].frequency.setTargetAtTime(fire / 2, ctx.currentTime, 0.05);
      nodes.lfo.frequency.setTargetAtTime(fire, ctx.currentTime, 0.05);
      const atten = inside ? 1 : 1 / (1 + Math.max(0, dist - 6) / 12);
      const running = f && f.running;
      const load = f ? Math.min(1, Math.max(0, f.thrust / 2300)) : 0;
      set(nodes.eng.gain, (running ? 0.14 + 0.16 * load : rpm > 50 ? 0.08 : 0) * atten);
      set(nodes.engFilter.frequency, 220 + rpm * 0.35 + load * 500);
      set(nodes.cabin.frequency, inside ? 1300 : 6000);
      nodes.propBp.frequency.setTargetAtTime(Math.max(60, rpm / 60 * 2 * 4), ctx.currentTime, 0.05);
      set(nodes.propG.gain, Math.min(0.12, rpm / 2700 * 0.12) * atten);
      const ias = f ? f.ias : 0;
      set(nodes.windG.gain, Math.min(0.35, (ias / 60) ** 2 * 0.25) * (inside ? 0.6 : 1));
      set(nodes.windF.frequency, 300 + ias * 12);
      set(nodes.hornG.gain, f && f.stallHorn > 0.05 && f.bus ? 0.06 * f.stallHorn : 0, 0.03);
      set(nodes.stG.gain, f && f.starter ? 0.07 * atten : 0, 0.03);
      nodes.st.frequency.setTargetAtTime(120 + rpm * 0.6, ctx.currentTime, 0.05);
      set(nodes.tireG.gain, f && f.tireSkid > 0 ? Math.min(0.08, f.tireSkid * 0.03) * atten : 0, 0.02);
      set(nodes.fuelG.gain, fueling ? 0.05 : 0, 0.05);
    },
    thump(strength = 1) {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 70; o.type = 'sine';
      g.gain.setValueAtTime(0.4 * strength, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.connect(g); g.connect(nodes.master); o.start(); o.stop(ctx.currentTime + 0.4);
    },
    click() {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1800; o.type = 'square';
      g.gain.setValueAtTime(0.05, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
      o.connect(g); g.connect(nodes.master); o.start(); o.stop(ctx.currentTime + 0.04);
    },
  };
}
