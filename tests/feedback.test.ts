import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFeedback, playFeedback, SOUNDS, MASTER_VOLUME } from '../src/feedback.js';
import { CLEANLINESS, DANGER_LEVELS } from '../shared/domain.js';

test('Chaque signalement atmosphérique a son retour visuel et son bruit', () => {
  assert.deepEqual(DANGER_LEVELS.map(level => reportFeedback('danger', level.id).tone),
    ['breeze', 'cloud', 'toxic', 'radioactive']);
  assert.deepEqual(DANGER_LEVELS.map(level => reportFeedback('danger', level.id).sound),
    ['squeak', 'fart', 'flies', 'nuclear']);
  for (const level of DANGER_LEVELS) {
    assert.equal(reportFeedback('danger', level.id).color, level.color);
  }
});

test('Tous les états de propreté ont un retour distinct, la propreté tire la chasse', () => {
  assert.deepEqual(CLEANLINESS.map(level => reportFeedback('cleanliness', level.id).tone),
    ['fresh', 'breeze', 'toxic', 'radioactive']);
  assert.deepEqual(CLEANLINESS.map(level => reportFeedback('cleanliness', level.id).sound),
    ['flush', 'toot', 'squelch', 'clog']);
  assert.equal(reportFeedback('cleanliness', 'critical').color, '#bf4456');
  assert.throws(() => reportFeedback('danger', 5));
  assert.throws(() => reportFeedback('cleanliness', 'invalid' as 'clean'));
});

function mockContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const nodes: { disconnected: boolean }[] = [];
  const sources: { stop: number; ended?: () => void }[] = [];
  const node = <T extends object>(extra: T) => {
    const n = { disconnected: false, connect(target: unknown) { return target; }, disconnect() { n.disconnected = true; }, ...extra };
    nodes.push(n);
    return n;
  };
  const source = <T extends object>(extra: T) => {
    const record: { stop: number; ended?: () => void } = { stop: 0 };
    sources.push(record);
    const created = node({ ...extra, start() {}, stop(at: number) { record.stop = at; } });
    Object.defineProperty(created, 'onended', { set(callback: () => void) { record.ended = callback; } });
    return created;
  };
  const context = {
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(), Q: param() }),
    createDynamicsCompressor: () => node({}),
    createOscillator: () => source({ type: 'sine', frequency: param() }),
    createBufferSource: () => source({ buffer: null, loop: false }),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { context, nodes, sources };
}

test('Les bruits restent courts, modérés et libèrent tous les nœuds audio', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const sound of SOUNDS) {
    const { context, nodes, sources } = mockContext();
    const duration = playFeedback(context as unknown as AudioContext, sound, random);
    assert.ok(MASTER_VOLUME <= 0.5);
    assert.ok(sources.length > 0, sound);
    assert.ok(duration > 0.2 && duration < 4, `${sound} dure ${duration}s`);
    assert.ok(Math.max(...sources.map(s => s.stop)) < 4.1, sound);
    assert.ok(nodes.every(n => !n.disconnected));
    sources.forEach(s => s.ended?.());
    assert.ok(nodes.every(n => n.disconnected), `${sound} laisse des nœuds connectés`);
  }
});

test('Le son est refusé si le navigateur bloque l’audio', () => {
  const { context } = mockContext();
  assert.throws(() => playFeedback({ ...context, state: 'suspended' } as unknown as AudioContext, 'flush'));
});
