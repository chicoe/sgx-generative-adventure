// Tiny retro-computer feedback sounds, synthesized with WebAudio — no audio
// assets, no voice, no typing sounds. Square/triangle blips in the spirit of
// early-80s terminals; the airlock is a low clunk plus a filtered noise hiss.
// Client-only (no-ops during SSR); the AudioContext is created lazily on the
// first cue, which always follows a key press, so autoplay policy is satisfied
// (the kiosk lifts it entirely via --autoplay-policy=no-user-gesture-required).

export type SfxName = 'send' | 'receive' | 'use' | 'get' | 'map' | 'door' | 'unlock' | 'scan';

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	try {
		ctx ??= new AudioContext();
	} catch {
		return null; // no audio device / unsupported — sounds are best-effort
	}
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

interface ToneOpts {
	at?: number; // seconds from now
	freq: number; // Hz
	to?: number; // optional pitch slide target
	dur: number; // seconds
	type?: OscillatorType;
	vol?: number;
}

function tone(c: AudioContext, { at = 0, freq, to, dur, type = 'square', vol = 0.06 }: ToneOpts) {
	const t0 = c.currentTime + at;
	const o = c.createOscillator();
	const g = c.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq, t0);
	if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
	g.gain.setValueAtTime(vol, t0);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	o.connect(g);
	g.connect(c.destination);
	o.start(t0);
	o.stop(t0 + dur + 0.02);
}

interface NoiseOpts {
	at?: number;
	dur: number;
	from?: number; // lowpass sweep start (Hz)
	to?: number; // lowpass sweep end (Hz)
	vol?: number;
}

function noise(c: AudioContext, { at = 0, dur, from = 1500, to = 150, vol = 0.05 }: NoiseOpts) {
	const t0 = c.currentTime + at;
	const len = Math.ceil(c.sampleRate * dur);
	const buf = c.createBuffer(1, len, c.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
	const src = c.createBufferSource();
	src.buffer = buf;
	const f = c.createBiquadFilter();
	f.type = 'lowpass';
	f.frequency.setValueAtTime(from, t0);
	f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
	const g = c.createGain();
	g.gain.setValueAtTime(vol, t0);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	src.connect(f);
	f.connect(g);
	g.connect(c.destination);
	src.start(t0);
	src.stop(t0 + dur);
}

/**
 * True when the browser will allow sound RIGHT NOW — i.e. the autoplay policy
 * is lifted (kiosk flag) or the user has already interacted. A fresh page in a
 * normal browser reports false until the first key press / click.
 */
export function audioUnlocked(): boolean {
	const c = context();
	return !!c && c.state === 'running';
}

/**
 * A low, warm drone for the duration of the scanner sweep — so the scan always
 * has a sound even in a room with nothing to ping. Detuned saws through a slowly
 * sweeping lowpass, fading in and out. Safe to call anywhere (no-ops w/o audio).
 */
export function playDrone(durationMs: number): void {
	const c = context();
	if (!c) return;
	const t0 = c.currentTime;
	const dur = durationMs / 1000;
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t0);
	g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.6);
	g.gain.setValueAtTime(0.06, t0 + Math.max(0.7, dur - 0.8));
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	const f = c.createBiquadFilter();
	f.type = 'lowpass';
	f.frequency.setValueAtTime(200, t0);
	f.frequency.linearRampToValueAtTime(460, t0 + dur * 0.5);
	f.frequency.linearRampToValueAtTime(170, t0 + dur);
	f.connect(g);
	g.connect(c.destination);
	for (const [freq, detune] of [
		[55, 0],
		[55, 8],
		[110, -5]
	]) {
		const o = c.createOscillator();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(freq, t0);
		o.detune.setValueAtTime(detune, t0);
		o.connect(f);
		o.start(t0);
		o.stop(t0 + dur + 0.05);
	}
}

/** Fire a feedback cue. Safe to call anywhere — silently no-ops without audio. */
export function playSfx(name: SfxName): void {
	const c = context();
	if (!c) return;
	switch (name) {
		case 'send': // falling two-tone — the mirror image of 'receive'
			tone(c, { freq: 780, dur: 0.07 });
			tone(c, { at: 0.09, freq: 520, dur: 0.09 });
			break;
		case 'receive': // rising two-tone: the computer answered
			tone(c, { freq: 520, dur: 0.07 });
			tone(c, { at: 0.09, freq: 780, dur: 0.09 });
			break;
		case 'use': // triangle double-click: an item was activated
			tone(c, { freq: 330, dur: 0.06, type: 'triangle', vol: 0.22 });
			tone(c, { at: 0.07, freq: 494, dur: 0.09, type: 'triangle', vol: 0.22 });
			break;
		case 'get': // item acquired: a rising chip fanfare with an octave shimmer
			tone(c, { freq: 659, dur: 0.07, vol: 0.14 });
			tone(c, { at: 0.07, freq: 784, dur: 0.07, vol: 0.14 });
			tone(c, { at: 0.14, freq: 988, dur: 0.07, vol: 0.14 });
			tone(c, { at: 0.21, freq: 1319, dur: 0.24, vol: 0.16 });
			tone(c, { at: 0.21, freq: 2637, dur: 0.24, type: 'sine', vol: 0.07 });
			break;
		case 'map': // sonar-ish downward ping: the deck plan toggled
			tone(c, { freq: 1175, to: 588, dur: 0.28, type: 'sine', vol: 0.18 });
			break;
		case 'scan': {
			// Radar ping: a clean sine that slides down and rings out, with a quieter
			// delayed echo for the sweeping-dish feel. Fired once per scanned thing.
			tone(c, { freq: 1320, to: 760, dur: 0.34, type: 'sine', vol: 0.15 });
			tone(c, { at: 0.16, freq: 1320, to: 760, dur: 0.3, type: 'sine', vol: 0.05 });
			break;
		}
		case 'door': // full airlock cycle: bolt thunk → hiss → servo sweep → seated blip
			tone(c, { freq: 120, to: 45, dur: 0.22, vol: 0.22 });
			noise(c, { at: 0.08, dur: 0.7, from: 2200, to: 120, vol: 0.09 });
			tone(c, { at: 0.18, freq: 180, to: 620, dur: 0.4, type: 'triangle', vol: 0.1 });
			tone(c, { at: 0.62, freq: 880, dur: 0.1, vol: 0.12 });
			break;
		case 'unlock': // ascending major arpeggio: something opened up
			tone(c, { freq: 523, dur: 0.07 });
			tone(c, { at: 0.08, freq: 659, dur: 0.07 });
			tone(c, { at: 0.16, freq: 784, dur: 0.1 });
			break;
	}
}
