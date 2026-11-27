/**
 * Several accounts (Kiosko 0.2.12 on): the source declares profiles, and two
 * profiles (gitlab.com and a company host) read each its own server with its
 * own token, sharing nothing. Fake servers only.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createBaseContext, validate } from '@kiosko/sdk';
import type { MyMergeRequests } from './gitlab.ts';
import { mergeRequests } from './index.ts';

const mr = (reference: string, status: string) => ({
  reference, title: `Work on ${reference}`, draft: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z',
  author: { username: 'me' }, approvedBy: { nodes: [] }, headPipeline: { status },
});
const answer = (username: string, ref: string, status: string) =>
  JSON.stringify({ data: { currentUser: { username, authoredMergeRequests: { nodes: [mr(ref, status)] }, reviewRequestedMergeRequests: { nodes: [] }, assignedMergeRequests: { nodes: [] } } } });

/** A fake GitLab that answers only its own token. */
async function fakeGitLab(token: string, body: string, seen: string[]): Promise<{ server: Server; host: string }> {
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    if (req.url !== '/api/graphql') return void res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, host: `http://127.0.0.1:${port}` };
}

let com: Awaited<ReturnType<typeof fakeGitLab>>;
let work: Awaited<ReturnType<typeof fakeGitLab>>;
const comSeen: string[] = [];
const workSeen: string[] = [];

before(async () => {
  com = await fakeGitLab('com-token', answer('me', 'me/dotfiles!3', 'SUCCESS'), comSeen);
  work = await fakeGitLab('work-token', answer('m.losantos', 'acme/billing!812', 'FAILED'), workSeen);
});
after(() => {
  com.server.close();
  work.server.close();
});

function ctx(options: Record<string, unknown>, profile?: string) {
  return {
    ...createBaseContext({ now: Date.now(), locale: 'en' }),
    options: validate(mergeRequests.options!, options).value as never,
    signal: new AbortController().signal,
    intervalMs: 180_000,
    timeoutMs: 20_000,
    ...(profile ? { profile } : {}),
  };
}

test('source: declares profiles, in a way an older SDK ignores', () => {
  assert.equal((mergeRequests as { profiles?: boolean }).profiles, true);
});

test('profiles: gitlab.com and a company host, read at once, each with its own server and token', async () => {
  const [a, b] = (await Promise.all([
    mergeRequests.read!(ctx({ host: com.host, token: 'com-token' })),
    mergeRequests.read!(ctx({ host: work.host, token: 'work-token' }, 'work')),
  ])) as [MyMergeRequests, MyMergeRequests];
  assert.equal(a.me, 'me');
  assert.deepEqual(a.authored.map((m) => m.reference), ['me/dotfiles!3']);
  assert.equal(b.me, 'm.losantos');
  assert.deepEqual(b.authored.map((m) => [m.reference, m.pipeline]), [['acme/billing!812', 'FAILED']]);
  assert.ok(comSeen.every((l) => l.endsWith('Bearer com-token')), 'gitlab.com never sees the work token');
  assert.ok(workSeen.every((l) => l.endsWith('Bearer work-token')), 'the company host never sees the personal token');
  // One profile's bad token is its own error, not the other's.
  await assert.rejects(mergeRequests.read!(ctx({ host: work.host, token: 'com-token' }, 'work')) as Promise<unknown>, /Not logged in/);
  assert.equal(((await mergeRequests.read!(ctx({ host: com.host, token: 'com-token' }))) as MyMergeRequests).me, 'me');
});

test('profiles: without a token, each profile asks glab for its own host', { skip: process.platform === 'win32' && 'a shell script stands in for glab' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-profiles-'));
  try {
    // A glab that answers with the host it was asked for.
    const bin = join(dir, 'glab');
    writeFileSync(bin, `#!/bin/sh\nhost=default\nwhile [ $# -gt 0 ]; do [ "$1" = --hostname ] && host=$2; shift; done\nprintf '%s' '${answer('HOST', 'g/p!1', 'SUCCESS')}' | sed "s/HOST/$host/"\n`);
    chmodSync(bin, 0o755);
    const [a, b] = (await Promise.all([mergeRequests.read!(ctx({ bin })), mergeRequests.read!(ctx({ bin, host: 'https://gitlab.example.com/' }, 'work'))])) as [MyMergeRequests, MyMergeRequests];
    assert.equal(a.me, 'default', 'the default profile: glab\'s default host');
    assert.equal(b.me, 'gitlab.example.com', 'the work profile: its own host');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
