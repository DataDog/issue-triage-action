# issue-triage-action

Reusable GitHub Actions workflow that automatically triages new issues using Claude AI — assigning a `team/` label and posting a Slack notification.

## How it works

The workflow runs in two sequential jobs:

1. **prepare** — Adds `pending`/`oss/0` labels, fetches issue details, checks for secrets in the issue content, and uploads a sanitised `issue_details.json` artifact.
2. **triage** — Downloads the artifact, checks out the calling repo, runs Claude to analyse the issue against CODEOWNERS, validates the output, applies a `team/` label, and sends a Slack message.

## Usage

Add a caller workflow to `.github/workflows/issue-triage.yml` in your repo:

```yaml
name: "Issue Triage"

on:
  issues:
    types: [opened, reopened]
  workflow_dispatch:
    inputs:
      issue_number:
        description: 'Issue number to triage manually'
        required: true
        type: number

jobs:
  triage:
    uses: DataDog/issue-triage-action/.github/workflows/issue-triage.yml@main
    with:
      slack_map_path: .github/workflows/config/github_slack_map.yaml
      environment_name: main
```

The triage job reads its secrets directly from the GitHub environment named by
`environment_name` (so the caller passes no `secrets:`). If your secrets are
named something other than `ANTHROPIC_API_KEY` / `SLACK_BOT_TOKEN`, set
`anthropic_api_key_secret_name` / `slack_bot_token_secret_name`.

See [`examples/caller.yml`](examples/caller.yml) for the full template with all optional inputs.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `slack_map_path` | ✅ | — | Path to `github_slack_map.yaml` relative to the calling repo root |
| `fallback_channel` | | `agent-devx-ops` | Slack channel used when no team match is found |
| `fallback_team` | | `agent-devx` | Team label applied when no team match is found (without `team/` prefix) |
| `environment_name` | ✅ | — | Name of the GitHub environment to pin the triage job to (configurable to avoid clashing with an existing environment) |
| `issue_number` | | — | Issue number for `workflow_dispatch`-triggered callers |
| `anthropic_api_key_secret_name` | | `ANTHROPIC_API_KEY` | Name of the environment/repo/org secret holding the Anthropic API key |
| `slack_bot_token_secret_name` | | `SLACK_BOT_TOKEN` | Name of the environment/repo/org secret holding the Slack bot token |

## Secrets

The triage job reads these directly from the GitHub environment named by `environment_name` — the caller does **not** pass them via a `secrets:` block. Override the `*_secret_name` inputs if your secrets are named differently.

| Logical secret | Default name | Description |
|----------------|--------------|-------------|
| Anthropic API key | `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| Slack bot token | `SLACK_BOT_TOKEN` | Slack bot token with `chat:write` permission |

## Prerequisites per repo

- **Secrets**: the Anthropic and Slack secrets, set on the GitHub environment named by `environment_name` (or at repo/org level). Match the default names above, or point the `*_secret_name` inputs at your own.
- **GitHub environment**: Create an environment named whatever you pass as `environment_name` (the triage job is pinned to it, e.g. for secret-approval rules).
- **Issue labels**: `pending`, `oss/0`, and one `team/<name>` label per team listed in CODEOWNERS.
- **Slack map**: A `github_slack_map.yaml` at the path given in `slack_map_path` — see the [datadog-agent reference file](https://github.com/DataDog/datadog-agent/blob/main/tasks/libs/pipeline/github_slack_map.yaml) for the format.

## Repos using this workflow

| Repo | Caller workflow | Slack map |
|------|----------------|-----------|
| [datadog-agent](https://github.com/DataDog/datadog-agent) | `.github/workflows/issue-triage.yml` | `tasks/libs/pipeline/github_slack_map.yaml` |
| [integrations-core](https://github.com/DataDog/integrations-core) | `.github/workflows/issue-triage.yml` | `.github/workflows/config/github_slack_map.yaml` |
| [datadog-operator](https://github.com/DataDog/datadog-operator) | `.github/workflows/issue-triage.yml` | `.github/workflows/config/github_slack_map.yaml` |
| [helm-charts](https://github.com/DataDog/helm-charts) | `.github/workflows/issue-triage.yml` | `.github/config/github_slack_map.yaml` |
