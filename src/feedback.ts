import type { Cleanliness } from '../shared/domain';

export type SoundName =
  | 'flush' | 'squeak' | 'toot' | 'fart' | 'squelch' | 'flies' | 'nuclear' | 'clog' | 'knock';

export interface ReportFeedback {
  title: string;
  shout: string;
  message: string;
  emoji: string;
  tone: 'fresh' | 'breeze' | 'cloud' | 'toxic' | 'radioactive';
  sound: SoundName;
  color: string;
}

export const DANGER_EMOJI = ['🌬️', '☁️', '☣️', '☢️'] as const;
export const CLEANLINESS_EMOJI: Record<Cleanliness, string> = { clean: '✨', degraded: '🧻', dangerous: '💩', critical: '🚨' };

export function reportFeedback(kind: 'danger' | 'cleanliness', level: number | Cleanliness): ReportFeedback {
  if (kind === 'cleanliness') {
    switch (level) {
      case 'clean': return { title: 'Ça brille !', shout: 'Flouuush !', message: 'Chasse tirée, cuvette étincelante. Merci pour les suivants.', emoji: '✨', tone: 'fresh', sound: 'flush', color: '#2e9d80' };
      case 'degraded': return { title: 'Un coup de propre ?', shout: 'Prout.', message: 'Rien de dramatique, mais un passage de brosse ne ferait pas de mal.', emoji: '🧻', tone: 'breeze', sound: 'toot', color: '#d5a52e' };
      case 'dangerous': return { title: 'Terrain miné !', shout: 'Splortch !', message: 'Regardez où vous mettez les pieds. Un nettoyage sérieux s’impose.', emoji: '💩', tone: 'toxic', sound: 'squelch', color: '#e36655' };
      case 'critical': return { title: 'Alerte rouge !', shout: 'Glou… glou… plop !', message: 'Bouché, débordé ou pire. Ce petit coin a besoin d’un plombier.', emoji: '🚨', tone: 'radioactive', sound: 'clog', color: '#bf4456' };
    }
  } else {
    switch (level) {
      case 1: return { title: 'Petite brise !', shout: 'Pfuiit…', message: 'Un léger courant d’air. Rien qu’une fenêtre ouverte ne règle pas.', emoji: '🌬️', tone: 'breeze', sound: 'squeak', color: '#d5a52e' };
      case 2: return { title: 'Nuage en approche !', shout: 'Prrrout !', message: 'La météo locale se couvre. Laissez passer l’averse.', emoji: '☁️', tone: 'cloud', sound: 'fart', color: '#eb9142' };
      case 3: return { title: 'Zone toxique !', shout: 'Bzzz… Brrraaap !', message: 'Même les mouches font demi-tour. Petit détour conseillé.', emoji: '☣️', tone: 'toxic', sound: 'flies', color: '#e36655' };
      case 4: return { title: 'Radioactivité détectée !', shout: 'BRRRRROUUUM !', message: 'Le compteur Geiger s’affole. Évacuation recommandée pour 90 minutes.', emoji: '☢️', tone: 'radioactive', sound: 'nuclear', color: '#9a6bc1' };
    }
  }
  throw new Error('Signalement invalide pour le retour sonore et visuel.');
}

/* ------------------------------------------------------------------ */
/* Synthèse sonore Web Audio : aucun fichier, aucun service externe.  */
/* ------------------------------------------------------------------ */

export const MASTER_VOLUME = 0.35;

type Random = () => number;

class Rig {
  private nodes: AudioNode[] = [];
  private pending = 0;
  private noiseBuffer: AudioBuffer | null = null;
  readonly out: GainNode;
  end = 0;

  constructor(readonly ctx: BaseAudioContext, readonly random: Random) {
    const compressor = this.track(ctx.createDynamicsCompressor());
    compressor.connect(ctx.destination);
    this.out = this.track(ctx.createGain());
    this.out.gain.value = MASTER_VOLUME;
    this.out.connect(compressor);
  }

  track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  gain(value = 0) {
    const node = this.track(this.ctx.createGain());
    node.gain.value = value;
    return node;
  }

  filter(type: BiquadFilterType, frequency: number, q = 1) {
    const node = this.track(this.ctx.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  osc(type: OscillatorType, frequency: number) {
    const node = this.track(this.ctx.createOscillator());
    node.type = type;
    node.frequency.value = frequency;
    return node;
  }

  noise() {
    if (!this.noiseBuffer) {
      const length = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = this.random() * 2 - 1;
    }
    const node = this.track(this.ctx.createBufferSource());
    node.buffer = this.noiseBuffer;
    node.loop = true;
    return node;
  }

  /** Démarre une source et libère tout le graphe quand la dernière se termine. */
  play(source: AudioScheduledSourceNode, at: number, until: number) {
    this.pending++;
    this.end = Math.max(this.end, until);
    source.onended = () => {
      if (--this.pending === 0) this.nodes.forEach(node => node.disconnect());
    };
    source.start(at);
    source.stop(until);
  }

  /** Enveloppe attaque / maintien / relâchement sur un gain. */
  envelope(gain: GainNode, at: number, peak: number, attack: number, hold: number, release: number) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setValueAtTime(peak, at + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
    return at + attack + hold + release;
  }

  vary(value: number, amount = 0.12) {
    return value * (1 + (this.random() * 2 - 1) * amount);
  }
}

/** Un prout : oscillateur grave, fréquence instable, battement rapide et un peu de souffle. */
function fart(rig: Rig, at: number, { duration, pitch, flutter, wet, peak = 0.9, rise = 0 }: { duration: number; pitch: number; flutter: number; wet: number; peak?: number; rise?: number }) {
  const { ctx } = rig;
  const amp = rig.gain(0);
  const tone = rig.osc('sawtooth', pitch);
  const body = rig.filter('lowpass', rig.vary(pitch * 6, 0.2), 6);
  tone.connect(body).connect(amp);

  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = at + (duration * i) / steps;
    const drift = 1 - 0.25 * (i / steps) + rise * Math.pow(i / steps, 3);
    tone.frequency.linearRampToValueAtTime(rig.vary(pitch * drift, 0.18), t);
  }

  const lfo = rig.osc('square', rig.vary(flutter, 0.15));
  const depth = rig.gain(0.45);
  lfo.connect(depth).connect(amp.gain);
  lfo.frequency.linearRampToValueAtTime(flutter * 0.7, at + duration);

  if (wet > 0) {
    const hiss = rig.noise();
    const wetFilter = rig.filter('bandpass', rig.vary(450), 1.4);
    const wetGain = rig.gain(wet);
    hiss.connect(wetFilter).connect(wetGain).connect(amp);
    rig.play(hiss, at, at + duration + 0.1);
  }

  const env = rig.gain(0);
  amp.connect(env).connect(rig.out);
  const end = rig.envelope(env, at, peak, 0.025, Math.max(0, duration - 0.12), 0.1);
  amp.gain.setValueAtTime(0.55, at);
  rig.play(tone, at, end + 0.02);
  rig.play(lfo, at, end + 0.02);
  return end;
}

/** Bulle de siphon : sinus qui monte très vite. */
function bubble(rig: Rig, at: number, from: number, volume = 0.35) {
  const tone = rig.osc('sine', from);
  tone.frequency.setValueAtTime(from, at);
  tone.frequency.exponentialRampToValueAtTime(from * rig.vary(2.6, 0.2), at + 0.07);
  const env = rig.gain(0);
  tone.connect(env).connect(rig.out);
  const end = rig.envelope(env, at, volume, 0.005, 0.03, 0.05);
  rig.play(tone, at, end);
}

function flush(rig: Rig, at: number, duration = 2.2) {
  const water = rig.noise();
  const band = rig.filter('bandpass', 300, 0.7);
  const low = rig.filter('lowpass', 2600, 0.5);
  const env = rig.gain(0);
  water.connect(band).connect(low).connect(env).connect(rig.out);
  band.frequency.setValueAtTime(320, at);
  band.frequency.exponentialRampToValueAtTime(1500, at + 0.35);
  band.frequency.exponentialRampToValueAtTime(700, at + duration * 0.6);
  band.frequency.exponentialRampToValueAtTime(220, at + duration);
  const end = rig.envelope(env, at, 1, 0.18, duration * 0.45, duration * 0.5);
  rig.play(water, at, end);
  for (let i = 0; i < 9; i++) bubble(rig, at + duration * 0.45 + rig.random() * duration * 0.5, rig.vary(260, 0.35), 0.22);
  return end;
}

function sparkle(rig: Rig, at: number) {
  [1568, 2093, 2637].forEach((frequency, index) => {
    const ping = rig.osc('sine', frequency);
    const env = rig.gain(0);
    ping.connect(env).connect(rig.out);
    const start = at + index * 0.09;
    rig.play(ping, start, rig.envelope(env, start, 0.18, 0.005, 0.02, 0.35));
  });
}

function plop(rig: Rig, at: number) {
  const thump = rig.osc('sine', 180);
  thump.frequency.setValueAtTime(180, at);
  thump.frequency.exponentialRampToValueAtTime(55, at + 0.14);
  const env = rig.gain(0);
  thump.connect(env).connect(rig.out);
  rig.play(thump, at, rig.envelope(env, at, 1, 0.004, 0.02, 0.14));
  const click = rig.noise();
  const hp = rig.filter('highpass', 1800, 0.7);
  const clickEnv = rig.gain(0);
  click.connect(hp).connect(clickEnv).connect(rig.out);
  rig.play(click, at, rig.envelope(clickEnv, at, 0.4, 0.002, 0.005, 0.04));
}

function splash(rig: Rig, at: number) {
  const water = rig.noise();
  const band = rig.filter('bandpass', 1400, 0.9);
  band.frequency.setValueAtTime(2200, at);
  band.frequency.exponentialRampToValueAtTime(500, at + 0.35);
  const env = rig.gain(0);
  water.connect(band).connect(env).connect(rig.out);
  rig.play(water, at, rig.envelope(env, at, 0.9, 0.004, 0.04, 0.32));
}

function geiger(rig: Rig, at: number, duration: number) {
  let t = at;
  while (t < at + duration) {
    const click = rig.noise();
    const hp = rig.filter('highpass', 2500, 0.8);
    const env = rig.gain(0);
    click.connect(hp).connect(env).connect(rig.out);
    rig.play(click, t, rig.envelope(env, t, 0.55, 0.001, 0.002, 0.012));
    const progress = (t - at) / duration;
    t += 0.02 + rig.random() * (0.18 - 0.15 * progress);
  }
}

function buzz(rig: Rig, at: number, duration: number) {
  for (let fly = 0; fly < 2; fly++) {
    const wing = rig.osc('sawtooth', rig.vary(210 + fly * 45, 0.1));
    const vibrato = rig.osc('sine', rig.vary(7 + fly * 2, 0.2));
    const vibratoDepth = rig.gain(28);
    vibrato.connect(vibratoDepth).connect(wing.frequency);
    const band = rig.filter('bandpass', 950, 2);
    const env = rig.gain(0);
    wing.connect(band).connect(env).connect(rig.out);
    const start = at + fly * 0.18;
    const end = rig.envelope(env, start, 0.28, 0.2, duration - 0.5, 0.3);
    rig.play(wing, start, end);
    rig.play(vibrato, start, end);
  }
}

function siren(rig: Rig, at: number) {
  [660, 880, 660, 880].forEach((frequency, index) => {
    const tone = rig.osc('triangle', frequency);
    const env = rig.gain(0);
    tone.connect(env).connect(rig.out);
    const start = at + index * 0.22;
    rig.play(tone, start, rig.envelope(env, start, 0.22, 0.01, 0.16, 0.04));
  });
}

function knock(rig: Rig, at: number) {
  [0, 0.16].forEach(offset => {
    const start = at + offset;
    const wood = rig.osc('triangle', rig.vary(190, 0.05));
    wood.frequency.setValueAtTime(wood.frequency.value, start);
    wood.frequency.exponentialRampToValueAtTime(90, start + 0.08);
    const band = rig.filter('lowpass', 900, 1);
    const env = rig.gain(0);
    wood.connect(band).connect(env).connect(rig.out);
    rig.play(wood, start, rig.envelope(env, start, 0.8, 0.002, 0.01, 0.09));
  });
}

const RECIPES: Record<SoundName, (rig: Rig, at: number) => void> = {
  knock: (rig, at) => knock(rig, at),
  flush: (rig, at) => { const end = flush(rig, at); sparkle(rig, end - 0.4); },
  squeak: (rig, at) => { fart(rig, at, { duration: rig.vary(0.45), pitch: rig.vary(310, 0.15), flutter: 42, wet: 0.1, peak: 0.5, rise: 0.6 }); },
  toot: (rig, at) => {
    const end = fart(rig, at, { duration: 0.22, pitch: rig.vary(170), flutter: 34, wet: 0.15, peak: 0.6 });
    fart(rig, end + 0.08, { duration: 0.18, pitch: rig.vary(200), flutter: 38, wet: 0.1, peak: 0.45, rise: 0.4 });
  },
  fart: (rig, at) => { fart(rig, at, { duration: rig.vary(1.0, 0.15), pitch: rig.vary(115), flutter: 28, wet: 0.35, rise: 0.5 }); },
  squelch: (rig, at) => {
    const end = fart(rig, at, { duration: rig.vary(0.8), pitch: rig.vary(95), flutter: 22, wet: 1.1 });
    splash(rig, end - 0.05);
  },
  flies: (rig, at) => {
    const end = fart(rig, at, { duration: rig.vary(1.3, 0.1), pitch: rig.vary(80), flutter: 20, wet: 0.6, peak: 1 });
    buzz(rig, end - 0.2, 1.6);
  },
  nuclear: (rig, at) => {
    const end = fart(rig, at, { duration: 1.7, pitch: rig.vary(62, 0.08), flutter: 17, wet: 0.7, peak: 1, rise: 1.4 });
    geiger(rig, at + 0.3, end - at + 0.6);
  },
  clog: (rig, at) => {
    for (let i = 0; i < 7; i++) bubble(rig, at + i * 0.13 + rig.random() * 0.05, rig.vary(170, 0.3), 0.5);
    plop(rig, at + 1.05);
    plop(rig, at + 1.4);
    siren(rig, at + 1.75);
  },
};

/** Joue un son et renvoie sa durée en secondes. */
export function playFeedback(context: BaseAudioContext & { state: AudioContextState }, sound: SoundName, random: Random = Math.random): number {
  if (context.state !== 'running') throw new Error('La lecture audio est bloquée par le navigateur.');
  const rig = new Rig(context, random);
  const start = context.currentTime + 0.02;
  RECIPES[sound](rig, start);
  return rig.end - start;
}

export const SOUNDS = Object.keys(RECIPES) as SoundName[];

/** Émoji résumant l'état affiché d'un WC, selon la même priorité que la couleur. */
export function statusEmoji(toilet: { cleanliness: Cleanliness; dangerLevel: number }): string {
  if (toilet.cleanliness === 'critical' || toilet.cleanliness === 'dangerous') return CLEANLINESS_EMOJI[toilet.cleanliness];
  if (toilet.dangerLevel) return DANGER_EMOJI[toilet.dangerLevel - 1];
  if (toilet.cleanliness === 'degraded') return CLEANLINESS_EMOJI.degraded;
  return '';
}

/** Verdict affiché sur le « verrou » de la porte. */
export function verdict(toilet: { cleanliness: Cleanliness; dangerLevel: number }): { text: string; level: 'free' | 'careful' | 'avoid' } {
  if (toilet.cleanliness === 'critical' || toilet.cleanliness === 'dangerous' || toilet.dangerLevel >= 3) return { text: 'À éviter', level: 'avoid' };
  if (toilet.cleanliness === 'degraded' || toilet.dangerLevel > 0) return { text: 'Avec précaution', level: 'careful' };
  return { text: 'La voie est libre', level: 'free' };
}

/** Picto météo d'un WC : grand soleil quand tout va bien. */
export function weatherIcon(toilet: { cleanliness: Cleanliness; dangerLevel: number }): string {
  return statusEmoji(toilet) || '☀️';
}
