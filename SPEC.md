# better-auth-vipps

Status: minimal implementation, 2026-09-07. The provider and browser example exist.
Eighteen local integration tests pass. Live Vipps verification and the remaining
release criteria below are pending. Unimplemented API ideas are identified below.

## Problem and intended outcome

Developers using Better Auth should be able to add Vipps MobilePay Login without
repeating discovery configuration, environment selection, profile mapping, and
provider-specific request handling. The first release should support browser
sign-in and account creation through Better Auth's existing OAuth flow.

The package is an independent MIT-licensed community integration. It must not
imply endorsement by Vipps MobilePay or Better Auth. Merchants still need their
own Vipps Login access and credentials.

## Baselines and design decisions

The following sources were reviewed on 2026-09-07. Their implementation details
must be checked against the supported dependency version before writing code.

| Baseline                                                                                                                                         | What this project adopts                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Better Auth provider helpers](https://better-auth.com/docs/authentication/other-social-providers)                                               | A typed factory returning generic OAuth configuration, composed with other providers.                                                               |
| [Better Auth LINE helper](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/generic-oauth/providers/line.ts) | Explicit options and provider-specific profile mapping. Its token decoding is not a model for verification.                                         |
| [Auth.js Vipps provider](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/vipps.ts)                                 | Vipps-specific OIDC setup, `openid name email` scopes, environment distinction, and state/nonce/PKCE expectations.                                  |
| [Better Auth Harmony](https://github.com/GeKorm/better-auth-harmony)                                                                             | Focused configuration, documented defaults, examples, and clear database implications. Its normalization features are outside this project's scope. |

These are architectural and documentation references. No third-party source code
has been copied into the scaffold. If code is reused later, preserve its license
and required attribution.

Prefer a `vipps(options)` provider helper over a new authentication engine. Better
Auth owns callbacks, OAuth state, sessions, account storage, and linking. Use only
its public exports. Introduce a separate plugin wrapper only if a demonstrated
requirement cannot be implemented through the generic OAuth API.

## First-release scope

- Browser authorization-code flow with Vipps Login, including returning from the
  Vipps app to the browser.
- Explicit test and production environments, with discovery and issuer validation.
- Typed configuration, profile handling, and useful configuration errors.
- Sign-in, sign-up, and explicit account linking through Better Auth's public APIs.
- One runnable browser example and setup instructions for test credentials,
  redirect URI registration, consent scopes, and official button branding.
- ESM output and TypeScript declarations, without framework-specific runtime code.

Payments, subscriptions, merchant-initiated CIBA login, native Expo/app callbacks,
Login Connect, national identity numbers, marketing consents, and custom session
storage are outside the first release. MobilePay availability and branding must
be verified per merchant market before advertising support beyond the tested flow.

## Public API and planned extensions

```ts
import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'
import { vipps } from 'better-auth-vipps'

export const auth = betterAuth({
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

`vipps` returns the public generic OAuth configuration type exported by the
supported Better Auth version. Exported types are `VippsOptions` and
`VippsProfile`. The example omits application database configuration.

| Option                                   | Proposed behavior                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`, `clientSecret`               | Required, nonempty server-side credentials.                                                                                                                 |
| `environment`                            | Required union of `test` and `production`; no implicit environment switch.                                                                                  |
| `providerId`                             | Defaults to `vipps`; allow explicit IDs for distinct merchant configurations.                                                                               |
| `scopes`                                 | Defaults to `openid`, `name`, `email`; always require `openid` and the identity fields needed by v1. Additional scopes require explicit application intent. |
| `redirectURI`                            | Optional override; otherwise use Better Auth's callback for this provider ID.                                                                               |
| `disableSignUp`, `disableImplicitSignUp` | Pass through the supported Better Auth semantics.                                                                                                           |

The current helper requires `subscriptionKey` and `merchantSerialNumber` in
addition to the client credentials. Vipps's merchant quick start sends the
subscription key to UserInfo and uses Basic authentication for token exchange.
The optional `scopes` proposal above is deferred; the implementation fixes
`openid name email`. Partner-key flows are not supported.

System identification headers name this package and derive the plugin version and
pinned Better Auth version from `package.json`, keeping the runtime values aligned
with release metadata.

The exact client sign-in call and callback path must be documented for the pinned
Better Auth version. Current documentation uses `signIn.social` and
`/api/auth/callback/:providerId`; older generic OAuth releases used different APIs.
Do not advertise a broad peer range until those differences have been tested.

## Protocol and request behavior

Use the environment's OIDC discovery document to resolve protocol endpoints.
The production issuer baseline is
`https://api.vipps.no/access-management-1.0/access/`; the test host is
`apitest.vipps.no`. Verify exact issuer and discovery URL values against current
Vipps documentation before implementation.

Preserve Better Auth's state, nonce, PKCE, issuer, signature, audience, and token
expiry checks. Do not treat JWT decoding as verification. Confirm that the chosen
Better Auth release validates tokens even when custom token or UserInfo callbacks
are used. Fail closed on invalid discovery, invalid tokens, and subject mismatch
between an ID token and UserInfo.

Use public request customization hooks for any required Vipps headers. Prefer the
built-in token exchange when possible; if an override is needed, test that it
retains the redirect URI, authorization code, and PKCE verifier. Server credentials
must never be sent to the browser or to an endpoint outside the chosen environment.

Transport errors, denied consent, missing authorization codes, and malformed
provider responses must end the login without creating a session. Report actionable
errors through Better Auth's supported error path. Do not expose raw token
responses, authorization codes, client secrets, or full personal profiles in logs.

## Identity and account behavior

Use the provider's `sub` as the external account identifier. Vipps documents it as
merchant-specific. Email and phone numbers must not replace it. Distinct merchant
configurations need distinct provider IDs so their account identities stay separate.

Map the available name and email to Better Auth's user fields. Only set
`emailVerified` when the provider explicitly supplies boolean `true`. The current
Login documentation says shared email is verified, but code must still validate
incoming data. Never fabricate an email address when it is missing. For the first
release, reject a profile missing the email needed by Better Auth and explain how
to check the email scope. A phone-only design can be evaluated separately.

Do not enable a trusted-provider bypass or silently change the application's
account-linking policy. Document and test the supported Better Auth version's
verified-email linking behavior, including a collision with an existing user.
Extra claims such as phone number should only be persisted through explicit
application mapping. No new database tables or required columns are planned.

## Tooling and repository conventions

The scaffold follows `zod-to-protobuf`, `add-function-return-types`,
`migrate-barrel-imports`, `effectful-better-auth`, and `catalog-update-action` in
Martin Brandhaug's IdeaProjects directory:

- Bun with pinned `catalog:` development dependencies and a committed lockfile.
- Strict TypeScript with a separate declaration/build configuration.
- Oxlint with type-aware rules and Ultracite's anti-slop plugin; Oxfmt formatting.
- Bun tests, lint-staged pre-commit hooks, and Fallow dead-code regression checks.
- Conventional Commit PR titles, `master`, release-please, and the catalog updater.
- MIT license and a single ESM package.

Better Auth 1.7.2 is the initial development dependency, matching the inspected
`effectful-better-auth` catalog. This is not a supported-version promise. Before
release, select a tested peer range and review current upstream security fixes.
Do not add Effect merely because a neighboring project uses it.

The package is a release candidate, but publishing remains gated on live
verification and release checks. Tests no longer allow an empty suite; temporary
empty-file and unused-dependency exemptions have been removed.

### Effect decision

The API must remain free of Effect types, runtime configuration, and imports.
The minimal implementation delegates OAuth to Better Auth and adds one bounded
UserInfo request with profile validation. Plain TypeScript is sufficient; Effect
is not a dependency. Reconsider it only if custom request workflows become complex
enough to justify an internal runtime. Any future adoption must keep emitted
public declarations and callback errors free of Effect-specific types and causes.

### Verified locally and still pending

Tests use a local OIDC HTTP server, signed JWTs, Better Auth's memory adapter, and
its actual browser callbacks. They verify session creation, repeat login across
email changes, both environments, Basic token authentication, PKCE, headers,
invalid state/nonce/signature/issuer/audience/expiry, subject mismatch, missing
email or ID token, malformed responses, HTTP failure, consent denial, and sign-up
restriction. Non-boolean verification claims remain unverified.

Still pending: live test-merchant login on desktop and mobile, existing-account
linking and collision scenarios, coexistence with another provider, UserInfo
timeout and discovery-failure coverage, and broader runtime/version compatibility.
The production-host test redirects HTTP transport to the local test server; it
does not contact Vipps. Package metadata and release validation are now checked
by the build and release workflows.

The release workflow runs on `master` pushes and manual dispatch; release-please
gates publishing on a newly created release. The catalog updater runs on its
schedule, relevant package or lockfile changes, and manual dispatch. Running a
release requires live verification, CI_PAT setup for release-please, and npm
trusted publishing for this repository and its `release` environment. Do not
publish until the remaining manual checks pass.

## Verification and acceptance criteria

Tests should exercise behavior through a real Better Auth instance backed by a
temporary database and a controlled OIDC test server wherever feasible. Do not
replace the OAuth callback logic with mocks and then claim the flow is verified.

Before the first release, demonstrate:

1. A successful code exchange creates a user and session; repeat login reuses the
   external account even when the user's email changes.
2. Test and production configuration use their own endpoints and credentials.
3. Wrong state, nonce, issuer, audience, signature, expiry, or subject is rejected.
4. PKCE and exact redirect URI handling survive any request customization.
5. Denied consent, provider errors, incomplete profiles, and malformed JSON create
   no user/session and do not leak secrets.
6. Verified and unverified email linking follow explicit application policy;
   missing-email and existing-account collisions have documented outcomes.
7. Sign-up restrictions and coexistence with another OAuth provider work.
8. The packed ESM package imports with working declarations in the supported Node
   and Bun versions. Package contents contain no test credentials or local files.
9. One manual test with Vipps test credentials completes desktop and mobile-browser
   login. Record date, versions, and steps without storing credentials.

## Implementation sequence and open questions

First, verify a minimal generic OAuth integration using a test merchant and pin the
Better Auth version. Resolve required headers, token authentication, discovery,
callback paths, email requirements, and any need for custom HTTP hooks. Record the
findings before finalizing the options interface.

Next, implement the helper and meaningful callback tests. Add the runnable example
and troubleshooting guide. Validate package output and actual Vipps login before
configuring npm publishing. Once stable, consider submitting the package to Better
Auth's community provider list or contributing the helper upstream.

## Primary protocol references

- [Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- [Better Auth users and accounts](https://better-auth.com/docs/concepts/users-accounts)
- [Vipps browser flow](https://developer.vippsmobilepay.com/docs/APIs/login-api/api-guide/browser-flow-integration/)
- [Vipps Login UserInfo](https://developer.vippsmobilepay.com/docs/APIs/login-api/api-guide/user-info/)
- [Vipps integration checklist](https://developer.vippsmobilepay.com/docs/APIs/login-api/login-api-checklist/)
- [Vipps quick start](https://developer.vippsmobilepay.com/docs/APIs/login-api/login-api-quick-start/)
