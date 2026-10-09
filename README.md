# TestWatch GitHub Action

Runs your [TestWatch](https://testwatch.dev) end-to-end tests from a workflow, waits for the
**final** verdict (after TestWatch has checked every failure) and fails the job on real bugs.

```yaml
# .github/workflows/testwatch.yml
name: TestWatch
on:
  deployment_status:      # after each deploy — runs against the deployed URL
  workflow_dispatch:
jobs:
  e2e:
    if: github.event_name != 'deployment_status' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: testwatch-dev/action@v1
        with:
          api-key: ${{ secrets.TESTWATCH_API_KEY }}
          app: <your app id>
          # environment: staging
          # tags: smoke
          # fail-on: real_bug            # only confirmed bugs fail the job
          # junit: testwatch.xml
```

| Input | Default | |
|---|---|---|
| `api-key` | — | Settings → API keys (a repository secret) |
| `app` | — | App id (optional when the key is pinned to one app) |
| `environment` | app default | Environment name or id |
| `environment-url` | the `deployment_status` URL | A deployed URL: matches an environment's own URL or one of its preview patterns |
| `url` | — | Run against this preview URL; it must match the environment's preview patterns |
| `tags`, `tests`, `account` | all | Narrow the run |
| `fail-on` | `real_bug,needs_review,infra` | `none` never fails |
| `wait` / `timeout` | `true` / `30m` | |
| `junit` | — | Path for a JUnit XML report |

Outputs: `run-id`, `url`, `verdict` (`pass` · `real_bug` · `needs_review` · `infra` · `timeout`).
The job summary lists the failing tests with links; each one is also an annotation.

Verdicts: **pass** — all passed (flaky passes included) · **real_bug** — the app is broken ·
**needs_review** — a test failed and needs a person (often the app changed) · **infra** —
the app or its login wasn't usable.

## Preview deployments

Add your preview hosts as **preview patterns** on the environment (TestWatch → the app →
Environments, e.g. `*-acme.vercel.app`). A run against a preview URL uses that environment's
tests and test accounts, stays out of the app's main health numbers, and when a test needs a
fix on that branch TestWatch proposes a **PR fix**: the job summary and annotations link to it.
Accept it in TestWatch, then re-run the job.

**Vercel** sends a `deployment_status` event for every deploy, previews included. The deployed
URL is used automatically and matched to the environment by its preview patterns:

```yaml
on:
  deployment_status:
jobs:
  e2e:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: testwatch-dev/action@v1
        with:
          api-key: ${{ secrets.TESTWATCH_API_KEY }}
          app: <your app id>
```

**Netlify** doesn't send `deployment_status` by default. Either add a TestWatch deploy hook
(the app → CI & deploys) to Netlify's deploy notifications, or pass the preview URL yourself:

```yaml
on:
  pull_request:
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      # …wait for the Netlify deploy preview here…
      - uses: testwatch-dev/action@v1
        with:
          api-key: ${{ secrets.TESTWATCH_API_KEY }}
          app: <your app id>
          environment: staging
          url: https://deploy-preview-${{ github.event.number }}--acme.netlify.app
```

Use `url` or `environment-url`, not both. `url` is the strict one: the run is refused when the
URL doesn't match the environment's preview patterns.

## Releasing (maintainers)

The action is the CLI (`packages/cli`, no dependencies) plus `action.yml`:

```bash
pnpm --filter @testwatch/cli build
node integrations/github-action/sync-dist.mjs
# copy action.yml, README.md and dist/ to github.com/testwatch-dev/action, commit, tag v1.x.y,
# and move the v1 tag.
```
