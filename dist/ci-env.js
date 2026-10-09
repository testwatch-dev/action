const SHA = /^[0-9a-f]{7,64}$/i;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[\w.-]+$/;
function sha(v) {
    return typeof v === 'string' && SHA.test(v) ? v.toLowerCase() : undefined;
}
/**
 * Detect GitHub Actions / GitLab CI metadata. `event` = the parsed `$GITHUB_EVENT_PATH`
 * payload when available (gives a PR's HEAD sha instead of the synthetic merge commit, and
 * a deployment's URL). Pure.
 */
export function detectCi(env, event) {
    if (env.GITHUB_ACTIONS === 'true') {
        const pr = (event?.pull_request ?? null);
        const dep = (event?.deployment ?? null);
        const status = (event?.deployment_status ?? null);
        const prFromRef = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1];
        const pullRequest = pr?.number ?? (prFromRef ? Number(prFromRef) : undefined);
        const repo = env.GITHUB_REPOSITORY && REPO.test(env.GITHUB_REPOSITORY) ? env.GITHUB_REPOSITORY : undefined;
        const runUrl = env.GITHUB_SERVER_URL && repo && env.GITHUB_RUN_ID
            ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`
            : undefined;
        const branch = env.GITHUB_HEAD_REF || dep?.ref || env.GITHUB_REF_NAME || undefined;
        return {
            provider: 'github',
            ci: {
                commitSha: sha(pr?.head?.sha) ?? sha(dep?.sha) ?? sha(env.GITHUB_SHA),
                ...(branch ? { branch: branch.slice(0, 255) } : {}),
                ...(pullRequest ? { pullRequest } : {}),
                ...(repo ? { repo } : {}),
                ...(runUrl ? { ciUrl: runUrl } : {}),
            },
            idempotencyKey: env.GITHUB_RUN_ID && env.GITHUB_JOB
                ? `gh:${env.GITHUB_REPOSITORY ?? ''}:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT ?? '1'}:${env.GITHUB_JOB}`
                : undefined,
            stepSummaryPath: env.GITHUB_STEP_SUMMARY || undefined,
            outputPath: env.GITHUB_OUTPUT || undefined,
            ...(status
                ? { deployment: { url: status.environment_url || status.target_url, state: status.state } }
                : {}),
        };
    }
    if (env.GITLAB_CI === 'true') {
        const mr = env.CI_MERGE_REQUEST_IID ? Number(env.CI_MERGE_REQUEST_IID) : undefined;
        const branch = env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || env.CI_COMMIT_REF_NAME;
        return {
            provider: 'gitlab',
            ci: {
                commitSha: sha(env.CI_COMMIT_SHA),
                ...(branch ? { branch: branch.slice(0, 255) } : {}),
                ...(mr && Number.isInteger(mr) ? { pullRequest: mr } : {}),
                ...(env.CI_JOB_URL?.startsWith('https://') ? { ciUrl: env.CI_JOB_URL } : {}),
            },
            idempotencyKey: env.CI_JOB_ID ? `gl:${env.CI_PROJECT_ID ?? ''}:${env.CI_JOB_ID}` : undefined,
        };
    }
    return { provider: null, ci: {} };
}
