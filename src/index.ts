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
  name: { en: 'GitLab merge requests', es: 'Merge requests de GitLab', 'zh-Hant': 'GitLab 合併要求', 'zh-Hans': 'GitLab 合并请求' },
  description: {
    en: 'Your open merge requests, the ones you are asked to review and the ones assigned to you, through glab or a token.',
    es: 'Tus merge requests abiertas, las que te piden revisar y las que tienes asignadas, con glab o con un token.',
    'zh-Hant': '透過 glab 或權杖取得：你開啟中的 MR、請你審查的 MR，以及指派給你的 MR。',
    'zh-Hans': '通过 glab 或令牌获取：你开放中的 MR、请你审查的 MR，以及指派给你的 MR。',
  },
  options: t.object({
    host: t.string({ placeholder: 'gitlab.com', risk: 'network', label: { en: 'GitLab host', es: 'Servidor de GitLab', 'zh-Hant': 'GitLab 主機', 'zh-Hans': 'GitLab 主机' }, help: { en: 'Empty = glab\'s default host (gitlab.com with a token).', es: 'Vacío = el servidor por defecto de glab (gitlab.com con token).', 'zh-Hant': '留空 = glab 的預設主機（使用權杖時為 gitlab.com）。', 'zh-Hans': '留空 = glab 的默认主机（使用令牌时为 gitlab.com）。' } }),
    token: t.string({ secret: true, label: { en: 'Access token', es: 'Token de acceso', 'zh-Hant': '存取權杖', 'zh-Hans': '访问令牌' }, help: { en: 'A personal access token with read_api. Empty = use the glab CLI and its login.', es: 'Un token personal con read_api. Vacío = usar el CLI glab y su sesión.', 'zh-Hant': '具備 read_api 的個人存取權杖。留空 = 使用 glab CLI 及其登入。', 'zh-Hans': '具有 read_api 的个人访问令牌。留空 = 使用 glab CLI 及其登录。' } }),
    bin: t.string({ default: 'glab', format: 'path', risk: 'exec', advanced: true, label: { en: 'glab command', es: 'Comando glab', 'zh-Hant': 'glab 指令', 'zh-Hans': 'glab 命令' } }),
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
    label: { en: 'Short project names', es: 'Nombres cortos de proyecto', 'zh-Hant': '專案簡稱', 'zh-Hans': '项目简称' },
    help: { en: 'Project (as in its path) → what to show, e.g. web-frontend → web.', es: 'Proyecto (como en su ruta) → lo que se muestra, p. ej. web-frontend → web.', 'zh-Hant': '專案（依其路徑）→ 顯示內容，例如 web-frontend → web。', 'zh-Hans': '项目（按其路径）→ 显示内容，例如 web-frontend → web。' },
    keyLabel: { en: 'Project', es: 'Proyecto', 'zh-Hant': '專案', 'zh-Hans': '项目' },
    valueLabel: { en: 'Show as', es: 'Mostrar como', 'zh-Hant': '顯示為', 'zh-Hans': '显示为' },
  });

const projectsField = () => t.filter({ label: { en: 'Projects', es: 'Proyectos', 'zh-Hant': '專案', 'zh-Hans': '项目' } });
const draftsField = () => t.boolean({ label: { en: 'Include drafts', es: 'Incluir borradores', 'zh-Hant': '包含草稿', 'zh-Hans': '包含草稿' } });

const dataOf = (sources: Record<string, unknown>) => sources[SOURCE] as MyMergeRequests | undefined;
const demo = ({ now }: { now: number }) => ({ sources: { [SOURCE]: demoMergeRequests(now) } });

export const pipelines = defineWidget({
  id: 'pipelines',
  name: { en: 'My pipelines', es: 'Mis pipelines', 'zh-Hant': '我的管線', 'zh-Hans': '我的流水线' },
  description: {
    en: 'The pipeline of each of your open merge requests: broken first, then running and queued, passing last.',
    es: 'El pipeline de cada una de tus merge requests abiertas: lo roto primero, luego lo que corre y espera, lo que pasa al final.',
    'zh-Hant': '你每個開啟中 MR 的管線：失敗的優先，接著是執行中與排隊中，通過的排最後。',
    'zh-Hans': '你每个开放中 MR 的流水线：失败的优先，然后是运行中和排队中，通过的排最后。',
  },
  icon: 'git-pull-request',
  category: 'dev',
  tags: ['gitlab', 'ci'],
  size: { min: { w: 280, h: 100 }, preferred: { w: 600, h: 220 } },
  sources: [SOURCE],
  options: t.object({
    ...listOptions({ layouts: ['one-line', 'detailed'] }),
    projects: projectsField(),
    hidePassing: t.boolean({ label: { en: 'Hide passing pipelines', es: 'Ocultar los pipelines que pasan', 'zh-Hant': '隱藏通過的管線', 'zh-Hans': '隐藏通过的流水线' }, help: { en: 'Only what is broken, running or waiting.', es: 'Sólo lo roto, lo que corre y lo que espera.', 'zh-Hant': '只顯示失敗、執行中或等待中的。', 'zh-Hans': '只显示失败、运行中或等待中的。' } }),
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
    if (!list.length) return drawEmpty(g, ctx, tr({ en: 'No open merge requests', es: 'Ninguna MR abierta', 'zh-Hant': '沒有開啟中的 MR', 'zh-Hans': '没有开放中的 MR' }));
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
  name: { en: 'Reviews for me', es: 'Te toca revisar', 'zh-Hant': '待我審查', 'zh-Hans': '待我审查' },
  description: {
    en: 'Merge requests waiting for your review: whose, how long they have waited and how their pipeline is doing. The ones you approved sink, dimmed.',
    es: 'Las merge requests que te toca revisar: de quién son, cuánto llevan esperando y cómo va su pipeline. Las que ya aprobaste bajan, atenuadas.',
    'zh-Hant': '等你審查的 MR：作者、已等多久，以及管線狀況。你已核准的會往下沉並變暗。',
    'zh-Hans': '等你审查的 MR：作者、已等多久，以及流水线状况。你已批准的会沉到下方并变暗。',
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
    hideApproved: t.boolean({ label: { en: 'Hide the ones I approved', es: 'Ocultar las que ya aprobé', 'zh-Hant': '隱藏我已核准的', 'zh-Hans': '隐藏我已批准的' } }),
    includeAssigned: t.boolean({
      label: { en: 'Include the ones assigned to me', es: 'Incluir las que tengo asignadas', 'zh-Hant': '包含指派給我的', 'zh-Hans': '包含指派给我的' },
      help: { en: 'For teams that assign a merge request to its reviewer instead of requesting a review. Your own are left out.', es: 'Para equipos que asignan la merge request a quien la revisa en vez de pedirle revisión. Las tuyas no se cuentan.', 'zh-Hant': '適用於把 MR 指派給審查者、而非發出審查要求的團隊。你自己的 MR 不計入。', 'zh-Hans': '适用于把 MR 指派给审查人、而不是发起审查请求的团队。你自己的 MR 不计入。' },
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
    if (!list.length) return drawEmpty(g, ctx, tr({ en: 'Nothing to review', es: 'Nada que revisar', 'zh-Hant': '沒有要審查的', 'zh-Hans': '没有待审查的' }));
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
        meta: ` · ${m.author} · ${waited}${done ? ` · ${tr({ en: 'approved', es: 'aprobada', 'zh-Hant': '已核准', 'zh-Hans': '已批准' })}` : ''}`,
        aside: waited,
      };
    }), { dots: false });
  },
  demo,
});

export default definePlugin({
  id: 'gitlab',
  name: { en: 'GitLab', es: 'GitLab', 'zh-Hant': 'GitLab', 'zh-Hans': 'GitLab' },
  version: '0.2.1',
  languages: ['en', 'es', 'zh-Hant', 'zh-Hans'],
  sdk: '^0.2.0',
  permissions: { network: ['gitlab.com', 'user'], exec: ['glab'] },
  description: { en: 'Your merge requests\' pipelines and the reviews waiting for you.', es: 'Los pipelines de tus merge requests y las revisiones que te esperan.', 'zh-Hant': '你的 MR 的管線，以及等你審查的 MR。', 'zh-Hans': '你的 MR 的流水线，以及等你审查的 MR。' },
  author: 'Kiosko',
  license: 'MIT',
  icon: 'gitlab',
  widgets: [pipelines, reviews],
  sources: [mergeRequests],
});
