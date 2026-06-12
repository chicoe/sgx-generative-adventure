// Tiny retro-computer feedback sounds, synthesized with WebAudio — no audio
// assets, no voice, no typing sounds. Square/triangle blips in the spirit of
// early-80s terminals; the airlock is a low clunk plus a filtered noise hiss.
// Client-only (no-ops during SSR); the AudioContext is created lazily on the
// first cue, which always follows a key press, so autoplay policy is satisfied
// (the kiosk lifts it entirely via --autoplay-policy=no-user-gesture-required).

export type SfxName = 'send' | 'receive' | 'use' | 'map' | 'door' | 'unlock';

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
		case 'map': // sonar-ish downward ping: the deck plan toggled
			tone(c, { freq: 1175, to: 588, dur: 0.28, type: 'sine', vol: 0.18 });
			break;
		case 'door': // airlock: a low clunk + a pressurised hiss sweeping shut
			tone(c, { freq: 90, dur: 0.12, vol: 0.08 });
			noise(c, { at: 0.05, dur: 0.5, from: 1500, to: 150 });
			break;
		case 'unlock': // ascending major arpeggio: something opened up
			tone(c, { freq: 523, dur: 0.07 });
			tone(c, { at: 0.08, freq: 659, dur: 0.07 });
			tone(c, { at: 0.16, freq: 784, dur: 0.1 });
			break;
	}
}
