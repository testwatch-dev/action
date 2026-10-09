import { parseArgs } from 'node:util';
import { parseDuration } from './duration.js';
import { parseFailOn } from './exit.js';
export const USAGE = `Usage: testwatch <command> [options]

Commands:
  run       Start a run of an app's tests (and wait for the verdict with --wait)
  whoami    Check the API key: which workspace and what it may do

Run options:
  --app <id>              App id (not needed when the key is pinned to one app)
  --env <name|id>         Environment to run against (default: the app's default)
  --env-url <url>         A deployed URL: matches an environment's own URL or one of its
                          preview patterns
  --url <url>             Run against this preview URL (with --env, or the app's default
                          environment); it must match the environment's preview patterns
  --tag <tag>             Only tests with this tag (repeatable)
  --tags-mode <or|and>    Match any tag (default) or all of them
  --tests <id,id>         Only these test ids
  --account <id>          Test account to sign in as (default: the environment's)
  --wait                  Wait for the final verdict (after heal + triage)
  --timeout <dur>         Give up waiting after this long (default 30m; 90s, 45m, 1h)
  --poll <dur>            How often to check (default 5s)
  --fail-on <list>        Verdicts that fail the job (default real_bug,needs_review,infra;
                          "none" = never fail)
  --junit <file>          Write a JUnit XML report (with --wait)
  --json                  Print the final run as JSON
  --idempotency-key <k>   Same key = same run (default: derived from the CI job)
  --commit <sha> --branch <name> --pr <n>   CI details (auto-detected on GitHub/GitLab)
  --cancel-on-timeout     Cancel the run when --timeout is reached
  --no-cancel-on-abort    Keep the run going when the job is cancelled (SIGINT/SIGTERM)

Environment:
  TESTWATCH_API_KEY       Your API key (Settings → API keys). Required.
  TESTWATCH_API_URL       API address (default https://api.testwatch.dev)

Exit codes: 0 passed (or not failing per --fail-on) · 1 failing verdict · 2 error/timeout ·
130 interrupted`;
const csv = (v) => (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
function isHttpUrl(u) {
    try {
        const p = new URL(u);
        return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
    }
    catch {
        return false;
    }
}
/** argv (without node + script) → a command. Pure. */
export function parseCommand(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            strict: true,
            options: {
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
                app: { type: 'string' },
                env: { type: 'string' },
                'env-url': { type: 'string' },
                url: { type: 'string' },
                tag: { type: 'string', multiple: true },
                'tags-mode': { type: 'string' },
                tests: { type: 'string' },
                account: { type: 'string' },
                wait: { type: 'boolean' },
                timeout: { type: 'string' },
                poll: { type: 'string' },
                'fail-on': { type: 'string' },
                junit: { type: 'string' },
                json: { type: 'boolean' },
                'idempotency-key': { type: 'string' },
                commit: { type: 'string' },
                branch: { type: 'string' },
                pr: { type: 'string' },
                'cancel-on-timeout': { type: 'boolean' },
                'no-cancel-on-abort': { type: 'boolean' },
            },
        });
    }
    catch (e) {
        return { kind: 'error', message: e.message };
    }
    const v = parsed.values;
    const str = (k) => (typeof v[k] === 'string' ? v[k] : undefined);
    if (v.version)
        return { kind: 'version' };
    const [cmd, ...extra] = parsed.positionals;
    if (v.help || !cmd || cmd === 'help')
        return { kind: 'help' };
    if (extra.length)
        return { kind: 'error', message: `Unexpected argument: ${extra[0]}` };
    if (cmd === 'whoami')
        return { kind: 'whoami' };
    if (cmd !== 'run')
        return { kind: 'error', message: `Unknown command: ${cmd}` };
    const timeoutMs = parseDuration(str('timeout') ?? '30m');
    if (timeoutMs === null)
        return { kind: 'error', message: `--timeout: can't read "${str('timeout')}"` };
    const pollMs = parseDuration(str('poll') ?? '5s');
    if (pollMs === null || pollMs < 1000) {
        return { kind: 'error', message: '--poll: at least 1s' };
    }
    const failOn = parseFailOn(str('fail-on'));
    if ('error' in failOn)
        return { kind: 'error', message: failOn.error };
    const mode = (str('tags-mode') ?? 'or').toLowerCase();
    if (mode !== 'or' && mode !== 'and')
        return { kind: 'error', message: '--tags-mode: or | and' };
    const prRaw = str('pr');
    const pr = prRaw ? Number(prRaw) : undefined;
    if (prRaw && (!Number.isInteger(pr) || (pr ?? 0) <= 0)) {
        return { kind: 'error', message: '--pr: a pull request number' };
    }
    if (str('env') && str('env-url')) {
        return { kind: 'error', message: 'Use --env or --env-url, not both' };
    }
    const url = str('url');
    if (url && str('env-url')) {
        return {
            kind: 'error',
            message: 'Use --url or --env-url, not both (--url already names the environment with --env)',
        };
    }
    if (url && !isHttpUrl(url))
        return { kind: 'error', message: '--url: an http(s) URL' };
    const tags = (v.tag ?? []).flatMap((t) => csv(t));
    const options = {
        app: str('app'),
        env: str('env'),
        envUrl: str('env-url'),
        url,
        tags,
        tagsMode: mode,
        tests: csv(str('tests')),
        account: str('account'),
        wait: !!v.wait,
        timeoutMs,
        pollMs,
        failOn,
        junit: str('junit'),
        json: !!v.json,
        idempotencyKey: str('idempotency-key'),
        commit: str('commit'),
        branch: str('branch'),
        pr,
        cancelOnTimeout: !!v['cancel-on-timeout'],
        cancelOnAbort: !v['no-cancel-on-abort'],
    };
    if (options.junit && !options.wait) {
        return { kind: 'error', message: '--junit needs --wait (the report is written at the end)' };
    }
    return { kind: 'run', options };
}
