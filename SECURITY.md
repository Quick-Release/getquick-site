# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for this repository.

Include the affected command, expected impact, and reproduction steps without including live provider credentials or other secrets.

## Credential handling

gq Ops reads provider credentials from the process environment, a project-local `.env`, or `${XDG_CONFIG_HOME:-~/.config}/gq/ops.env`. Keep credential files out of version control and restrict them to the local user.
