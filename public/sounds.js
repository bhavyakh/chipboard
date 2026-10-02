// Synthesised sound effects — no audio files needed.
// Sounds.play('airhorn') for a built-in, or Sounds.play('media/horn.mp3') for your own file.
(function () {
  let ctx = null;
  let out = null;

  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      out = ctx.createDynamicsCompressor();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      out.connect(master);
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function lowpass(c, freq, dest = out) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.connect(dest);
    return f;
  }

  function tone(c, dest, o) {
    const { type = 'sine', freq, start = 0, dur = 0.3, vol = 0.4, attack = 0.01, release = 0.08, slideTo } = o;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return osc;
  }

  let noiseBuf = null;
  function noise(c, dest, o) {
    const { start = 0, dur = 0.4, vol = 0.3, type = 'bandpass', freq = 1000, q = 1, sweepTo } = o;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + start;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + dur);
  }

  const synths = {
    ding(c) {
      tone(c, out, { freq: 1318, dur: 1.4, vol: 0.45, release: 1.3 });
      tone(c, out, { freq: 1976, dur: 0.9, vol: 0.15, release: 0.8 });
    },

    tick(c) {
      tone(c, out, { type: 'square', freq: 1200, dur: 0.05, vol: 0.15, release: 0.04 });
    },

    chaching(c) {
      noise(c, out, { dur: 0.08, vol: 0.5, type: 'highpass', freq: 5000 });
      tone(c, out, { type: 'triangle', freq: 2093, start: 0.02, dur: 0.12, vol: 0.3 });
      tone(c, out, { type: 'triangle', freq: 2637, start: 0.13, dur: 0.7, vol: 0.3, release: 0.6 });
      tone(c, out, { type: 'triangle', freq: 3136, start: 0.13, dur: 0.6, vol: 0.15, release: 0.5 });
      noise(c, out, { start: 0.13, dur: 0.8, vol: 0.2, freq: 9000, q: 3 });
    },

    airhorn(c) {
      const f = lowpass(c, 2800);
      [[0, 0.32], [0.42, 0.32], [0.84, 1.1]].forEach(([start, dur]) => {
        [349, 352, 440, 443, 523].forEach((freq) =>
          tone(c, f, { type: 'sawtooth', freq, start, dur, vol: 0.09, attack: 0.02, release: 0.06 })
        );
      });
    },

    buzzer(c) {
      const f = lowpass(c, 1400);
      tone(c, f, { type: 'square', freq: 110, dur: 1.1, vol: 0.3 });
      tone(c, f, { type: 'square', freq: 117, dur: 1.1, vol: 0.3 });
    },

    sadtrombone(c) {
      const f = lowpass(c, 1100);
      const notes = [[392, 0], [370, 0.5], [349, 1.0]];
      notes.forEach(([freq, start]) =>
        tone(c, f, { type: 'sawtooth', freq, start, dur: 0.45, vol: 0.35, attack: 0.04 })
      );
      const last = tone(c, f, { type: 'sawtooth', freq: 330, start: 1.5, dur: 1.6, vol: 0.35, attack: 0.04, release: 0.5 });
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = 9;
      lfo.connect(depth);
      depth.connect(last.frequency);
      lfo.start(c.currentTime + 1.7);
      lfo.stop(c.currentTime + 3.2);
    },

    drumroll(c) {
      const len = 1.8;
      for (let t = 0; t < len; t += 0.045) {
        noise(c, out, { start: t, dur: 0.07, vol: 0.08 + 0.3 * (t / len), freq: 1800, q: 0.7 });
      }
      tone(c, out, { freq: 90, slideTo: 40, start: len + 0.02, dur: 0.5, vol: 0.8, release: 0.45 });
      noise(c, out, { start: len + 0.02, dur: 2.0, vol: 0.5, type: 'highpass', freq: 4000 });
    },

    applause(c) {
      for (let i = 0; i < 260; i++) {
        const start = Math.random() * 3;
        const fade = start > 2.2 ? 1 - (start - 2.2) / 0.8 : Math.min(1, start / 0.3 + 0.3);
        noise(c, out, { start, dur: 0.03 + Math.random() * 0.03, vol: 0.25 * fade * Math.random(), freq: 1200 + Math.random() * 2500, q: 1.2 });
      }
    },

    rimshot(c) {
      tone(c, out, { freq: 200, slideTo: 110, dur: 0.18, vol: 0.6 });
      noise(c, out, { dur: 0.12, vol: 0.2, freq: 2500 });
      tone(c, out, { freq: 160, slideTo: 90, start: 0.22, dur: 0.2, vol: 0.6 });
      noise(c, out, { start: 0.22, dur: 0.12, vol: 0.2, freq: 2500 });
      noise(c, out, { start: 0.5, dur: 1.1, vol: 0.45, type: 'highpass', freq: 7000 });
    },

    fanfare(c) {
      const f = lowpass(c, 3200);
      const notes = [[523, 0, 0.16], [659, 0.16, 0.16], [784, 0.32, 0.16], [1047, 0.48, 0.25], [784, 0.75, 0.14], [1047, 0.9, 1.0]];
      notes.forEach(([freq, start, dur]) => {
        tone(c, f, { type: 'sawtooth', freq, start, dur, vol: 0.18, attack: 0.02 });
        tone(c, f, { type: 'square', freq: freq / 2, start, dur, vol: 0.06, attack: 0.02 });
      });
    },

    whoosh(c) {
      noise(c, out, { dur: 0.6, vol: 0.4, freq: 300, sweepTo: 5000, q: 2 });
    },
  };

  const fileCache = {};

  window.Sounds = {
    unlock() {
      ac();
    },
    names: Object.keys(synths),
    play(name) {
      if (!name) return;
      if (/\.(mp3|wav|m4a|ogg)$/i.test(name)) {
        const src = name.startsWith('/') ? name : '/' + name;
        const a = fileCache[src] ? fileCache[src].cloneNode() : (fileCache[src] = new Audio(src));
        a.play().catch(() => {});
        return;
      }
      const s = synths[name];
      if (s) s(ac());
      else console.warn('Unknown sound:', name);
    },
  };
})();
