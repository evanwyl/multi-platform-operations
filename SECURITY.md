# Security Policy

## Supported versions

Security fixes are applied to the latest revision of the default branch. Please
reproduce a suspected issue against that revision before reporting it.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature under
**Security → Advisories → New draft security advisory**. Do not publish secrets,
account credentials, session data, or exploit details in a public issue.

Include the affected component, reproduction steps, expected impact, and any
suggested mitigation. Remove or redact real user data from screenshots, logs,
database samples, and configuration files.

## Sensitive local data

Runtime databases, account profiles, cookies, sessions, API credentials,
generated publishing assets, backups, build outputs, and local environment files
must remain outside version control. Use placeholder values in documentation and
tests.
