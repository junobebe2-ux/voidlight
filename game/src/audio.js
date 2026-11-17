// All sound is synthesised here with WebAudio — no audio files. Short oscillator blips
// and filtered noise bursts for the effects, plus a quiet two-oscillator pad that hums
// underneath while the game runs. The context is created on the first user gesture
// (unlock), so browsers never autoplay before the player has pressed a key.

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let pad = null;
  let muted = false;

  function ensure() {
    if (context !== null) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(context.destination);
      const length = Math.floor(context.sampleRate * 0.5);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  /** Create the context (call from a user gesture) and resume it if it was suspended. */
  function unlock() {
    if (!ensure()) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    startPad();
  }

  function tone(freq, endFreq, duration, type, volume, when) {
    if (context === null) return;
    const t0 = context.currentTime + (when ?? 0);
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noise(duration, filterFreq, volume, when, type) {
    if (context === null) return;
    const t0 = context.currentTime + (when ?? 0);
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type ?? 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
    source.stop(t0 + duration + 0.02);
  }

  function startPad() {
    if (context === null || pad !== null) return;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.035, context.currentTime + 2);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const oscA = context.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 55;
    const oscB = context.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 82.41;
    const oscC = context.createOscillator();
    oscC.type = 'sine';
    oscC.frequency.value = 110.3;
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 0.014;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    oscA.connect(filter);
    oscB.connect(filter);
    oscC.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    oscA.start();
    oscB.start();
    oscC.start();
    lfo.start();
    pad = { gain, oscs: [oscA, oscB, oscC, lfo] };
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master !== null) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    shoot() {
      if (!ensure()) return;
      tone(920, 420, 0.07, 'square', 0.045);
    },
    hit() {
      if (!ensure()) return;
      tone(170, 55, 0.28, 'sawtooth', 0.22);
      noise(0.18, 240, 0.2, 0, 'lowpass');
    },
    kill(kind) {
      if (!ensure()) return;
      if (kind === 'brute') {
        tone(220, 40, 0.5, 'sawtooth', 0.2);
        noise(0.4, 300, 0.22, 0, 'lowpass');
      } else if (kind === 'splitter') {
        tone(520, 180, 0.14, 'triangle', 0.12);
        noise(0.12, 900, 0.12);
      } else {
        tone(660, 240, 0.1, 'triangle', 0.09);
        noise(0.08, 1400, 0.08);
      }
    },
    shard() {
      if (!ensure()) return;
      tone(1320, 1760, 0.09, 'sine', 0.06);
    },
    level() {
      if (!ensure()) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => tone(freq, freq, 0.22, 'sine', 0.1, i * 0.07));
    },
    nova() {
      if (!ensure()) return;
      tone(110, 38, 0.6, 'sine', 0.3);
      noise(0.5, 700, 0.18, 0, 'lowpass');
      tone(880, 1760, 0.3, 'sine', 0.07);
    },
    death() {
      if (!ensure()) return;
      const notes = [392, 311.13, 261.63, 196];
      notes.forEach((freq, i) => tone(freq, freq * 0.94, 0.5, 'triangle', 0.14, i * 0.16));
    },
    click() {
      if (!ensure()) return;
      tone(700, 700, 0.05, 'sine', 0.08);
    },
  };
}
