# better-auth-vipps

Vipps MobilePay Login provider helper for Better Auth. The public API uses plain
TypeScript options and Better Auth configuration, with no Effect dependency.

**Unreleased.** Browser login has been tested with a local OIDC server and real
Better Auth callbacks. A live Vipps test-merchant check is still required. The
package remains private and publishing is disabled.

## Usage

The helper targets Better Auth **1.7.2** exactly while compatibility is being
verified. It uses that version's generic OAuth API and verification behavior.
The following is source-level usage until a package is released:

```ts
import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'
import { vipps } from './src/index'

export const auth = betterAuth({
	// Add your database, baseURL, and secret configuration.
	plugins: [
		genericOAuth({
			config: [
				vipps({
					clientId: process.env.VIPPS_CLIENT_ID!,
					clientSecret: process.env.VIPPS_CLIENT_SECRET!,
					subscriptionKey: process.env.VIPPS_SUBSCRIPTION_KEY!,
					merchantSerialNumber: process.env.VIPPS_MERCHANT_SERIAL_NUMBER!,
					environment: 'test'
				})
			]
		})
	]
})
```

Sign in through `authClient.signIn.social({ provider: 'vipps', callbackURL: '/' })`.
Register the exact callback URL, normally
`https://your-domain.example/api/auth/callback/vipps`, in the Vipps business portal.
Use `environment: 'production'` only with production merchant credentials.

Required scopes are `openid name email`. The first implementation deliberately
keeps these fixed. Profiles missing a subject, name, or email fail login. Only a
boolean `true` verification claim marks an email verified. Extra personal claims
are discarded. No database changes beyond Better Auth's standard tables are needed.

Optional configuration: `providerId`, `redirectURI`, `disableSignUp`, and
`disableImplicitSignUp`. Use a distinct provider ID for each merchant configuration.
The helper preserves Better Auth's account-linking policy and does not add trusted
providers. Review that policy before enabling account linking in an application.

The token exchange uses Basic client authentication. UserInfo requests include the
subscription key and merchant headers, reject redirects, and time out after ten
seconds. ID-token verification stays with Better Auth; the helper checks that
UserInfo identifies the same subject. Logout clears the local session only.

## Run the development example

Use Bun 1.4 or newer:

```sh
bun install
cp .env.example .env
# Fill in your own test merchant credentials and a random auth secret.
bun run example
```

Open `http://localhost:3000`. The example creates `vipps-example.sqlite` locally.
If using an HTTPS tunnel, set `BETTER_AUTH_URL` to that public URL and register its
`/api/auth/callback/vipps` URL in the portal. The server still listens on port 3000.
Use a sales unit enabled for Login and a Vipps test-app user. Never commit `.env`
or the example database. This is a development example; use the official branded
button and review deployment settings before shipping an application.

## Development checks

```sh
npm install -g fallow@3
bun run validate
```

The integration suite covers real session creation, test/production routing,
repeat login after email changes, PKCE and headers, sign-up restrictions, and
rejection of invalid tokens and profiles. It uses local HTTP responses in place
of Vipps network calls; it does not replace Better Auth's callback implementation.
No real Vipps credentials are used by tests or CI.

Tooling follows the sibling projects: Bun catalogs, strict TypeScript, Oxfmt,
type-aware Oxlint, lint-staged, Fallow, Conventional Commit PR titles, and
release-please on `master`. See [SPEC.md](SPEC.md) for design references, remaining
acceptance criteria, and release setup. There is no claim of production readiness.

## License

MIT. Independent community project, unaffiliated with Vipps MobilePay or Better Auth.
