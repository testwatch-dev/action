import { nodeIo } from './io.js';
import { main } from './main.js';
const input = (env, name) => (env[`INPUT_${name.toUpperCase()}`] ??
    env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ??
    '').trim();
export async function actionArgs(env, readEvent) {
    const argv = ['run'];
    const flag = (name, value) => {
        if (value)
            argv.push(`--${name}`, value);
    };
    flag('app', input(env, 'app'));
    flag('env', input(env, 'environment'));
    // docs/39: an explicit preview URL (must match the environment's preview patterns).
    const preview = input(env, 'url');
    flag('url', preview);
    let url = input(env, 'environment-url');
    // An explicit environment or preview URL wins; else a deployment_status event names the
    // deployed URL (the server matches it to an environment's URL or its preview patterns).
    if (!url &&
        !preview &&
        !input(env, 'environment') &&
        env.GITHUB_EVENT_NAME === 'deployment_status') {
        const status = ((await readEvent())?.deployment_status ?? {});
        if (status.state !== 'success') {
            return { argv, env, skip: `deployment is "${status.state ?? 'unknown'}", not "success"` };
        }
        url = status.environment_url || status.target_url || '';
    }
    flag('env-url', url);
    for (const t of input(env, 'tags')
        .split(/[\s,]+/)
        .filter(Boolean))
        flag('tag', t);
    flag('tests', input(env, 'tests'));
    flag('account', input(env, 'account'));
    flag('fail-on', input(env, 'fail-on'));
    flag('timeout', input(env, 'timeout'));
    flag('junit', input(env, 'junit'));
    if (input(env, 'wait') !== 'false')
        argv.push('--wait');
    const apiUrl = input(env, 'api-url');
    return {
        argv,
        env: {
            ...env,
            TESTWATCH_API_KEY: input(env, 'api-key') || env.TESTWATCH_API_KEY,
            ...(apiUrl ? { TESTWATCH_API_URL: apiUrl } : {}),
        },
    };
}
async function runAction() {
    const io = nodeIo();
    const key = input(process.env, 'api-key');
    if (key)
        io.out(`::add-mask::${key}`);
    const { argv, env, skip } = await actionArgs(process.env, async () => {
        try {
            return JSON.parse(await io.readFile(process.env.GITHUB_EVENT_PATH ?? ''));
        }
        catch {
            return null;
        }
    });
    if (skip) {
        io.out(`::notice title=TestWatch::Skipped — ${skip}.`);
        return 0;
    }
    return main(argv, env, io, { source: 'action' });
}
if (process.env.GITHUB_ACTIONS === 'true' && !process.env.VITEST) {
    process.exitCode = await runAction();
}
