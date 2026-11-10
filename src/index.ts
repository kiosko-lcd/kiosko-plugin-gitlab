/**
 * GitLab at a glance: the pipelines of your open merge requests (broken
 * first, in red) and the merge requests waiting for your review. Both read
 * one shared source, configured once in Settings → Sources.
 */
import { defineSource, definePlugin, defineWidget, drawEmpty, listLayout, listOptions, t } from '@kiosko/sdk';
import { drawLines } from './draw.ts';
import { demoMergeRequests, pipelineItems, pipelineLook, readMergeRequests, reviewItems, shortRef, type MyMergeRequests } from './gitlab.ts';

export * from './gitlab.ts';
export * from './draw.ts';

const SOURCE = 'gitlab/merge-requests';

export const mergeRequests = defineSource({
  id: 'merge-requests',
  name: { en: 'GitLab merge requests', es: 'Merge requests de GitLab' },
  description: {
    en: 'Your open merge requests, the ones you are asked to review and the ones assigned to you, through glab or a token.',
    es: 'Tus merge requests abiertas, las que te piden revisar y las que tienes asignadas, con glab o con un token.',
  },
  options: t.object({
    host: t.string({ placeholder: 'gitlab.com', risk: 'network', label: { en: 'GitLab host', es: 'Servidor de GitLab' }, help: { en: 'Empty = glab\'s default host (gitlab.com with a token).', es: 'Vacío = el servidor por defecto de glab (gitlab.com con token).' } }),
    token: t.string({ secret: true, label: { en: 'Access token', es: 'Token de acceso' }, help: { en: 'A personal access token with read_api. Empty = use the glab CLI and its login.', es: 'Un token personal con read_api. Vacío = usar el CLI glab y su sesión.' } }),
    bin: t.string({ default: 'glab', format: 'path', risk: 'exec', advanced: true, label: { en: 'glab command', es: 'Comando glab' } }),
  }),
  intervalMs: 3 * 60_000,
  // One GraphQL query per read; more often than once a minute is pointless and eats the API's rate limit.
  minIntervalMs: 60_000,
  timeoutMs: 20_000,
  read: ({ options, signal }) => readMergeRequests(options, signal),
  demo: ({ now }) => demoMergeRequests(now),
});

const aliasesField = () =>
  t.map({
    advanced: true,
    label: { en: 'Short project names', es: 'Nombres cortos de proyecto' },
    help: { en: 'Project (as in its path) → what to show, e.g. web-frontend → web.', es: 'Proyecto (como en su ruta) → lo que se muestra, p. ej. web-frontend → web.' },
    keyLabel: { en: 'Project', es: 'Proyecto' },
    valueLabel: { en: 'Show as', es: 'Mostrar como' },
  });

const projectsField = () => t.filter({ label: { en: 'Projects', es: 'Proyectos' } });
const draftsField = () => t.boolean({ label: { en: 'Include drafts', es: 'Incluir borradores' } });

const dataOf = (sources: Record<string, unknown>) => sources[SOURCE] as MyMergeRequests | undefined;
const demo = ({ now }: { now: number }) => ({ sources: { [SOURCE]: demoMergeRequests(now) } });

export const pipelines = defineWidget({
  id: 'pipelines',
  name: { en: 'My pipelines', es: 'Mis pipelines' },
  description: {
    en: 'The pipeline of each of your open merge requests: broken first, then running and queued, passing last.',
    es: 'El pipeline de cada una de tus merge requests abiertas: lo roto primero, luego lo que corre y espera, lo que pasa al final.',
  },
  icon: 'git-pull-request',
  category: 'dev',
  tags: ['gitlab', 'ci'],
  size: { min: { w: 280, h: 100 }, preferred: { w: 600, h: 220 } },
  sources: [SOURCE],
  options: t.object({
    ...listOptions({ layouts: ['one-line', 'detailed'] }),
    projects: projectsField(),
    hidePassing: t.boolean({ label: { en: 'Hide passing pipelines', es: 'Ocultar los pipelines que pasan' }, help: { en: 'Only what is broken, running or waiting.', es: 'Sólo lo roto, lo que corre y lo que espera.' } }),
    includeDrafts: draftsField(),
    aliases: aliasesField(),
  }),
  empty: ({ options, sources }) => {
    const data = dataOf(sources);
    return Boolean(data) && !pipelineItems(data!, options).length;
  },
  render(g, ctx) {
    const { options, sources, box, theme, t: tr } = ctx;
    const data = dataOf(sources);
    if (!data) return;
    const { colors } = theme;
    const list = pipelineItems(data, options);
    if (!list.length) return drawEmpty(g, ctx, tr({ en: 'No open merge requests', es: 'Ninguna MR abierta' }));
    const plan = listLayout(box, list.length, options, {
      sizes: { 'one-line': { min: 22, max: Math.max(22, Math.min(46, box.w / 10)) }, detailed: { min: 40, max: Math.max(40, Math.min(80, box.w / 5)) } },
      // Tall tiles with room: two lines per merge request (title; status and reference).
      auto: (b, n) => (b.h >= b.w * 0.7 && b.h / n >= 50 ? 'detailed' : 'one-line'),
      minRows: 3,
    });
    drawLines(g, ctx, plan, list.map((m) => {
      const look = pipelineLook(m.pipeline, colors);
      return { color: look.color, title: m.title, strong: look.rank === 0, ref: shortRef(m.reference, options.aliases), status: tr(look.label) };
    }), { dots: true });
  },
  demo,
});

export const reviews = defineWidget({
  id: 'reviews',
  name: { en: 'Reviews for me', es: 'Te toca revisar' },
  description: {
    en: 'Merge requests waiting for your review: whose, how long they have waited and how their pipeline is doing. The ones you approved sink, dimmed.',
    es: 'Las merge requests que te toca revisar: de quién son, cuánto llevan esperando y cómo va su pipeline. Las que ya aprobaste bajan, atenuadas.',
  },
  icon: 'git-branch',
  category: 'dev',
  tags: ['gitlab', 'code review'],
  size: { min: { w: 280, h: 100 }, preferred: { w: 600, h: 220 } },
  sources: [SOURCE],
  options: t.object({
    ...listOptions({ layouts: ['one-line', 'detailed'] }),
    projects: projectsField(),
    includeDrafts: draftsField(),
    hideApproved: t.boolean({ label: { en: 'Hide the ones I approved', es: 'Ocultar las que ya aprobé' } }),
    includeAssigned: t.boolean({
      label: { en: 'Include the ones assigned to me', es: 'Incluir las que tengo asignadas' },
      help: { en: 'For teams that assign a merge request to its reviewer instead of requesting a review. Your own are left out.', es: 'Para equipos que asignan la merge request a quien la revisa en vez de pedirle revisión. Las tuyas no se cuentan.' },
    }),
    aliases: aliasesField(),
  }),
  hideWhenEmpty: true,
  redraw: 'minute',
  empty: ({ options, sources }) => {
    const data = dataOf(sources);
    return Boolean(data) && !reviewItems(data!, options).length;
  },
  render(g, ctx) {
    const { options, sources, box, theme, fmt, t: tr } = ctx;
    const data = dataOf(sources);
    if (!data) return;
    const { colors } = theme;
    const list = reviewItems(data, options);
    if (!list.length) return drawEmpty(g, ctx, tr({ en: 'Nothing to review', es: 'Nada que revisar' }));
    const plan = listLayout(box, list.length, options, {
      sizes: { 'one-line': { min: 22, max: Math.max(22, Math.min(46, box.w / 10)) }, detailed: { min: 40, max: Math.max(40, Math.min(84, box.w / 5.5)) } },
      // Two lines (whose, how long) while every row gets room for them; one line when that shows more of the list.
      auto: (b, n) => (b.h / Math.max(1, n) >= 40 ? 'detailed' : 'one-line'),
      minRows: 2,
    });
    drawLines(g, ctx, plan, list.map(({ m, done }) => {
      const look = pipelineLook(m.pipeline, colors);
      const waited = fmt.ago(m.createdAt, { suffix: false });
      return {
        // The pipeline status first, in its colour; then whose it is and how long it has waited.
        color: done ? colors.inkDim : look.color,
        title: m.title,
        strong: !done,
        ref: shortRef(m.reference, options.aliases),
        status: tr(look.label),
        meta: ` · ${m.author} · ${waited}${done ? ` · ${tr({ en: 'approved', es: 'aprobada' })}` : ''}`,
        aside: waited,
      };
    }), { dots: false });
  },
  demo,
});

export default definePlugin({
  id: 'gitlab',
  name: { en: 'GitLab', es: 'GitLab' },
  version: '0.1.0',
  description: { en: 'Your merge requests\' pipelines and the reviews waiting for you.', es: 'Los pipelines de tus merge requests y las revisiones que te esperan.' },
  author: 'Kiosko',
  license: 'MIT',
  icon: 'gitlab',
  widgets: [pipelines, reviews],
  sources: [mergeRequests],
});
