export const DANGER_LEVELS = [
  { id: 1, name: 'Petite brise', minutes: 15, description: 'Un petit courant d’air serait le bienvenu.', color: '#d5a52e' },
  { id: 2, name: 'Nuage suspect', minutes: 30, description: 'Quelque chose flotte dans l’atmosphère.', color: '#eb9142' },
  { id: 3, name: 'Zone toxique', minutes: 60, description: 'Inspiration profonde déconseillée.', color: '#e36655' },
  { id: 4, name: 'Radioactif', minutes: 90, description: 'Le compteur Geiger s’emballe.', color: '#9a6bc1' },
] as const;

export const CLEANLINESS = [
  { id: 'clean', name: 'Propre', description: 'Tout va bien, la voie est libre.' },
  { id: 'degraded', name: 'Dégradé', description: 'Saletés ou traces : un nettoyage est nécessaire.' },
  { id: 'dangerous', name: 'Dangereux', description: 'Très sale : à éviter en attendant le nettoyage.' },
  { id: 'critical', name: 'Critique', description: 'Inutilisable : une intervention est nécessaire.' },
] as const;

export type Cleanliness = typeof CLEANLINESS[number]['id'];
export type DangerLevel = 0 | 1 | 2 | 3 | 4;

export const TOILETS = [
  { id: 'N-H1', label: 'N1', name: 'WC Nord 1', zone: 'Nord', room: 'Femmes', x: 706, y: 177, accessible: false },
  { id: 'N-F1', label: 'N2', name: 'WC Nord 2', zone: 'Nord', room: 'Hommes', x: 706, y: 280, accessible: false },
  { id: 'N-F2', label: 'N3', name: 'WC Nord 3', zone: 'Nord', room: 'Hommes', x: 706, y: 357, accessible: false },
  { id: 'N-F3', label: 'N4', name: 'WC Nord 4', zone: 'Nord', room: 'Hommes', x: 756, y: 357, accessible: false },
  { id: 'N-F4', label: 'N5', name: 'WC Nord 5', zone: 'Nord', room: 'Hommes', x: 806, y: 357, accessible: false },
  { id: 'S-H1', label: 'S1', name: 'WC Sud 1', zone: 'Sud', room: 'Hommes', x: 303, y: 559, accessible: true },
  { id: 'S-F1', label: 'S2', name: 'WC Sud 2', zone: 'Sud', room: 'Hommes', x: 371, y: 550, accessible: true },
  { id: 'S-F2', label: 'S3', name: 'WC Sud 3', zone: 'Sud', room: 'Hommes', x: 435, y: 550, accessible: true },
  { id: 'S-F3', label: 'S4', name: 'WC Sud 4', zone: 'Sud', room: 'Hommes', x: 435, y: 602, accessible: true },
  { id: 'S-F4', label: 'S5', name: 'WC Sud 5', zone: 'Sud', room: 'Hommes', x: 435, y: 654, accessible: false },
] as const;

export type Toilet = typeof TOILETS[number] & {
  dangerLevel: DangerLevel;
  dangerUntil: number | null;
  cleanliness: Cleanliness;
};

export interface Snapshot {
  toilets: Toilet[];
  serverTime: number;
  resetsAt: number;
}

export function activeDangerLevel(level: DangerLevel, until: number | null, now: number): DangerLevel {
  if (level === 0 || until === null || until <= now) return 0;

  const minutesRemaining = (until - now) / 60_000;
  let activeLevel: Exclude<DangerLevel, 0> = level;
  while (activeLevel > 1 && minutesRemaining <= DANGER_LEVELS[activeLevel - 2].minutes) {
    activeLevel = (activeLevel - 1) as Exclude<DangerLevel, 0>;
  }
  return activeLevel;
}

export function statusColor(toilet: Toilet): string {
  if (toilet.cleanliness === 'critical') return '#bf4456';
  if (toilet.cleanliness === 'dangerous') return '#e36655';
  if (toilet.dangerLevel) return DANGER_LEVELS[toilet.dangerLevel - 1].color;
  if (toilet.cleanliness === 'degraded') return '#d5a52e';
  return '#2e9d80';
}
