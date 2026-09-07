# better-auth-vipps

Planned Vipps MobilePay Login integration for Better Auth.

This repository currently contains the initial [specification](SPEC.md) and shared
project tooling. Login is not implemented and no package has been published.

The proposed integration is a typed provider helper for Better Auth's generic
OAuth plugin. The spec draws on Better Auth's provider helpers, Auth.js's Vipps
provider, and Better Auth Harmony. It covers browser login, profile mapping,
account linking, verification, and release requirements.

## Development

Use Bun 1.4 or newer. Install Fallow 3 for dead-code checks:

```sh
bun install
npm install -g fallow@3
bun run validate
```

Validation runs formatting, lint, typecheck, tests, build, and dead-code checks.
There are no tests yet; the test command temporarily allows an empty suite.

Dependencies use Bun catalogs. Formatting uses Oxfmt, linting uses type-aware
Oxlint, and pre-commit checks run through lint-staged. PR titles follow
Conventional Commits. The default branch is `master`.

Release-please and catalog update workflows are scaffolded but disabled until
repository variables and credentials are configured, as described in the spec.
The package is marked private to prevent publishing the unfinished scaffold.

## License

MIT. Independent community project, unaffiliated with Vipps MobilePay or Better Auth.
