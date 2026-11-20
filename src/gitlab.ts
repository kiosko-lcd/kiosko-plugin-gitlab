/**
 * Your open merge requests, the ones waiting for your review and the ones
 * assigned to you, from a single GraphQL query to GitLab: through the `glab`
 * CLI (already logged in) or, with a token, straight over HTTPS. Shared by
 * `pipelines` and `reviews` as one source, so both cards cost one call.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localize, matchFilter, PluginError, type Filter, type Localized } from '@kiosko/sdk';

/** GitLab answered that nobody is logged in: the token, or glab's login, is missing or wrong. */
const NOT_LOGGED_IN: Localized = {
  en: 'Not logged in to GitLab: check the access token in this source, or run glab auth login',
  es: 'Sin sesión en GitLab: revisa el token de acceso de esta fuente o ejecuta glab auth login',
  de: 'Nicht bei GitLab angemeldet: Prüfe das Zugriffstoken in dieser Datenquelle oder führe glab auth login aus',
  'zh-Hant': '尚未登入 GitLab：請檢查此資料來源的存取權杖，或執行 glab auth login',
  'zh-Hans': '尚未登录 GitLab：请检查此数据源的访问令牌，或运行 glab auth login',
};

const execFileAsync = promisify(execFile);

export type PipelineStatus = 'FAILED' | 'RUNNING' | 'PENDING' | 'CREATED' | 'PREPARING' | 'WAITING_FOR_RESOURCE' | 'SCHEDULED' | 'MANUAL' | 'SUCCESS' | 'CANCELED' | 'SKIPPED' | (string & {});

export interface MergeRequest {
  /** `group/project!123`. */
  reference: string;
  title: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  author: string;
  approvedBy: string[];
  pipeline: PipelineStatus | null;
}

export interface MyMergeRequests {
  me: string;
  authored: MergeRequest[];
  toReview: MergeRequest[];
  /** Assigned to you (yours included): teams that assign a merge request to its reviewer instead of requesting a review. */
  assigned: MergeRequest[];
}

const MR_FIELDS = 'nodes { reference(full: true) title draft createdAt updatedAt author { username } approvedBy { nodes { username } } headPipeline { status } }';

export const QUERY = `{ currentUser { username
  authoredMergeRequests(state: opened, first: 50) { ${MR_FIELDS} }
  reviewRequestedMergeRequests(state: opened, first: 50) { ${MR_FIELDS} }
  assignedMergeRequests(state: opened, first: 50) { ${MR_FIELDS} } } }`;

interface Node {
  reference: string;
  title: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  author?: { username?: string };
  approvedBy?: { nodes?: { username: string }[] };
  headPipeline?: { status?: string } | null;
}

export function parseMergeRequests(json: string): MyMergeRequests {
  type Nodes = { nodes: Node[] };
  const d = JSON.parse(json) as { errors?: { message?: string }[]; data?: { currentUser?: { username: string; authoredMergeRequests?: Nodes; reviewRequestedMergeRequests?: Nodes; assignedMergeRequests?: Nodes } | null } };
  if (d.errors?.length) throw new Error(d.errors[0]?.message ?? 'GraphQL error');
  const u = d.data?.currentUser;
  if (!u) throw new PluginError(NOT_LOGGED_IN);
  const map = (n: Node): MergeRequest => ({
    reference: n.reference,
    title: n.title.replace(/^Draft:\s*/i, ''),
    draft: n.draft,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    author: n.author?.username ?? '',
    approvedBy: (n.approvedBy?.nodes ?? []).map((a) => a.username),
    pipeline: n.headPipeline?.status ?? null,
  });
  return {
    me: u.username,
    authored: (u.authoredMergeRequests?.nodes ?? []).map(map),
    toReview: (u.reviewRequestedMergeRequests?.nodes ?? []).map(map),
    assigned: (u.assignedMergeRequests?.nodes ?? []).map(map),
  };
}

/** `gitlab.example.com` → `https://gitlab.example.com/api/graphql`. */
export function graphqlUrl(host: string): string {
  const h = (host.trim() || 'gitlab.com').replace(/\/+$/, '');
  return `${/^https?:\/\//.test(h) ? h : `https://${h}`}/api/graphql`;
}

export interface Connection {
  /** The `glab` command, used when there is no token. */
  bin: string;
  /** GitLab host; empty = glab's default, or gitlab.com with a token. */
  host: string;
  /** Personal access token (read_api). Empty = use glab. */
  token: string;
}

/** One read. `signal` aborts it (Kiosko aborts it after the source's `timeoutMs`). */
export async function readMergeRequests(c: Connection, signal: AbortSignal): Promise<MyMergeRequests> {
  if (c.token.trim()) {
    const res = await fetch(graphqlUrl(c.host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token.trim()}` },
      body: JSON.stringify({ query: QUERY }),
      signal,
    });
    if (res.status === 401) throw new PluginError(NOT_LOGGED_IN);
    if (!res.ok) throw new Error(`GitLab HTTP ${res.status}`);
    return parseMergeRequests(await res.text());
  }
  const args = ['api', 'graphql', '-f', `query=${QUERY}`, ...(c.host.trim() ? ['--hostname', c.host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')] : [])];
  const { stdout } = await execFileAsync(c.bin || 'glab', args, { maxBuffer: 8_000_000, signal }).catch((e: unknown) => {
    if ((e as { code?: unknown }).code !== 'ENOENT') throw e;
    throw new PluginError({
      en: 'glab not found: install the GitLab CLI, or set an access token in this source',
      es: 'No se encuentra glab: instala el CLI de GitLab o pon un token de acceso en esta fuente',
      de: 'glab nicht gefunden: Installiere die GitLab-CLI oder trage in dieser Datenquelle ein Zugriffstoken ein',
      'zh-Hant': '找不到 glab：請安裝 GitLab CLI，或在此資料來源中設定存取權杖',
      'zh-Hans': '找不到 glab：请安装 GitLab CLI，或在此数据源中设置访问令牌',
    }, { cause: e });
  });
  return parseMergeRequests(stdout);
}

/** `group/web-app!412` → `group/web-app`. */
export function projectOf(reference: string): string {
  return reference.split('!')[0] ?? reference;
}

/** The alias of a merge request's project (by project name or full path), if it has one. */
export function aliasOf(reference: string, aliases: Record<string, string> = {}): string | undefined {
  const path = projectOf(reference);
  return aliases[path.split('/').pop() ?? path] ?? aliases[path];
}

/** `group/web-app!412` → `web-app!412`; aliases (by project name) win; long names are cut. */
export function shortRef(reference: string, aliases: Record<string, string> = {}): string {
  const path = projectOf(reference);
  const iid = reference.split('!')[1] ?? '';
  const name = aliasOf(reference, aliases) ?? path.split('/').pop() ?? path;
  return `${name.length > 10 ? `${name.slice(0, 9)}…` : name}!${iid}`;
}

/** Whether the merge request's project passes a `projects` filter: by its path, its name or its alias. */
export function inProjects(m: Pick<MergeRequest, 'reference'>, projects: Filter, aliases: Record<string, string> = {}): boolean {
  const alias = aliasOf(m.reference, aliases);
  return matchFilter(alias ? [projectOf(m.reference), alias] : projectOf(m.reference), projects);
}

export interface Look {
  label: Localized;
  color: string;
  /** Sort order: broken first. */
  rank: number;
}

/** How each pipeline status is called and coloured; `rank` puts what's broken first. */
export function pipelineLook(status: PipelineStatus | null, colors: { alert: string; warn: string; info: string; ok: string; inkDim: string }): Look {
  switch (status) {
    case 'FAILED': return { label: { en: 'failed', es: 'falla', de: 'Fehler', 'zh-Hant': '失敗', 'zh-Hans': '失败' }, color: colors.alert, rank: 0 };
    case 'RUNNING': return { label: { en: 'running', es: 'en curso', de: 'läuft', 'zh-Hant': '執行中', 'zh-Hans': '运行中' }, color: colors.info, rank: 1 };
    case 'PENDING': case 'CREATED': case 'PREPARING': case 'WAITING_FOR_RESOURCE': case 'SCHEDULED': return { label: { en: 'queued', es: 'en cola', de: 'eingereiht', 'zh-Hant': '排隊中', 'zh-Hans': '排队中' }, color: colors.warn, rank: 2 };
    case 'MANUAL': return { label: { en: 'manual', es: 'manual', de: 'manuell', 'zh-Hant': '手動', 'zh-Hans': '手动' }, color: colors.warn, rank: 3 };
    case 'SUCCESS': return { label: { en: 'passed', es: 'ok', de: 'ok', 'zh-Hant': '通過', 'zh-Hans': '通过' }, color: colors.ok, rank: 4 };
    case 'CANCELED': return { label: { en: 'canceled', es: 'cancelado', de: 'abgebrochen', 'zh-Hant': '已取消', 'zh-Hans': '已取消' }, color: colors.inkDim, rank: 5 };
    case 'SKIPPED': return { label: { en: 'skipped', es: 'saltado', de: 'übersprungen', 'zh-Hant': '已略過', 'zh-Hans': '已跳过' }, color: colors.inkDim, rank: 5 };
    default: return { label: { en: 'no CI', es: 'sin CI', de: 'kein CI', 'zh-Hant': '無 CI', 'zh-Hans': '无 CI' }, color: colors.inkDim, rank: 6 };
  }
}

const PLAIN = { alert: '', warn: '', info: '', ok: '', inkDim: '' };

/** Options of `gitlab/pipelines` that choose which merge requests it lists. */
export interface PipelineFilter {
  includeDrafts: boolean;
  hidePassing: boolean;
  projects: Filter;
  aliases: Record<string, string>;
}

/** Your merge requests as `gitlab/pipelines` lists them: broken first, then the most recently updated. */
export function pipelineItems(data: MyMergeRequests, o: PipelineFilter): MergeRequest[] {
  return data.authored
    .filter((m) => (o.includeDrafts || !m.draft) && !(o.hidePassing && m.pipeline === 'SUCCESS') && inProjects(m, o.projects, o.aliases))
    .map((m) => ({ m, rank: pipelineLook(m.pipeline, PLAIN).rank }))
    .sort((a, b) => a.rank - b.rank || b.m.updatedAt.localeCompare(a.m.updatedAt))
    .map((x) => x.m);
}

/** Options of `gitlab/reviews` that choose which merge requests it lists. */
export interface ReviewFilter {
  includeDrafts: boolean;
  hideApproved: boolean;
  includeAssigned: boolean;
  projects: Filter;
  aliases: Record<string, string>;
}

/**
 * The merge requests `gitlab/reviews` lists: the ones you're asked to review
 * (and, with `includeAssigned`, someone else's assigned to you), each once.
 * Pending first and, among them, whatever has waited longest; `done` = you
 * approved it.
 */
export function reviewItems(data: MyMergeRequests, o: ReviewFilter): { m: MergeRequest; done: boolean }[] {
  const seen = new Set<string>();
  const all = [...data.toReview, ...(o.includeAssigned ? (data.assigned ?? []).filter((m) => m.author !== data.me) : [])];
  return all
    .filter((m) => {
      if (seen.has(m.reference)) return false;
      seen.add(m.reference);
      return true;
    })
    .filter((m) => (o.includeDrafts || !m.draft) && inProjects(m, o.projects, o.aliases))
    .map((m) => ({ m, done: m.approvedBy.includes(data.me) }))
    .filter((x) => !(o.hideApproved && x.done))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.m.createdAt.localeCompare(b.m.createdAt));
}

/** Sample data for the gallery: made-up projects and people. */
export function demoMergeRequests(now: number, locale = 'en'): MyMergeRequests {
  // Titles a team writes in its own language: localized like any other text (scripts/i18n-gaps.ts).
  const T = {
    flaky: { en: 'Fix the flaky login test', es: 'Arreglar el test de login inestable', de: 'Wackeligen Login-Test reparieren', 'zh-Hant': '修正不穩定的登入測試', 'zh-Hans': '修复不稳定的登录测试' },
    rateLimit: { en: 'Rate-limit the public endpoints', es: 'Limitar peticiones a endpoints públicos', de: 'Öffentliche Endpunkte drosseln', 'zh-Hant': '公開端點加上速率限制', 'zh-Hans': '公开接口加上限流' },
    onboarding: { en: 'Update the onboarding guide', es: 'Actualizar la guía de bienvenida', de: 'Onboarding-Leitfaden aktualisieren', 'zh-Hant': '更新新人入門指南', 'zh-Hans': '更新新人入职指南' },
    darkMode: { en: 'Dark mode toggle in settings', es: 'Interruptor de modo oscuro en ajustes', de: 'Dunkelmodus-Schalter in den Einstellungen', 'zh-Hant': '設定加入深色模式開關', 'zh-Hans': '设置中加入深色模式开关' },
    offline: { en: 'Offline sync for drafts', es: 'Sincronizar borradores sin conexión', de: 'Offline-Sync für Entwürfe', 'zh-Hant': '草稿離線同步', 'zh-Hans': '草稿离线同步' },
    certs: { en: 'Rotate the staging certificates', es: 'Rotar los certificados de staging', de: 'Staging-Zertifikate rotieren', 'zh-Hant': '更換測試環境憑證', 'zh-Hans': '轮换预发环境证书' },
    perms: { en: 'Cache user permissions per request', es: 'Cachear permisos de usuario por petición', de: 'Benutzerrechte pro Anfrage cachen', 'zh-Hant': '每個請求快取使用者權限', 'zh-Hans': '按请求缓存用户权限' },
    charts: { en: 'Move the charts to the new library', es: 'Pasar las gráficas a la nueva librería', de: 'Diagramme auf neue Bibliothek umstellen', 'zh-Hant': '圖表改用新的函式庫', 'zh-Hans': '图表迁移到新库' },
    push: { en: 'Push notifications for replies', es: 'Notificaciones push de respuestas', de: 'Push-Benachrichtigungen für Antworten', 'zh-Hant': '回覆推播通知', 'zh-Hans': '回复推送通知' },
  } satisfies Record<string, Localized>;
  const n = (key: keyof typeof T) => localize(T[key], locale);

  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const mr = (reference: string, title: string, pipeline: PipelineStatus | null, createdH: number, extra: Partial<MergeRequest> = {}): MergeRequest => ({
    reference, title, draft: false, createdAt: ago(createdH), updatedAt: ago(createdH / 3), author: 'you', approvedBy: [], pipeline, ...extra,
  });
  return {
    me: 'you',
    authored: [
      mr('acme/web-app!412', n('flaky'), 'FAILED', 30),
      mr('acme/api!88', n('rateLimit'), 'RUNNING', 6),
      mr('acme/docs!31', n('onboarding'), 'PENDING', 50),
      mr('acme/web-app!405', n('darkMode'), 'SUCCESS', 120),
      mr('acme/mobile!17', n('offline'), 'MANUAL', 200, { draft: true }),
    ],
    toReview: [
      mr('acme/api!91', n('perms'), 'RUNNING', 26, { author: 'sam' }),
      mr('acme/infra!12', n('certs'), 'FAILED', 3, { author: 'jordan' }),
      mr('acme/web-app!398', n('charts'), 'SUCCESS', 130, { author: 'alex', approvedBy: ['you'] }),
    ],
    assigned: [
      mr('acme/web-app!412', n('flaky'), 'FAILED', 30),
      mr('acme/mobile!21', n('push'), 'SUCCESS', 70, { author: 'riley' }),
    ],
  };
}
