import { createHash, randomUUID } from 'node:crypto';
import { parseCommand, USAGE } from './args.js';
import { detectCi } from './ci-env.js';
import { ApiError, createClient } from './client.js';
import { fmtDuration } from './duration.js';
import { EXIT, exitCodeFor } from './exit.js';
import { consoleReport, githubAnnotations, markdownSummary, progressLine, proposedFixes, } from './summary.js';
export const VERSION = '0.2.1';
export const DEFAULT_API_URL = 'https://api.testwatch.dev';
function explain(e) {
    if (!(e instanceof ApiError))
        return String(e?.message ?? e);
    if (e.status === 401)
        return 'The API key was rejected (wrong, revoked, or not a TestWatch key).';
    if (e.code === 'api_key_not_allowed')
        return "The API key isn't allowed to do this (check its scopes).";
    if (e.code === 'plan_limit' || e.status === 402)
        return `${e.message} Upgrade at https://app.testwatch.dev/settings/billing`;
    if (e.code === 'tenant_suspended')
        return e.message;
    return e.status ? `${e.message} (HTTP ${e.status})` : e.message;
}
async function readEvent(io, env) {
    if (!env.GITHUB_EVENT_PATH)
        return null;
    try {
        return JSON.parse(await io.readFile(env.GITHUB_EVENT_PATH));
    }
    catch {
        return null;
    }
}
async function setOutputs(io, ctx, out) {
    if (!ctx.outputPath)
        return;
    const lines = Object.entries(out).map(([k, v]) => `${k}=${v.replace(/\n/g, ' ')}`);
    await io.appendFile(ctx.outputPath, `${lines.join('\n')}\n`).catch(() => undefined);
}
export function buildRunBody(o, ctx, source) {
    const ci = ctx.ci;
    return {
        ...(o.app ? { appId: o.app } : {}),
        ...(o.env ? { environment: o.env } : {}),
        ...(o.envUrl ? { environmentUrl: o.envUrl } : {}),
        ...(o.url ? { baseUrl: o.url } : {}),
        ...(o.tags.length ? { tags: { tags: o.tags, mode: o.tagsMode } } : {}),
        ...(o.tests.length ? { tests: o.tests } : {}),
        ...(o.account ? { account: o.account } : {}),
        ...((o.commit ?? ci.commitSha) ? { commitSha: o.commit ?? ci.commitSha } : {}),
        ...((o.branch ?? ci.branch) ? { branch: o.branch ?? ci.branch } : {}),
        ...((o.pr ?? ci.pullRequest) ? { pullRequest: o.pr ?? ci.pullRequest } : {}),
        ...(ci.repo ? { repo: ci.repo } : {}),
        ...(ci.ciUrl ? { ciUrl: ci.ciUrl } : {}),
        source,
    };
}
/**
 * The idempotency key when none is given. In a detected CI job: the job id + WHAT is being
 * run (app, environment, URL, preview URL, tags, tests, account) — a matrix leg or a second step that
 * targets something else gets its own run, while a retried POST of the same step maps to the
 * same one. Without a CI: a random key per invocation, so the client's own retries of a lost
 * response can never start a second run.
 */
export function idempotencyKeyFor(ctx, body) {
    if (!ctx.idempotencyKey)
        return `cli:${randomUUID()}`;
    const target = JSON.stringify([
        body.appId ?? null,
        body.environment ?? null,
        body.environmentUrl ?? null,
        body.tags ?? null,
        body.tests ?? null,
        body.account ?? null,
        // Appended only when set, so keys of runs without a preview URL stay as they were.
        ...(body.baseUrl ? [body.baseUrl] : []),
    ]);
    const h = createHash('sha256').update(target).digest('hex').slice(0, 12);
    return `${ctx.idempotencyKey}:${h}`;
}
async function waitForVerdict(io, client, runId, o, aborted) {
    const deadline = io.now() + o.timeoutMs;
    let last = '';
    for (;;) {
        if (aborted())
            return 'aborted';
        const run = await client.get(`/v1/runs/${encodeURIComponent(runId)}`);
        const line = progressLine(run);
        if (line !== last) {
            io.out(line);
            last = line;
        }
        if (run.final)
            return run;
        if (io.now() >= deadline)
            return 'timeout';
        await io.sleep(Math.min(o.pollMs, Math.max(0, deadline - io.now())));
    }
}
async function run(io, env, o, client, source) {
    const ctx = detectCi(env, await readEvent(io, env));
    const body = buildRunBody(o, ctx, source);
    const key = o.idempotencyKey ?? idempotencyKeyFor(ctx, body);
    const started = await client.post('/v1/runs', body, key ? { 'idempotency-key': key } : undefined);
    io.out(started.replayed
        ? `TestWatch: this job already started run ${started.runId} — following it.`
        : `TestWatch: started run ${started.runId}`);
    if (started.unreachable)
        io.out('  The app did not answer — the run is recorded as "app unreachable".');
    io.out(`  ${started.url}`);
    await setOutputs(io, ctx, { 'run-id': started.runId, url: started.url });
    if (!o.wait)
        return EXIT.ok;
    let aborted = false;
    let cancelSent = null;
    const off = io.onAbort(() => {
        aborted = true;
        if (o.cancelOnAbort) {
            io.err('TestWatch: interrupted — cancelling the run.');
            cancelSent = client
                .post(`/v1/runs/${encodeURIComponent(started.runId)}/cancel`)
                .catch(() => undefined);
        }
    });
    const t0 = io.now();
    try {
        const result = await waitForVerdict(io, client, started.runId, o, () => aborted);
        if (result === 'aborted') {
            await cancelSent;
            return EXIT.interrupted;
        }
        if (result === 'timeout') {
            io.err(`TestWatch: no final verdict after ${fmtDuration(o.timeoutMs)}. ${started.url}`);
            if (o.cancelOnTimeout) {
                await client
                    .post(`/v1/runs/${encodeURIComponent(started.runId)}/cancel`)
                    .catch(() => undefined);
                io.err('  The run was cancelled (--cancel-on-timeout).');
            }
            await setOutputs(io, ctx, { verdict: 'timeout' });
            return EXIT.error;
        }
        io.out(consoleReport(result));
        io.out(`  took ${fmtDuration(io.now() - t0)} to a final verdict`);
        if (ctx.provider === 'github')
            for (const a of githubAnnotations(result))
                io.out(a);
        if (o.junit) {
            const xml = await client.text(`/v1/runs/${encodeURIComponent(started.runId)}/junit`);
            await io.writeFile(o.junit, xml);
            io.out(`  JUnit report: ${o.junit}`);
        }
        if (ctx.stepSummaryPath) {
            await io.appendFile(ctx.stepSummaryPath, markdownSummary(result)).catch(() => undefined);
        }
        if (proposedFixes(result).length) {
            io.out('Accept the PR fix in TestWatch, then re-run this job.');
        }
        await setOutputs(io, ctx, { verdict: result.verdict });
        if (o.json)
            io.out(JSON.stringify(result, null, 2));
        return exitCodeFor(result.verdict, o.failOn);
    }
    finally {
        off();
    }
}
/** The whole CLI: argv → exit code. */
export async function main(argv, env, io, opts = {}) {
    const cmd = parseCommand(argv);
    if (cmd.kind === 'help') {
        io.out(USAGE);
        return EXIT.ok;
    }
    if (cmd.kind === 'version') {
        io.out(VERSION);
        return EXIT.ok;
    }
    if (cmd.kind === 'error') {
        io.err(`testwatch: ${cmd.message}\n\n${USAGE}`);
        return EXIT.error;
    }
    const apiKey = env.TESTWATCH_API_KEY?.trim();
    if (!apiKey) {
        io.err('testwatch: set TESTWATCH_API_KEY (create one in TestWatch → Settings → API keys).');
        return EXIT.error;
    }
    const client = createClient({
        baseUrl: env.TESTWATCH_API_URL?.trim() || DEFAULT_API_URL,
        apiKey,
        fetch: io.fetch,
        sleep: io.sleep,
        version: VERSION,
        onRetry: (why, ms) => io.err(`  (${why} — retrying in ${fmtDuration(ms)})`),
    });
    try {
        if (cmd.kind === 'whoami') {
            const me = await client.get('/v1/whoami');
            io.out(`Workspace: ${me.workspace.name}\nKey: ${me.key.name} (${me.key.scopes.join(', ')})${me.key.appId ? `\nOnly app: ${me.key.appId}` : ''}`);
            return EXIT.ok;
        }
        return await run(io, env, cmd.options, client, opts.source ?? 'cli');
    }
    catch (e) {
        io.err(`testwatch: ${explain(e)}`);
        return EXIT.error;
    }
}
