import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import * as realKit from '@loksly/lcd-canvas-kit';
import { createBaseContext, DEFAULT_THEME, validate, type WidgetDefinition } from '@kiosko/sdk';
import { demoMergeRequests, graphqlUrl, inProjects, parseMergeRequests, pipelineItems, pipelineLook, reviewItems, shortRef, type MergeRequest, type MyMergeRequests } from './gitlab.ts';
import plugin, { pipelines, reviews } from './index.ts';

const node = (ref: string, status: string | null, extra = {}) => ({
  reference: ref, title: 'Draft: a fix', draft: false, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z',
  author: { username: 'ana' }, approvedBy: { nodes: [] }, headPipeline: status ? { status } : null, ...extra,
});

const NOW = Date.parse('2026-11-05T10:42:00Z');

test('merge requests: own, to review and assigned from one query', () => {
  const d = parseMergeRequests(JSON.stringify({ data: { currentUser: {
    username: 'me',
    authoredMergeRequests: { nodes: [node('g/web-app!1740', 'FAILED')] },
    reviewRequestedMergeRequests: { nodes: [node('g/integration-tests!120', null, { approvedBy: { nodes: [{ username: 'me' }] } })] },
    assignedMergeRequests: { nodes: [node('g/api!7', 'SUCCESS')] },
  } } }));
  assert.equal(d.me, 'me');
  assert.equal(d.authored[0]!.title, 'a fix', 'without the Draft: prefix');
  assert.equal(d.authored[0]!.pipeline, 'FAILED');
  assert.equal(d.toReview[0]!.pipeline, null);
  assert.deepEqual(d.toReview[0]!.approvedBy, ['me']);
  assert.equal(d.assigned[0]!.reference, 'g/api!7');
  assert.throws(() => parseMergeRequests(JSON.stringify({ errors: [{ message: 'forbidden' }] })), /forbidden/);
  assert.throws(() => parseMergeRequests(JSON.stringify({ data: { currentUser: null } })), /not logged in/);
});

test('short references and pipeline looks', () => {
  assert.equal(shortRef('g/web-app!1740'), 'web-app!1740');
  assert.equal(shortRef('g/integration-tests!120'), 'integrati…!120');
  assert.equal(shortRef('g/integration-tests!120', { 'integration-tests': 'itest' }), 'itest!120');
  assert.equal(shortRef('g/sub/integration-tests!120', { 'g/sub/integration-tests': 'itest' }), 'itest!120', 'alias by full path');
  const colors = { alert: 'r', warn: 'a', info: 'b', ok: 'v', inkDim: 'g' };
  assert.ok(pipelineLook('FAILED', colors).rank < pipelineLook('RUNNING', colors).rank && pipelineLook('RUNNING', colors).rank < pipelineLook('SUCCESS', colors).rank);
  assert.deepEqual(pipelineLook(null, colors).label, { en: 'no CI', es: 'sin CI' });
  assert.equal(pipelineLook('WAITING_FOR_RESOURCE', colors).color, 'a');
});

test('GraphQL endpoint from the host option', () => {
  assert.equal(graphqlUrl(''), 'https://gitlab.com/api/graphql');
  assert.equal(graphqlUrl('gitlab.example.com/'), 'https://gitlab.example.com/api/graphql');
  assert.equal(graphqlUrl('http://localhost:8080'), 'http://localhost:8080/api/graphql');
});

const data = demoMergeRequests(NOW);
const pf = { includeDrafts: false, hidePassing: false, projects: [] as string[], aliases: {} as Record<string, string> };
const rf = { includeDrafts: false, hideApproved: false, includeAssigned: false, projects: [] as string[], aliases: {} as Record<string, string> };
const refs = (list: MergeRequest[]) => list.map((m) => m.reference);

test('pipelines: broken first, drafts, hidePassing and the projects filter', () => {
  assert.deepEqual(refs(pipelineItems(data, pf)), ['acme/web-app!412', 'acme/api!88', 'acme/docs!31', 'acme/web-app!405']);
  assert.equal(pipelineItems(data, { ...pf, includeDrafts: true }).length, 5);
  assert.ok(!refs(pipelineItems(data, { ...pf, hidePassing: true })).includes('acme/web-app!405'), 'the passing one is gone');
  assert.deepEqual(refs(pipelineItems(data, { ...pf, projects: ['web-app'] })), ['acme/web-app!412', 'acme/web-app!405']);
  assert.deepEqual(refs(pipelineItems(data, { ...pf, projects: ['acme/*', '!web-*'] })), ['acme/api!88', 'acme/docs!31']);
  assert.deepEqual(refs(pipelineItems(data, { ...pf, projects: ['front'], aliases: { 'web-app': 'front' } })), ['acme/web-app!412', 'acme/web-app!405'], 'by alias');
  assert.ok(inProjects({ reference: 'g/sub/proj!1' }, 'g/sub/*'));
  assert.ok(!inProjects({ reference: 'g/sub/proj!1' }, ['other']));
});

test('reviews: pending first, hideApproved, assigned to me (not mine, each once), projects', () => {
  assert.deepEqual(reviewItems(data, rf).map((x) => [x.m.reference, x.done]), [['acme/api!91', false], ['acme/infra!12', false], ['acme/web-app!398', true]]);
  assert.equal(reviewItems(data, { ...rf, hideApproved: true }).length, 2);
  const withAssigned = reviewItems(data, { ...rf, includeAssigned: true }).map((x) => x.m.reference);
  assert.ok(withAssigned.includes('acme/mobile!21'), 'someone else\'s, assigned to me');
  assert.ok(!withAssigned.includes('acme/web-app!412'), 'my own assigned MR is not a review');
  const dup: MyMergeRequests = { ...data, assigned: [data.toReview[0]!] };
  assert.equal(reviewItems(dup, { ...rf, includeAssigned: true }).length, 3, 'requested and assigned: once');
  assert.deepEqual(reviewItems(data, { ...rf, projects: ['infra'] }).map((x) => x.m.reference), ['acme/infra!12']);
});

/** Renders a widget and returns every text it drew, in order. */
function texts(w: WidgetDefinition<any, any>, options: Record<string, unknown>, sources: Record<string, unknown>, size = { w: 600, h: 220 }, locale = 'en'): string[] {
  const out: string[] = [];
  const kit = { ...realKit, drawTracked: (...a: Parameters<typeof realKit.drawTracked>) => (out.push(a[1]), realKit.drawTracked(...a)) };
  const canvas = createCanvas(size.w, size.h);
  const theme = DEFAULT_THEME;
  w.render(canvas.getContext('2d'), {
    ...createBaseContext({ now: NOW, locale }), options: validate(w.options!, options).value, data: undefined, sources, working: true,
    box: { x: 0, y: 0, w: size.w, h: size.h }, theme, fonts: theme.fonts, kit, canvas: { createCanvas, loadImage: (() => {}) as never }, preview: false,
  } as never);
  return out;
}

const src = (d: MyMergeRequests) => ({ 'gitlab/merge-requests': d });
const many = (n: number): MyMergeRequests => ({
  ...data,
  authored: Array.from({ length: n }, (_, i) => ({ ...data.authored[0]!, reference: `acme/p${i}!${i}`, title: `MR ${i}` })),
  toReview: Array.from({ length: n }, (_, i) => ({ ...data.toReview[0]!, reference: `acme/p${i}!${i}`, title: `MR ${i}` })),
});

test('pipelines: rows and layout; what does not fit is "+N more"', () => {
  const titles = (t: string[]) => t.filter((x) => x.startsWith('MR ')).length;
  // Auto: one line, as many as fit.
  let t = texts(pipelines, {}, src(many(12)));
  assert.ok(titles(t) >= 6 && t.includes(`+${12 - titles(t)} more`), t.join('|'));
  // A fixed number of rows: that many, and "+N more" on a line of its own.
  t = texts(pipelines, { rows: 4 }, src(many(12)));
  assert.equal(titles(t), 4);
  assert.ok(t.includes('+8 more'));
  // Everything fits: no "+N more".
  t = texts(pipelines, { rows: 4 }, src(many(3)));
  assert.equal(titles(t), 3);
  assert.ok(!t.some((x) => x.startsWith('+')));
  // Forced detailed: the status is drawn apart from the reference, and fewer rows fit.
  t = texts(pipelines, { layout: 'detailed' }, src(many(12)));
  assert.ok(titles(t) >= 2 && titles(t) <= 5, String(titles(t)));
  assert.ok(t.includes('failed') && t.some((x) => x.startsWith('p0!0')));
  assert.ok(t.includes(`+${12 - titles(t)} more`));
  // Tall tile: auto picks the detailed layout.
  t = texts(pipelines, {}, src(many(3)), { w: 300, h: 420 });
  assert.ok(t.some((x) => x.startsWith('p0!0')) && t.includes('failed'));
  // Spanish.
  assert.ok(texts(pipelines, { rows: 2 }, src(many(5)), undefined, 'es').includes('+3 más'));
});

test('reviews: no more silent cuts; one line when that shows more; the age from ctx.fmt', () => {
  const titles = (t: string[]) => t.filter((x) => x.startsWith('MR ')).length;
  let t = texts(reviews, { layout: 'detailed' }, src(many(10)));
  assert.ok(titles(t) < 10 && t.includes(`+${10 - titles(t)} more`), t.join('|'));
  t = texts(reviews, {}, src(many(8)));
  assert.equal(titles(t), 8, 'auto: one line each, all of them');
  t = texts(reviews, {}, src(data));
  assert.ok(t.some((x) => / · sam · 1 d$/.test(x)), t.join('|'));
  assert.ok(t.some((x) => x.endsWith(' · approved')));
});

test('empty lists: a message, or hidden when asked (reviews hide by default)', () => {
  const none: MyMergeRequests = { me: 'you', authored: [], toReview: [], assigned: [] };
  assert.deepEqual(texts(pipelines, {}, src(none)), ['No open merge requests']);
  assert.deepEqual(texts(reviews, {}, src(none), undefined, 'es'), ['Nada que revisar']);
  const state = (o: Record<string, unknown>, d: MyMergeRequests | undefined) => ({ options: validate(pipelines.options!, o).value, data: undefined, sources: d ? src(d) : {}, now: NOW, working: true });
  assert.equal(pipelines.empty!(state({}, none) as never), true);
  assert.equal(pipelines.empty!(state({}, data) as never), false);
  assert.equal(pipelines.empty!(state({ projects: ['nothing-here'] }, data) as never), true);
  assert.equal(pipelines.empty!(state({}, undefined) as never), false, 'no data yet is not empty');
  assert.equal(pipelines.hideWhenEmpty ?? false, false);
  assert.equal(reviews.hideWhenEmpty, true);
});

test('plugin: both widgets read the shared source and have demo data for it', () => {
  const demo = demoMergeRequests(Date.now());
  assert.ok(demo.authored.length && demo.toReview.length && demo.assigned.length);
  const source = plugin.sources?.[0];
  assert.equal(source?.id, 'merge-requests');
  assert.ok((source?.minIntervalMs ?? 0) >= 60_000, 'a floor for the API');
  for (const w of plugin.widgets ?? []) {
    assert.deepEqual(w.sources, ['gitlab/merge-requests']);
    assert.ok(w.icon && w.category && w.size?.preferred, w.id);
    assert.ok(w.demo!({ options: w.options!.default, now: Date.now(), locale: 'en' }).sources?.['gitlab/merge-requests'], w.id);
    assert.ok(texts(w, {}, src(demo), w.size!.min).length, w.id);
  }
  const token = (source?.options as { props: Record<string, { secret?: boolean }> }).props.token;
  assert.equal(token?.secret, true);
});
