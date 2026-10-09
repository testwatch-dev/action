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
| `environment-url` | the `deployment_status` URL | Picks the environment with this address |
| `tags`, `tests`, `account` | all | Narrow the run |
| `fail-on` | `real_bug,needs_review,infra` | `none` never fails |
| `wait` / `timeout` | `true` / `30m` | |
| `junit` | — | Path for a JUnit XML report |

Outputs: `run-id`, `url`, `verdict` (`pass` · `real_bug` · `needs_review` · `infra` · `timeout`).
The job summary lists the failing tests with links; each one is also an annotation.

Verdicts: **pass** — all passed (flaky passes included) · **real_bug** — the app is broken ·
**needs_review** — a test failed and needs a person (often the app changed) · **infra** —
the app or its login wasn't usable.

## Releasing (maintainers)

The action is the CLI (`packages/cli`, no dependencies) plus `action.yml`:

```bash
pnpm --filter @testwatch/cli build
node integrations/github-action/sync-dist.mjs
# copy action.yml, README.md and dist/ to github.com/testwatch-dev/action, commit, tag v1.x.y,
# and move the v1 tag.
```
