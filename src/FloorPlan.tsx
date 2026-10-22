import { CLEANLINESS, DANGER_LEVELS, statusColor, type Toilet } from '../shared/domain';
import type { CSSProperties } from 'react';
import { weatherIcon, type ReportFeedback } from './feedback';

interface Props {
  toilets: Toilet[];
  selected: string | null;
  onSelect: (id: string) => void;
  feedback: (ReportFeedback & { id: number; toiletId: string }) | null;
  now: number;
}

function Stairs({ x, y }: { x: number; y: number }) {
  return <g className="stairs">
    <rect x={x} y={y} width="90" height="94" rx="2" />
    {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M ${x + 10} ${y + 12 + i * 10} h 70`} />)}
    <path d={`M ${x + 45} ${y + 80} v -60 l -6 8 m 6 -8 l 6 8`} className="stair-arrow" />
  </g>;
}

/** Dessin statique du plan (sol, pièces, murs), partagé par les vues 2D et 3D. */
export function PlanArtwork() {
  return <>
    <defs>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M 48 0 H 0 V 48" fill="none" stroke="#ffffff" strokeOpacity=".07" strokeWidth="1" /></pattern>
      <pattern id="patio-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M 18 0 H 0 V 18" fill="none" stroke="#bcd8c4" strokeWidth=".6" /></pattern>
    </defs>
    <rect x="60" y="20" width="860" height="740" fill="url(#grid)" />
    <path d="M 130 65 H 870 V 635 H 830 V 720 H 130 Z" className="building" />
    <path d="M 170 140 H 540 M 170 185 H 475 M 170 230 H 440 M 170 640 V 680 H 230 M 535 670 H 765" className="office-lines" />
    <text x="295" y="116" className="map-muted">ESPACE BUREAUX</text>
    <text x="735" y="570" className="map-muted">CIRCULATION</text>
    <path d="M 240 330 V 450 M 600 110 H 625" className="circulation-line" />
    <rect x="365" y="292" width="270" height="228" className="patio" />
    <rect x="373" y="300" width="254" height="212" fill="url(#patio-grid)" />
    <circle cx="500" cy="398" r="42" fill="#d0e4d3" />
    <circle cx="488" cy="388" r="32" fill="#bdd8c2" />
    <circle cx="512" cy="399" r="28" fill="#c7dfca" />
    <text x="500" y="466" textAnchor="middle" className="map-room">PATIO CENTRAL</text>
    <text x="500" y="486" textAnchor="middle" className="map-small">Vide sur patio · lumière naturelle</text>
    <Stairs x={488} y={185} />
    <Stairs x={270} y={420} />
    <text x="533" y="173" textAnchor="middle" className="map-small">ESCALIER NORD</text>
    <text x="315" y="407" textAnchor="middle" className="map-small">ESCALIER SUD</text>
    <rect x="590" y="152" width="66" height="63" className="service-room" />
    <text x="623" y="187" textAnchor="middle" className="map-small">L.T.</text>
    <rect x="590" y="225" width="66" height="28" className="service-room" />
    <rect x="590" y="261" width="66" height="28" className="service-room" />
    <path d="M 680 145 H 777 L 842 170 V 245 H 680 Z" className="sanitary-room" />
    <path d="M 680 260 H 842 V 385 H 680 Z" className="sanitary-room" />
    <rect x="680" y="394" width="162" height="53" className="service-room" />
    <text x="761" y="425" textAnchor="middle" className="map-small">LOCAL TECHNIQUE</text>
    <path d="M 730 145 V 200 M 680 306 H 728 M 730 333 V 385 M 780 333 V 385" className="partitions" />
    <text x="777" y="228" textAnchor="middle" className="map-small">FEMMES</text>
    <text x="785" y="295" textAnchor="middle" className="map-small">HOMMES</text>
    <path d="M 775 166 h 34 v 18 h -34 Z M 690 314 h 15 v 15 h -15 Z" className="sink" />
    <path d="M 263 527 H 462 V 681 H 275 L 250 550 Z" className="sanitary-room" />
    <path d="M 333 527 V 635 H 275 M 340 580 H 462 M 405 527 V 580 M 406 629 H 462" className="partitions" />
    <text x="356" y="614" textAnchor="middle" className="map-small">HOMMES</text>
    <path d="M 311 648 h 14 v 18 h -14 Z M 352 600 h 14 v 18 h -14 Z" className="sink" />
    <g className="zone-badge"><rect x="675" y="105" width="132" height="27" rx="13" /><text x="741" y="123" textAnchor="middle">BLOC NORD · 5 WC</text></g>
    <g className="zone-badge"><rect x="270" y="694" width="132" height="27" rx="13" /><text x="336" y="712" textAnchor="middle">BLOC SUD · 5 WC</text></g>
    <text x="160" y="376" className="map-direction">SUD</text>
    <text x="858" y="493" textAnchor="end" className="map-direction">NORD</text>
  </>;
}

export default function FloorPlan({ toilets, selected, onSelect, feedback, now }: Props) {
  return <svg className="floor-plan" viewBox="60 20 860 740" role="group" aria-label="Carte interactive des blocs sanitaires sud et nord">
    <PlanArtwork />
    {toilets.map(toilet => {
      const color = statusColor(toilet);
      const danger = toilet.dangerLevel ? DANGER_LEVELS[toilet.dangerLevel - 1].name : 'Air frais';
      const clean = CLEANLINESS.find(level => level.id === toilet.cleanliness)!.name;
      const label = `${toilet.name}, ${toilet.room}, ${toilet.accessible ? 'PMR, ' : ''}${danger}, propreté : ${clean}`;
      const minutes = toilet.dangerUntil ? Math.max(1, Math.ceil((toilet.dangerUntil - now) / 60_000)) : 0;
      const alert = toilet.dangerLevel >= 3 || toilet.cleanliness === 'critical' || toilet.cleanliness === 'dangerous';
      const { x, y } = toilet;
      return <g key={toilet.id} role="button" tabIndex={0} aria-label={label} aria-pressed={selected === toilet.id}
        className={`wc ${selected === toilet.id ? 'selected' : ''} ${alert ? 'alert' : ''}`}
        style={{ '--c': color } as CSSProperties}
        onClick={() => onSelect(toilet.id)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(toilet.id); } }}>
        <title>{label}</title>
        {alert && <circle className="wc-pulse" cx={x} cy={y} r="21" />}
        {feedback?.toiletId === toilet.id && <g key={feedback.id} className={`wc-feedback feedback-${feedback.tone}`} pointerEvents="none" aria-hidden="true">
          <circle className="feedback-ring" cx={x} cy={y} r="26" fill="none" stroke={feedback.color} strokeWidth="3" />
          <circle className="feedback-ring ring-delayed" cx={x} cy={y} r="26" fill="none" stroke={feedback.color} strokeWidth="2" />
          {[-1, 0, 1].map((direction, index) => <text key={direction} className="feedback-particle" x={x + direction * 20} y={y - 24} textAnchor="middle" fontSize={15 + index * 3} style={{ animationDelay: `${index * 0.18}s` }}>{index === 1 ? feedback.emoji : feedback.sound === 'flush' ? '💧' : '💨'}</text>)}
        </g>}
        <circle className="wc-hit" cx={x} cy={y + 6} r="25" />
        <circle className="wc-disc" cx={x} cy={y} r="19" />
        <text className="wc-icon" x={x} y={y + 7} textAnchor="middle">{weatherIcon(toilet)}</text>
        <g className="wc-tag"><rect x={x - 13} y={y + 22} width="26" height="13" rx="6.5" /><text x={x} y={y + 31.5} textAnchor="middle">{toilet.label}</text></g>
        {minutes > 0 && <g className="wc-temp"><rect x={x + 8} y={y - 27} width="24" height="13" rx="4" /><text x={x + 20} y={y - 17.5} textAnchor="middle">{minutes}′</text></g>}
      </g>;
    })}
  </svg>;
}
