import { afterEach, expect, spyOn, test } from 'bun:test'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { genericOAuth } from 'better-auth/plugins'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { vipps, type VippsOptions } from '../src/index'

const options: VippsOptions = {
	clientId: 'test-client',
	clientSecret: 'test-secret',
	subscriptionKey: 'test-subscription',
	merchantSerialNumber: '123456',
	environment: 'test'
}
const cleanup: Array<() => void> = []
afterEach(() => {
	while (cleanup.length > 0) {
		cleanup.pop()?.()
	}
})

type TokenOverrides = {
	nonce?: string
	issuer?: string
	audience?: string
	expired?: boolean
	signingKey?: CryptoKey
	response?: (idToken: string) => Response | Promise<Response>
}

type UserInfoOverrides = {
	response?: (
		request: Request,
		requestCount: number
	) => Response | Promise<Response>
}

type CallbackOverrides = {
	state?: string
	error?: string
}

type FixtureOptions = {
	disableSignUp?: boolean
	environment?: VippsOptions['environment']
	token?: TokenOverrides
	userInfo?: UserInfoOverrides
	callback?: CallbackOverrides
}

async function createLoginFixture({
	disableSignUp = false,
	environment = 'test',
	token = {},
	userInfo = {},
	callback = {}
}: FixtureOptions = {}) {
	const hostname = environment === 'test' ? 'apitest.vipps.no' : 'api.vipps.no'
	const issuer = `https://${hostname}/access-management-1.0/access/`
	const database = { user: [], session: [], account: [], verification: [] }
	let nonce = ''
	let challenge = ''
	let tokenRequests = 0
	let profileRequests = 0
	let transportValid = false
	let profileTransportValid = false

	const keys = await generateKeyPair('RS256')
	const jwk = await exportJWK(keys.publicKey)
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url)
			if (url.pathname.endsWith('openid-configuration')) {
				return Response.json({
					issuer,
					authorization_endpoint: `${issuer}oauth2/auth`,
					token_endpoint: `${issuer}oauth2/token`,
					userinfo_endpoint: `https://${hostname}/vipps-userinfo-api/userinfo/`,
					jwks_uri: `${url.origin}/jwks`,
					id_token_signing_alg_values_supported: ['RS256']
				})
			}
			if (url.pathname === '/jwks') {
				return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] })
			}
			if (url.pathname.endsWith('/token')) {
				tokenRequests += 1
				const body = new URLSearchParams(await request.text())
				const verifier = body.get('code_verifier') ?? ''
				const digest = new Bun.CryptoHasher('sha256')
					.update(verifier)
					.digest('base64url')
				transportValid =
					request.headers.get('authorization') ===
						`Basic ${btoa('test-client:test-secret')}` &&
					body.get('redirect_uri') ===
						'http://localhost:3000/api/auth/callback/vipps' &&
					body.get('code') === 'test-code' &&
					body.get('grant_type') === 'authorization_code' &&
					digest === challenge &&
					request.headers.get('merchant-serial-number') === '123456'
				if (!transportValid) {
					return Response.json({ error: 'invalid_request' }, { status: 400 })
				}
				const idToken = await new SignJWT({ nonce: token.nonce ?? nonce })
					.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
					.setIssuer(token.issuer ?? issuer)
					.setAudience(token.audience ?? 'test-client')
					.setSubject('merchant-subject')
					.setIssuedAt()
					.setExpirationTime(token.expired ? '0s' : '5m')
					.sign(
						token.signingKey === undefined ? keys.privateKey : token.signingKey
					)
				if (token.response) {
					return token.response(idToken)
				}
				return Response.json({
					access_token: 'test-access',
					token_type: 'Bearer',
					id_token: idToken
				})
			}
			if (url.pathname === '/vipps-userinfo-api/userinfo/') {
				profileRequests += 1
				profileTransportValid =
					request.headers.get('authorization') === 'Bearer test-access' &&
					request.headers.get('ocp-apim-subscription-key') ===
						'test-subscription' &&
					request.headers.get('merchant-serial-number') === '123456'
				if (!profileTransportValid) {
					return new Response(null, { status: 401 })
				}
				if (userInfo.response) {
					return userInfo.response(request, profileRequests)
				}
				return Response.json({
					sub: 'merchant-subject',
					name: 'Test User',
					email: 'test@example.com',
					email_verified: true
				})
			}
			return new Response(null, { status: 404 })
		}
	})
	cleanup.push(() => void server.stop(true))

	const originalFetch = globalThis.fetch
	const transport = Object.assign(
		(input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			if (url.hostname === hostname) {
				url.protocol = 'http:'
				url.host = `localhost:${server.port}`
				return originalFetch(new Request(url, request))
			}
			if (url.hostname !== 'localhost') {
				throw new Error('Unexpected external network request')
			}
			return originalFetch(request)
		},
		{ preconnect: originalFetch.preconnect }
	)
	const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(transport)
	cleanup.push(() => fetchSpy.mockRestore())
	const auth = betterAuth({
		baseURL: 'http://localhost:3000',
		secret: 'test-only-secret-with-at-least-thirty-two-characters',
		database: memoryAdapter(database),
		logger: { disabled: true },
		plugins: [
			genericOAuth({
				config: [vipps({ ...options, disableSignUp, environment })]
			})
		]
	})

	async function login() {
		const signIn = await auth.handler(
			new Request('http://localhost:3000/api/auth/sign-in/social', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Origin: 'http://localhost:3000'
				},
				body: JSON.stringify({
					provider: 'vipps',
					callbackURL: 'http://localhost:3000/done'
				})
			})
		)
		const result: unknown = await signIn.json()
		if (
			typeof result !== 'object' ||
			result === null ||
			!('url' in result) ||
			typeof result.url !== 'string'
		) {
			throw new Error(`Could not start login: ${JSON.stringify(result)}`)
		}
		const authorization = new URL(result.url)
		nonce = authorization.searchParams.get('nonce') ?? ''
		challenge = authorization.searchParams.get('code_challenge') ?? ''
		expect(nonce).not.toBe('')
		expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
		const callbackURL = new URL('http://localhost:3000/api/auth/callback/vipps')
		callbackURL.searchParams.set(
			'state',
			callback.state ?? authorization.searchParams.get('state') ?? ''
		)
		callbackURL.searchParams.set(
			callback.error ? 'error' : 'code',
			callback.error ?? 'test-code'
		)
		const cookies = signIn.headers
			.getSetCookie()
			.map((cookie) => cookie.split(';')[0])
			.join('; ')
		return auth.handler(
			new Request(callbackURL, { headers: { Cookie: cookies } })
		)
	}

	return {
		auth,
		database,
		login,
		get tokenRequests() {
			return tokenRequests
		},
		get profileRequests() {
			return profileRequests
		},
		get transportValid() {
			return transportValid
		},
		get profileTransportValid() {
			return profileTransportValid
		}
	}
}

test('completes browser login with PKCE, required headers, and a real Better Auth session', async () => {
	const fixture = await createLoginFixture()
	const response = await fixture.login()
	expect(fixture.transportValid).toBe(true)
	expect(response.headers.get('location')).toBe('http://localhost:3000/done')
	expect(fixture.database.user).toHaveLength(1)
	expect(fixture.database.account).toHaveLength(1)
	expect(fixture.database.session).toHaveLength(1)
	expect(fixture.database.user[0]).toEqual(
		expect.objectContaining({ email: 'test@example.com', emailVerified: true })
	)
	const cookies = response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0])
		.join('; ')
	const session = await fixture.auth.api.getSession({
		headers: new Headers({ Cookie: cookies })
	})
	expect(session?.user.email).toBe('test@example.com')
})

function expectRejected(
	response: Response,
	fixture: Awaited<ReturnType<typeof createLoginFixture>>,
	error: string
) {
	expect(
		new URL(response.headers.get('location') ?? '').searchParams.get('error')
	).toBe(error)
	expect(fixture.database.user).toHaveLength(0)
	expect(fixture.database.account).toHaveLength(0)
	expect(fixture.database.session).toHaveLength(0)
}

const invalidIdTokenCases = [
	['nonce mismatch', { nonce: 'wrong' }],
	['issuer mismatch', { issuer: 'https://wrong.example' }],
	['audience mismatch', { audience: 'wrong' }],
	['expired token', { expired: true }]
] as const
for (const [name, token] of invalidIdTokenCases) {
	test(`rejects ${name} before UserInfo`, async () => {
		const fixture = await createLoginFixture({ token })
		const response = await fixture.login()
		expectRejected(response, fixture, 'unable_to_get_user_info')
		expect(fixture.tokenRequests).toBe(1)
		expect(fixture.profileRequests).toBe(0)
	})
}

test('rejects an invalid signature before UserInfo', async () => {
	const { privateKey } = await generateKeyPair('RS256')
	const fixture = await createLoginFixture({
		token: { signingKey: privateKey }
	})
	const response = await fixture.login()
	expectRejected(response, fixture, 'unable_to_get_user_info')
	expect(fixture.tokenRequests).toBe(1)
	expect(fixture.profileRequests).toBe(0)
})

const userInfoCases = [
	[
		'subject mismatch',
		{
			response: () =>
				Response.json({
					sub: 'someone-else',
					name: 'Test User',
					email: 'test@example.com'
				})
		}
	],
	[
		'missing email',
		{
			response: () =>
				Response.json({
					sub: 'merchant-subject',
					name: 'Test User',
					email: null
				})
		}
	],
	['malformed response', { response: () => new Response('{broken') }],
	[
		'HTTP error',
		{ response: () => new Response('provider error', { status: 503 }) }
	],
	[
		'redirect response',
		{
			response: () =>
				Response.redirect('https://unexpected.example/userinfo', 302)
		}
	]
] as const
for (const [name, userInfo] of userInfoCases) {
	test(`rejects ${name} after requesting UserInfo`, async () => {
		const fixture = await createLoginFixture({ userInfo })
		const response = await fixture.login()
		expectRejected(response, fixture, 'unable_to_get_user_info')
		expect(fixture.tokenRequests).toBe(1)
		expect(fixture.profileRequests).toBe(1)
		expect(fixture.profileTransportValid).toBe(true)
	})
}

test('rejects a token endpoint redirect before UserInfo', async () => {
	const fixture = await createLoginFixture({
		token: {
			response: () => Response.redirect('https://unexpected.example/token', 302)
		}
	})
	const response = await fixture.login()
	expectRejected(response, fixture, 'invalid_code')
	expect(fixture.tokenRequests).toBe(1)
	expect(fixture.profileRequests).toBe(0)
	expect(fixture.transportValid).toBe(true)
})

test('rejects a token response without an ID token before UserInfo', async () => {
	const fixture = await createLoginFixture({
		token: {
			response: () =>
				Response.json({ access_token: 'test-access', token_type: 'Bearer' })
		}
	})
	const response = await fixture.login()
	expectRejected(response, fixture, 'unable_to_get_user_info')
	expect(fixture.tokenRequests).toBe(1)
	expect(fixture.profileRequests).toBe(0)
})

test('passes provider denial through without making a token request', async () => {
	const fixture = await createLoginFixture({
		callback: { error: 'access_denied' }
	})
	const response = await fixture.login()
	expectRejected(response, fixture, 'access_denied')
	expect(fixture.tokenRequests).toBe(0)
	expect(fixture.profileRequests).toBe(0)
})

test('rejects an invalid OAuth state without making a token request', async () => {
	const fixture = await createLoginFixture({
		callback: { state: 'invalid-state' }
	})
	const response = await fixture.login()
	expect(
		new URL(response.headers.get('location') ?? '').searchParams.get('error')
	).toBe('state_mismatch')
	expect(fixture.database.user).toHaveLength(0)
	expect(fixture.database.account).toHaveLength(0)
	expect(fixture.database.session).toHaveLength(0)
	expect(fixture.tokenRequests).toBe(0)
	expect(fixture.profileRequests).toBe(0)
})

test('does not promote a string verification claim to verified', async () => {
	const fixture = await createLoginFixture({
		userInfo: {
			response: () =>
				Response.json({
					sub: 'merchant-subject',
					name: 'Test User',
					email: 'test@example.com',
					email_verified: 'true'
				})
		}
	})
	await fixture.login()
	expect(fixture.database.user[0]).toEqual(
		expect.objectContaining({ emailVerified: false })
	)
})

test('honors disabled sign-up without creating partial records', async () => {
	const fixture = await createLoginFixture({ disableSignUp: true })
	const response = await fixture.login()
	expectRejected(response, fixture, 'signup_disabled')
	expect(fixture.tokenRequests).toBe(1)
	expect(fixture.profileRequests).toBe(1)
	expect(fixture.profileTransportValid).toBe(true)
})

test('rejects incomplete credentials before any network request', () => {
	for (const field of [
		'clientId',
		'clientSecret',
		'subscriptionKey',
		'merchantSerialNumber'
	] as const) {
		expect(() => vipps({ ...options, [field]: ' ' })).toThrow(field)
	}
})

test('uses the production environment throughout the browser flow', async () => {
	const fixture = await createLoginFixture({ environment: 'production' })
	await fixture.login()
	expect(fixture.transportValid).toBe(true)
	expect(fixture.database.session).toHaveLength(1)
})

test('reuses the external account after the provider email changes', async () => {
	const fixture = await createLoginFixture({
		userInfo: {
			response: (_request, requestCount) =>
				Response.json({
					sub: 'merchant-subject',
					name: 'Test User',
					email:
						requestCount === 1 ? 'test@example.com' : 'changed@example.com',
					email_verified: true
				})
		}
	})
	const firstResponse = await fixture.login()
	const secondResponse = await fixture.login()
	expect(firstResponse.headers.get('location')).toBe(
		'http://localhost:3000/done'
	)
	expect(secondResponse.headers.get('location')).toBe(
		'http://localhost:3000/done'
	)
	expect(fixture.profileRequests).toBe(2)
	expect(fixture.database.user).toHaveLength(1)
	expect(fixture.database.account).toHaveLength(1)
})
