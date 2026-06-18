# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, **do not open a public GitHub issue**.

Please report it privately via the GitHub Security Advisory feature:
[Report a vulnerability](../../security/advisories/new)

Alternatively, email **security@datadoghq.com** with:
- A description of the vulnerability
- Steps to reproduce or a proof-of-concept
- Your assessment of the potential impact

We will acknowledge your report within 5 business days and aim to release a fix within 30 days for confirmed vulnerabilities.

## Supported Versions

Only the latest version on the `main` branch is actively maintained.

## Scope

This repository contains a reusable GitHub Actions workflow. Findings in scope include:
- Prompt injection via issue content reaching the Claude AI step
- Secret exfiltration through the workflow artifact pipeline
- Privilege escalation via the split read-only/privileged job design
