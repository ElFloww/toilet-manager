import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, CircleHelp, Info, Minus, Plus, RefreshCw, ShieldCheck, SprayCan, Volume2, VolumeX, Wind, X } from 'lucide-react';
import { activeDangerLevel, CLEANLINESS, DANGER_LEVELS, statusColor, type Cleanliness, type Snapshot, type Toilet } from '../shared/domain';
import FloorPlan from './FloorPlan';
import { CLEANLINESS_EMOJI, DANGER_EMOJI, playFeedback, reportFeedback, verdict, weatherIcon, type ReportFeedback, type SoundName } from './feedback';

const clock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

function minutesLeft(until: number | null, now: number) {
  return until ? Math.max(1, Math.ceil((until - now) / 60_000)) : 0;
}

function remaining(until: number, now: number) {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function request(path: string, init?: RequestInit): Promise<Snapshot> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Le serveur a répondu avec l’erreur ${response.status}.`);
  }
  return response.json();
}

type Feedback = ReportFeedback & { id: number; toiletId: string; name: string };

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'danger' | 'cleanliness'>('danger');
  const [danger, setDanger] = useState(1);
  const [cleanliness, setCleanliness] = useState<Cleanliness>('degraded');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [help, setHelp] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundError, setSoundError] = useState('');
  const [flushing, setFlushing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundOn = useRef(true);
  const offset = useRef(0);
  const busy = useRef(false);
  const resetRequested = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4200);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => () => {
    if (audio.current) void audio.current.close().catch(cause => console.error('Fermeture audio impossible :', cause));
  }, []);

  function prepareAudio(): Promise<AudioContext | null> {
    if (!soundOn.current) return Promise.resolve(null);
    try {
      if (!audio.current) audio.current = new AudioContext();
      const context = audio.current;
      return context.resume().then(() => context).catch(cause => {
        console.error('Activation audio impossible :', cause);
        setSoundError('Son indisponible : vérifiez les autorisations audio du navigateur.');
        return null;
      });
    } catch (cause) {
      console.error('Audio indisponible :', cause);
      setSoundError('Ce navigateur ne permet pas de jouer les sons. Les animations restent actives.');
      return Promise.resolve(null);
    }
  }

  /** Joue un bruit si le son est actif. Renvoie la durée jouée (0 sinon). */
  async function play(sound: SoundName, ready = prepareAudio()): Promise<number> {
    const context = await ready;
    if (!context || !soundOn.current) return 0;
    try {
      const duration = playFeedback(context, sound);
      setSoundError('');
      return duration;
    } catch (cause) {
      console.error('Lecture audio impossible :', cause);
      setSoundError('Le navigateur a bloqué le son.');
      return 0;
    }
  }

  function toggleSound() {
    soundOn.current = !soundOn.current;
    setSoundEnabled(soundOn.current);
    setSoundError('');
    if (soundOn.current) void play('toot');
    else if (audio.current) void audio.current.suspend().catch(cause => {
      console.error('Arrêt audio impossible :', cause);
      setSoundError('Impossible de couper la sortie audio du navigateur.');
    });
  }

  async function flushDemo() {
    if (flushing) return;
    setFlushing(true);
    const duration = await play('flush');
    setTimeout(() => setFlushing(false), Math.max(900, duration * 1000));
  }

  useEffect(() => {
    if (help) helpDialog.current?.showModal();
  }, [help]);

  function apply(data: Snapshot) {
    offset.current = data.serverTime - Date.now();
    setNow(data.serverTime);
    setSnapshot(data);
  }

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try { apply(await request('/api/state')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de joindre le serveur.'); }
    finally { busy.current = false; setRefreshing(false); }
  }

  useEffect(() => {
    void refresh();
    const polling = setInterval(() => { void refresh(); }, 10_000);
    const ticking = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(polling); clearInterval(ticking); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    if (snapshot && now >= snapshot.resetsAt && resetRequested.current !== snapshot.resetsAt) {
      resetRequested.current = snapshot.resetsAt;
      void refresh();
    }
  }, [now, snapshot]);

  const toilets: Toilet[] = (snapshot?.toilets ?? []).map(toilet => {
    if (now >= (snapshot?.resetsAt ?? Infinity)) {
      return { ...toilet, dangerLevel: 0, dangerUntil: null, cleanliness: 'clean' };
    }
    const dangerLevel = activeDangerLevel(toilet.dangerLevel, toilet.dangerUntil, now);
    return dangerLevel === 0
      ? { ...toilet, dangerLevel, dangerUntil: null }
      : { ...toilet, dangerLevel };
  });
  const toilet = toilets.find(toilet => toilet.id === selected);
  const fresh = toilets.filter(toilet => toilet.dangerLevel === 0 && toilet.cleanliness === 'clean').length;
  const dirty = toilets.filter(toilet => toilet.cleanliness !== 'clean').length;
  const atmospheric = toilets.filter(toilet => toilet.dangerLevel > 0).length;
  const untilReset = snapshot ? Math.max(0, snapshot.resetsAt - now) : 0;

  function select(id: string) {
    if (id !== selected) void play('knock');
    setSelected(id); setSuccess(''); setDanger(1); setCleanliness('degraded');
    if (window.matchMedia('(max-width: 1050px)').matches) panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function report() {
    if (!toilet || busy.current) return;
    const audioReady = prepareAudio();
    const effect = reportFeedback(mode, mode === 'danger' ? danger : cleanliness);
    const reportedToilet = toilet;
    busy.current = true;
    setSaving(true); setError(''); setSuccess('');
    try {
      apply(await request(`/api/toilets/${toilet.id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: mode, level: mode === 'danger' ? danger : cleanliness }),
      }));
      setSuccess('Signalement enregistré. Merci pour les suivants !');
      setFeedback({ ...effect, id: Date.now(), toiletId: reportedToilet.id, name: reportedToilet.name });
      void play(effect.sound, audioReady);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le signalement n’a pas pu être enregistré.');
    } finally { busy.current = false; setSaving(false); }
  }


  const chosenName = mode === 'danger' ? DANGER_LEVELS[danger - 1].name : CLEANLINESS.find(level => level.id === cleanliness)!.name;
  const chosenEmoji = mode === 'danger' ? DANGER_EMOJI[danger - 1] : CLEANLINESS_EMOJI[cleanliness];
  const time = clock.format(now).replace(':', ' h ');
  const alerts = toilets
    .filter(t => t.dangerLevel > 0 || t.cleanliness !== 'clean')
    .sort((a, b) => (b.dangerLevel + (b.cleanliness === 'critical' ? 5 : b.cleanliness === 'dangerous' ? 3 : 0)) - (a.dangerLevel + (a.cleanliness === 'critical' ? 5 : a.cleanliness === 'dangerous' ? 3 : 0)))
    .map(t => {
      const parts: string[] = [];
      if (t.dangerLevel) parts.push(`${DANGER_LEVELS[t.dangerLevel - 1].name.toLowerCase()} encore ${minutesLeft(t.dangerUntil, now)} min`);
      if (t.cleanliness !== 'clean') parts.push(`propreté ${CLEANLINESS.find(level => level.id === t.cleanliness)!.name.toLowerCase()}`);
      return { id: t.id, icon: weatherIcon(t), text: `${t.label} : ${parts.join(', ')}` };
    });
  const groups = [
    { name: 'Bloc nord', items: toilets.filter(t => t.zone === 'Nord') },
    { name: 'Bloc sud', items: toilets.filter(t => t.zone === 'Sud') },
  ];

  return <div className="app-shell">
    <svg className="isobars" aria-hidden="true" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
      {[0, 1, 2, 3, 4, 5, 6].map(i => <ellipse key={i} cx="980" cy="120" rx={140 + i * 110} ry={90 + i * 80} />)}
      {[0, 1, 2, 3].map(i => <ellipse key={`b${i}`} cx="120" cy="760" rx={120 + i * 120} ry={70 + i * 90} />)}
    </svg>

    <header className="topbar">
      <a className="channel-bug" href="./" aria-label="Toilet Manager, accueil">
        <span className="bug-icon" aria-hidden="true">🚽</span>
        <span className="bug-name">Toilet Manager</span>
        <span className="bug-tag">Météo</span>
      </a>
      <div className="header-right">
        <span className="on-air"><span className="rec" /> En direct <time>{snapshot ? clock.format(now) : '--:--'}</time></span>
        <button className="tool-button sound-button" onClick={toggleSound} aria-pressed={soundEnabled} title={soundEnabled ? 'Couper les bruitages' : 'Activer les bruitages'}>
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}<span>{soundEnabled ? 'Bruitages' : 'Silence'}</span>
        </button>
        <button className="tool-button" onClick={() => setHelp(true)} aria-label="Comment ça marche"><CircleHelp size={18} /><span>Aide</span></button>
      </div>
    </header>

    <main>
      {error && <div className="notification error" role="alert"><Info size={18} /><span>{error} Les données peuvent être obsolètes.</span><button onClick={() => void refresh()}>Réessayer</button></div>}
      {soundError && <div className="notification" role="status"><VolumeX size={18} /><span>{soundError}</span><button onClick={() => setSoundError('')}>Fermer</button></div>}

      <div className="studio">
        <section className="weather-map" aria-labelledby="map-title">
          <div className="map-toolbar">
            <span />
            <div className="map-tools">
              <div className="zoom-controls" role="group" aria-label="Zoom de la carte">
                <button onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1} aria-label="Réduire la carte"><Minus size={14} /></button>
                <span>{zoom * 100} %</span>
                <button onClick={() => setZoom(value => Math.min(3, value + .5))} disabled={zoom === 3} aria-label="Agrandir la carte"><Plus size={14} /></button>
              </div>
              <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void refresh()} disabled={refreshing || saving} aria-label="Actualiser la carte"><RefreshCw size={16} /></button>
            </div>
          </div>
          <div className={`map-surface ${zoom > 1 ? 'zoomed' : ''}`}>
            <div className="drifting-clouds" aria-hidden="true"><span /><span /><span /></div>
            {snapshot
              ? <div className="map-viewport"><div style={{ width: `${zoom * 100}%` }}><FloorPlan toilets={toilets} selected={selected} onSelect={select} feedback={feedback} now={now} /></div></div>
              : <div className="map-loading">{error ? 'Carte indisponible : réessayez la connexion.' : 'Réglage des satellites…'}</div>}
          </div>
          <div className="lower-third">
            <span className="lt-tag">Météo du 3ᵉ étage</span>
            <h1 id="map-title" className="lt-title">La météo des toilettes</h1>
            <p className="lt-sub">{snapshot ? <>Bulletin de {time} : <b>{fresh}</b> {fresh > 1 ? 'cabines' : 'cabine'} au soleil, <b>{atmospheric}</b> sous les nuages, <b>{dirty}</b> à nettoyer.</> : 'Bulletin en préparation…'}</p>
          </div>
        </section>

        <aside className={`forecast ${toilet ? 'has-selection' : ''}`} ref={panel} aria-label="Prévisions et signalement">
          {!toilet ? <div className="empty-selection">
            <button className={`flush-toy ${flushing ? 'flushing' : ''}`} onClick={() => void flushDemo()} aria-label="Tirer la chasse (essai du son)">
              <span aria-hidden="true">🚽</span><span className="swirl" aria-hidden="true" />
            </button>
            <small className="flush-caption">{soundEnabled ? 'Psst : il tire la chasse.' : 'Activez les bruitages pour tirer la chasse.'}</small>
            <h2>Choisissez une cabine</h2>
            <p>Touchez un picto sur la carte ou dans les prévisions pour voir le temps qu’il y fait et donner votre bulletin.</p>
          </div>
            : <div className="forecast-body" key={toilet.id}>
              <div className={`forecast-head verdict-${verdict(toilet).level}`} style={{ '--c': statusColor(toilet) } as CSSProperties}>
                <span className="big-icon" aria-hidden="true">{weatherIcon(toilet)}</span>
                <div>
                  <span className="head-kicker">Prévisions, {toilet.label}</span>
                  <h2>{toilet.name}</h2>
                  <p>Bloc {toilet.zone.toLowerCase()}, {toilet.room.toLowerCase()}{toilet.accessible ? ', accessible PMR' : ''}</p>
                </div>
                <button className="icon-button close" onClick={() => setSelected(null)} aria-label="Fermer la sélection"><X size={18} /></button>
              </div>
              <div className="verdict-line">{verdict(toilet).text}</div>

              <dl className="readings">
                <div>
                  <dt><Wind size={14} /> Atmosphère</dt>
                  <dd>{toilet.dangerLevel ? DANGER_LEVELS[toilet.dangerLevel - 1].name : 'Air frais'}</dd>
                  {toilet.dangerUntil ? <span className="reading-big" aria-label={`Encore ${remaining(toilet.dangerUntil, now)}`}>{remaining(toilet.dangerUntil, now)}</span> : <span className="reading-calm">Ciel dégagé</span>}
                </div>
                <div>
                  <dt><SprayCan size={14} /> Propreté</dt>
                  <dd>{CLEANLINESS.find(level => level.id === toilet.cleanliness)!.name}</dd>
                  <span className="reading-calm">jusqu’à minuit</span>
                </div>
              </dl>

              <div className="mode-tabs" role="tablist" aria-label="Type de signalement">
                <button role="tab" aria-selected={mode === 'danger'} className={mode === 'danger' ? 'active' : ''} onClick={() => { setMode('danger'); setSuccess(''); }}><Wind size={16} /> Atmosphère</button>
                <button role="tab" aria-selected={mode === 'cleanliness'} className={mode === 'cleanliness' ? 'active' : ''} onClick={() => { setMode('cleanliness'); setSuccess(''); }}><SprayCan size={16} /> Propreté</button>
              </div>
              <p className="form-hint">{mode === 'danger' ? 'L’alerte s’atténue toute seule avec le temps.' : 'Remplace l’état précédent. « Propre » signale un nettoyage.'}</p>

              <div className="level-options" role="radiogroup" aria-label={mode === 'danger' ? 'Niveau d’atmosphère' : 'État de propreté'}>
                {mode === 'danger' ? DANGER_LEVELS.map((level, index) =>
                  <button key={level.id} role="radio" aria-checked={danger === level.id} className={`level-option ${danger === level.id ? 'chosen' : ''}`} style={{ '--c': level.color } as CSSProperties} onClick={() => setDanger(level.id)}>
                    <span className="option-emoji" aria-hidden="true">{DANGER_EMOJI[index]}</span>
                    <strong>{level.name}</strong>
                    <small>{level.description}</small>
                    <em>{level.minutes} min</em>
                  </button>)
                  : CLEANLINESS.map(level =>
                    <button key={level.id} role="radio" aria-checked={cleanliness === level.id} className={`level-option ${cleanliness === level.id ? 'chosen' : ''}`} style={{ '--c': reportFeedback('cleanliness', level.id).color } as CSSProperties} onClick={() => setCleanliness(level.id)}>
                      <span className="option-emoji" aria-hidden="true">{CLEANLINESS_EMOJI[level.id]}</span>
                      <strong>{level.name}</strong>
                      <small>{level.description}</small>
                    </button>)}
              </div>

              <button className="submit-report" onClick={() => void report()} disabled={saving || refreshing}>
                {saving ? 'Enregistrement…' : <><span aria-hidden="true">{chosenEmoji}</span> Signaler «{' '}{chosenName}{' '}»</>}
              </button>
              <span className="anonymous-note"><ShieldCheck size={13} /> Pas de nom, pas de compte, pas de jugement.</span>
              {success && <div className="success-message" role="status"><Check size={16} />{success}</div>}
            </div>}
        </aside>
      </div>

      <section className="outlook" aria-label="Prévisions cabine par cabine">
        {groups.map(group => <div className="outlook-group" key={group.name}>
          <h2>{group.name}</h2>
          <div className="outlook-cells">
            {group.items.map(item => <button key={item.id} className={`outlook-cell ${selected === item.id ? 'selected' : ''}`} style={{ '--c': statusColor(item) } as CSSProperties}
              onClick={() => select(item.id)} aria-pressed={selected === item.id} aria-label={`${item.name} : ${verdict(item).text}`}>
              <span className="cell-label">{item.label}</span>
              <span className="cell-icon" aria-hidden="true">{weatherIcon(item)}</span>
              <span className="cell-temp">{item.dangerUntil ? `${minutesLeft(item.dangerUntil, now)}′` : ({ clean: 'Beau', degraded: 'Dégradé', dangerous: 'Danger', critical: 'Critique' } as const)[item.cleanliness]}</span>
            </button>)}
            {!snapshot && Array.from({ length: 5 }, (_, i) => <span key={i} className="outlook-cell placeholder" />)}
          </div>
        </div>)}
      </section>

      <ul className="legend" aria-label="Légende">
        <li><i style={{ background: '#2e9d80' }} /> ☀️ Beau temps</li>
        <li><i style={{ background: '#d5a52e' }} /> 🌬️ Brise, 🧻 dégradé</li>
        <li><i style={{ background: '#eb9142' }} /> ☁️ Suspect</li>
        <li><i style={{ background: '#e36655' }} /> ☣️ Toxique, 💩 dangereux</li>
        <li><i style={{ background: '#9a6bc1' }} /> ☢️ Radioactif</li>
        <li><i style={{ background: '#bf4456' }} /> 🚨 Critique</li>
      </ul>

      <footer>
        <span>Tout repart à zéro à minuit, heure de Paris{snapshot && <>, dans {Math.floor(untilReset / 3_600_000)} h {String(Math.floor(untilReset / 60_000) % 60).padStart(2, '0')}</>}. Carte actualisée toutes les 10 s.</span>
        <span><ShieldCheck size={14} /> Anonyme : ni compte, ni cookie, ni historique.</span>
        <button onClick={() => setHelp(true)}>Comment ça marche</button>
      </footer>
    </main>

    <div className="ticker" role="marquee" aria-label="Alertes en cours">
      <span className="ticker-label">Alertes</span>
      <div className="ticker-window">
        <div className="ticker-track" style={{ '--duration': `${Math.max(18, alerts.length * 7)}s` } as CSSProperties}>
          {[0, 1].map(copy => <span className="ticker-run" key={copy} aria-hidden={copy === 1}>
            {alerts.length
              ? alerts.map(alert => <span className="ticker-item" key={alert.id}><span aria-hidden="true">{alert.icon}</span> {alert.text}</span>)
              : <span className="ticker-item">☀️ Ciel dégagé sur tout l’étage. Profitez-en, ça ne durera pas.</span>}
          </span>)}
        </div>
      </div>
    </div>

    {feedback && <div key={feedback.id} className={`flash feedback-${feedback.tone}`} style={{ '--c': feedback.color } as CSSProperties} role="status">
      <span className="flash-tag">Flash spécial · {feedback.name}</span>
      <div className="flash-body">
        <span className="flash-emoji" aria-hidden="true">{feedback.emoji}</span>
        <div>
          <strong className="flash-shout">{feedback.shout}</strong>
          <span className="flash-title">{feedback.title}</span>
          <p>{feedback.message}</p>
        </div>
        <button onClick={() => setFeedback(null)} aria-label="Fermer"><X size={17} /></button>
      </div>
    </div>}

    {help && <dialog ref={helpDialog} className="modal-backdrop" aria-labelledby="help-title" onCancel={() => setHelp(false)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setHelp(false); } }} onClick={event => { if (event.target === event.currentTarget) setHelp(false); }}>
      <section className="help-modal">
        <button autoFocus className="icon-button close modal-close" onClick={() => setHelp(false)} aria-label="Fermer l’aide"><X size={18} /></button>
        <h2 id="help-title">Le petit guide du petit coin</h2>
        <ol>
          <li>Touchez un picto sur la carte ou dans les prévisions (ou Tab puis Entrée). Sur mobile, zoomez puis faites glisser la carte.</li>
          <li>Signalez l’atmosphère : 15, 30, 60 ou 90 minutes. Le chiffre affiché sur la carte, c’est le nombre de minutes restantes. Un nouveau signalement ne réduit jamais une alerte en cours, et l’alerte s’atténue avec le temps.</li>
          <li>Signalez la propreté, indépendamment. Le dernier signalement remplace le précédent ; «{' '}Propre{' '}» indique un nettoyage.</li>
        </ol>
        <p>Chaque état a son bruitage : chasse d’eau, prouts plus ou moins inquiétants, mouches, compteur Geiger, ventouse… Le bouton «{' '}Bruitages{' '}» les coupe.</p>
        <p>À minuit, heure de Paris, tout est remis à propre, même après un redémarrage du serveur.</p>
        <p className="help-privacy">Aucun compte, cookie, outil de suivi ni historique nominatif : seul l’état actuel de chaque WC est conservé. L’hébergeur peut toutefois avoir ses propres journaux réseau.</p>
        <button className="submit-report" onClick={() => setHelp(false)}>C’est compris</button>
      </section>
    </dialog>}
  </div>;
}
