// 背景音樂、環境音與音效：全部用 Web Audio 即時合成（沒有下載任何音樂檔）
// 音樂：D 宮五聲音階（宮商角徵羽）的古箏撥弦＋低音持續音，慢慢隨機生成。

const SCALE = [0, 2, 4, 7, 9]; // 五聲音階（半音）
const BASE = 293.66;           // D4
const note = (deg, oct = 0) => BASE * Math.pow(2, (SCALE[((deg % 5) + 5) % 5] + 12 * (oct + Math.floor(deg / 5))) / 12);

export class Sound {
  constructor(prefs = {}) {
    this.musicOn = prefs.music !== false;
    this.sfxOn = prefs.sfx !== false;
    this.volume = prefs.volume ?? .7;
    this.ctx = null;
    this.mood = 'day';
    this.amb = 'sea';
    this.ready = false;
  }
  // 瀏覽器規定要使用者先點一下才能出聲
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? .55 : 0; this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxOn ? .9 : 0; this.sfxBus.connect(this.master);
      this.ambBus = ctx.createGain(); this.ambBus.gain.value = this.sfxOn ? .5 : 0; this.ambBus.connect(this.master);
      // 溫暖的殘響（用雜訊做的短 IR）
      this.verb = ctx.createConvolver(); this.verb.buffer = this.makeIR(2.4);
      this.verbGain = ctx.createGain(); this.verbGain.gain.value = .35;
      this.verb.connect(this.verbGain).connect(this.master);
      this.noise = this.makeNoise();
      this.startAmbience();
      this.startMusic();
      this.ready = true;
    } catch (e) { this.ctx = null; }
  }
  makeNoise() {
    const ctx = this.ctx, len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  makeIR(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return b;
  }
  setMusic(on) { this.musicOn = on; if (this.ctx) this.ramp(this.musicBus.gain, on ? .55 : 0, .8); }
  setSfx(on) { this.sfxOn = on; if (this.ctx) { this.ramp(this.sfxBus.gain, on ? .9 : 0, .3); this.ramp(this.ambBus.gain, on ? .5 : 0, .8); } }
  setVolume(v) { this.volume = v; if (this.ctx) this.ramp(this.master.gain, v, .2); }
  setMood(m) { this.mood = m; }
  ramp(param, v, t) { const now = this.ctx.currentTime; param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); param.linearRampToValueAtTime(v, now + t); }

  // ---------- 樂器 ----------
  pluck(freq, t, dur = 1.6, vol = .2, bus = this.musicBus, bright = 2600) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'sawtooth';
    o1.frequency.setValueAtTime(freq * 1.012, t); o1.frequency.exponentialRampToValueAtTime(freq, t + .08);
    o2.frequency.setValueAtTime(freq * 2.003, t);
    const g2 = ctx.createGain(); g2.gain.value = .12;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(500, t + dur * .6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .006); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o1.connect(f); o2.connect(g2).connect(f); f.connect(g); g.connect(bus); g.connect(this.verb);
    o1.start(t); o2.start(t); o1.stop(t + dur + .05); o2.stop(t + dur + .05);
  }
  bell(freq, t, dur = 1.2, vol = .15, bus = this.sfxBus) {
    const ctx = this.ctx;
    [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, a]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + .004); g.gain.exponentialRampToValueAtTime(.0005, t + dur / m * 1.5);
      o.connect(g); g.connect(bus); g.connect(this.verb); o.start(t); o.stop(t + dur * 1.6);
    });
  }
  tone(freq, t, dur, vol, type = 'sine', bus = this.sfxBus, toFreq) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + .05);
  }
  noiseBurst(t, dur, vol, type = 'bandpass', freq = 1200, q = 1, bus = this.sfxBus, toFreq) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, t + dur); f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(.05, dur / 3)); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    s.connect(f).connect(g).connect(bus); s.start(t, Math.random()); s.stop(t + dur + .05);
  }
  chirp(t, vol = .06, bus = this.sfxBus) {
    const n = 2 + Math.floor(Math.random() * 3), base = 2800 + Math.random() * 1800;
    for (let i = 0; i < n; i++) this.tone(base, t + i * .09, .07, vol, 'sine', bus, base * (1.3 + Math.random() * .3));
  }

  // ---------- 背景音樂（五聲音階、隨機生成） ----------
  startMusic() {
    const ctx = this.ctx;
    // 低音持續音（D 與 A），慢慢呼吸
    const pad = ctx.createGain(); pad.gain.value = .0; pad.connect(this.musicBus);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.connect(pad);
    [[73.42, 0], [110, 3], [146.83, -4]].forEach(([fr, det]) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr; o.detune.value = det; o.connect(f); o.start(); });
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .07; lg.gain.value = .025; lfo.connect(lg).connect(pad.gain); lfo.start();
    pad.gain.setValueAtTime(0, ctx.currentTime); pad.gain.linearRampToValueAtTime(.05, ctx.currentTime + 4);
    this.pad = pad;
    // 撥弦旋律
    this.nextBeat = ctx.currentTime + 1;
    this.deg = 5; this.beat = 0;
    this.timer = setInterval(() => this.schedule(), 120);
  }
  schedule() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const night = this.mood === 'night', dusk = this.mood === 'dusk';
    const beatLen = night ? .95 : dusk ? .85 : .72;
    while (this.nextBeat < ctx.currentTime + .4) {
      const t = this.nextBeat, b = this.beat++;
      if (b % 16 === 0) this.pluck(note(0, -1), t, 3.2, .16, this.musicBus, 900);                // 每小節一個低音
      if (b % 16 === 8) this.pluck(note(3, -1), t, 3, .12, this.musicBus, 900);
      const play = Math.random() < (night ? .42 : .6);
      if (play) {
        this.deg += [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
        this.deg = Math.max(night ? 2 : 3, Math.min(night ? 8 : 11, this.deg));
        const v = .1 + Math.random() * .06;
        this.pluck(note(this.deg), t + (Math.random() - .5) * .03, night ? 2.4 : 1.8, v, this.musicBus, night ? 1600 : 2600);
        if (Math.random() < .18) this.pluck(note(this.deg + 2), t + beatLen / 2, 1.4, v * .6, this.musicBus, 2200); // 小裝飾音
      }
      this.nextBeat += beatLen;
    }
  }

  // ---------- 環境音 ----------
  startAmbience() {
    const ctx = this.ctx;
    const layer = (type, freq, q, lfoRate, lfoDepth) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.ambBus); s.start(0, Math.random() * 1.5);
      if (lfoRate) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = lfoRate; lg.gain.value = lfoDepth; l.connect(lg).connect(f.frequency); l.start(); }
      return g;
    };
    this.layers = {
      sea: layer('lowpass', 420, .7, .09, 160),
      wind: layer('bandpass', 520, .8, .13, 260),
      stream: layer('bandpass', 2600, .6, 1.7, 500),
      fountain: layer('highpass', 3000, .5, 2.3, 600)
    };
    // 夜晚的蟲鳴
    const ins = ctx.createOscillator(); ins.type = 'sine'; ins.frequency.value = 4600;
    const am = ctx.createGain(); am.gain.value = 0;
    const amo = ctx.createOscillator(), amg = ctx.createGain(); amo.frequency.value = 22; amg.gain.value = .5; amo.connect(amg).connect(am.gain);
    const insG = ctx.createGain(); insG.gain.value = 0;
    ins.connect(am).connect(insG).connect(this.ambBus); ins.start(); amo.start();
    this.layers.insects = insG;
    this.birdTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.sfxOn) return;
      if (this.mood !== 'night' && Math.random() < (this.amb === 'forest' || this.amb === 'garden' ? .5 : .25)) this.chirp(this.ctx.currentTime + Math.random(), .025, this.ambBus);
    }, 1800);
    this.setAmbience(this.amb);
  }
  setAmbience(kind, mood) {
    this.amb = kind; if (mood) this.mood = mood;
    if (!this.ctx || !this.layers) return;
    const L = { sea: .5, wind: 0, stream: 0, fountain: 0, insects: 0 };
    if (kind === 'forest') Object.assign(L, { sea: .15, wind: .55 });
    if (kind === 'stream') Object.assign(L, { sea: .1, stream: .32, wind: .12 });
    if (kind === 'plaza') Object.assign(L, { sea: .22, fountain: .1 });
    if (kind === 'garden') Object.assign(L, { sea: .2, wind: .2 });
    if (this.mood === 'night') L.insects = .012;
    for (const [k, g] of Object.entries(this.layers)) this.ramp(g.gain, L[k] ?? 0, 1.5);
  }

  // ---------- 音效 ----------
  play(name) {
    if (!this.ctx || !this.sfxOn || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + .01;
    const P = (d, o = 0) => note(d, o);
    switch (name) {
      case 'tick': this.tone(1500, t, .04, .05, 'sine'); break;
      case 'open': this.pluck(P(5), t, .8, .12, this.sfxBus); this.pluck(P(7), t + .07, .9, .1, this.sfxBus); break;
      case 'close': this.pluck(P(7), t, .6, .08, this.sfxBus); this.pluck(P(5), t + .06, .7, .08, this.sfxBus); break;
      case 'correct': this.bell(P(7), t, 1, .14); this.bell(P(10), t + .11, 1.3, .16); break;
      case 'wrong': this.tone(220, t, .28, .1, 'triangle', this.sfxBus, 170); break;
      case 'discover': [5, 7, 8, 10, 12].forEach((d, i) => this.bell(P(d), t + i * .07, 1, .08)); this.noiseBurst(t, .6, .03, 'highpass', 6000, .5); break;
      case 'stamp': this.tone(120, t, .25, .3, 'sine', this.sfxBus, 55); [0, 2, 4].forEach((d, i) => this.pluck(P(d + 5), t + .12 + i * .05, 1.6, .12, this.sfxBus)); break;
      case 'levelup': [0, 2, 3, 5, 7, 10].forEach((d, i) => this.bell(P(d + 5), t + i * .09, 1.1, .1)); break;
      case 'shell': this.tone(500, t, .18, .12, 'sine', this.sfxBus, 1100); this.tone(900, t + .08, .2, .08, 'sine', this.sfxBus, 1600); break;
      case 'trade': this.bell(1320, t, .5, .1); this.bell(1760, t + .1, .6, .1); break;
      case 'step': this.noiseBurst(t, .07, .035, 'lowpass', 700, .7); break;
      case 'chirp': for (let i = 0; i < 4; i++) this.chirp(t + i * .35 + Math.random() * .2, .07); break;
      case 'murmur': // 遠處的人聲：一段一段像說話的濾波雜訊
        for (let i = 0; i < 9; i++) { const st = t + i * .23 + Math.random() * .1; this.noiseBurst(st, .2, .06, 'bandpass', 500 + Math.random() * 600, 4, this.sfxBus, 350 + Math.random() * 500); }
        break;
      case 'petals': for (let i = 0; i < 6; i++) this.bell(P(8 + Math.floor(Math.random() * 5)), t + i * .16 + Math.random() * .08, .9, .045); break;
      case 'water': this.noiseBurst(t, 1.4, .12, 'bandpass', 1800, .8, this.sfxBus, 900); this.tone(700, t + .1, .15, .05, 'sine', this.sfxBus, 1400); break;
      case 'moon': { const ctx = this.ctx; [P(0, 0), P(2, 0), P(4, 0)].forEach(fr => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = fr; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + 1.2); g.gain.exponentialRampToValueAtTime(.001, t + 3.5); o.connect(g); g.connect(this.sfxBus); g.connect(this.verb); o.start(t); o.stop(t + 3.6); }); break; }
      case 'wind': this.noiseBurst(t, 2.6, .12, 'bandpass', 400, .7, this.sfxBus, 1100); break;
      case 'door': this.tone(90, t, .5, .12, 'sawtooth', this.sfxBus, 140); this.noiseBurst(t, .4, .04, 'bandpass', 900, 3); break;
      case 'whoosh': this.noiseBurst(t, 1.2, .1, 'bandpass', 300, 1, this.sfxBus, 2400); break;
      case 'page': for (let i = 0; i < 3; i++) this.noiseBurst(t + i * .12, .12, .05, 'highpass', 3000, .7); break;
      case 'hop': this.tone(300, t, .15, .1, 'sine', this.sfxBus, 700); break;
      default: break;
    }
  }
}
