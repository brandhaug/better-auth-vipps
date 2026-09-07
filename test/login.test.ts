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

type Scenario =
	| 'success'
	| 'nonce'
	| 'issuer'
	| 'audience'
	| 'expired'
	| 'signature'
	| 'subject'
	| 'missing-email'
	| 'unverified'
	| 'malformed'
	| 'http-error'
	| 'missing-token'
	| 'denied'
	| 'state'
	| 'repeat'

async function exercise(
	scenario: Scenario,
	disableSignUp = false,
	environment: VippsOptions['environment'] = 'test'
) {
	const hostname = environment === 'test' ? 'apitest.vipps.no' : 'api.vipps.no'
	const issuer = `https://${hostname}/access-management-1.0/access/`
	const keys = await generateKeyPair('RS256')
	const foreignKeys = await generateKeyPair('RS256')
	const jwk = await exportJWK(keys.publicKey)
	const database = { user: [], session: [], account: [], verification: [] }
	let nonce = ''
	let challenge = ''
	let tokenRequests = 0
	let profileRequests = 0
	let transportValid = false
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
				const idToken = await new SignJWT({
					nonce: scenario === 'nonce' ? 'wrong' : nonce
				})
					.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
					.setIssuer(scenario === 'issuer' ? 'https://wrong.example' : issuer)
					.setAudience(scenario === 'audience' ? 'wrong' : 'test-client')
					.setSubject('merchant-subject')
					.setIssuedAt()
					.setExpirationTime(scenario === 'expired' ? '0s' : '5m')
					.sign(
						scenario === 'signature' ? foreignKeys.privateKey : keys.privateKey
					)
				if (scenario === 'missing-token') {
					return Response.json({
						access_token: 'test-access',
						token_type: 'Bearer'
					})
				}
				return Response.json({
					access_token: 'test-access',
					token_type: 'Bearer',
					id_token: idToken
				})
			}
			if (url.pathname === '/vipps-userinfo-api/userinfo/') {
				profileRequests += 1
				const email =
					profileRequests > 1 ? 'changed@example.com' : 'test@example.com'
				if (
					request.headers.get('authorization') !== 'Bearer test-access' ||
					request.headers.get('ocp-apim-subscription-key') !==
						'test-subscription' ||
					request.headers.get('merchant-serial-number') !== '123456'
				) {
					return new Response(null, { status: 401 })
				}
				if (scenario === 'http-error') {
					return new Response('secret provider error', { status: 503 })
				}
				if (scenario === 'malformed') {
					return new Response('{broken')
				}
				return Response.json({
					sub: scenario === 'subject' ? 'someone-else' : 'merchant-subject',
					name: 'Test User',
					email: scenario === 'missing-email' ? null : email,
					email_verified: scenario === 'unverified' ? 'true' : true
				})
			}
			return new Response(null, { status: 404 })
		}
	})
	cleanup.push(() => {
		void server.stop(true)
	})
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
		const callback = new URL('http://localhost:3000/api/auth/callback/vipps')
		callback.searchParams.set(
			'state',
			scenario === 'state'
				? 'invalid-state'
				: (authorization.searchParams.get('state') ?? '')
		)
		callback.searchParams.set(
			scenario === 'denied' ? 'error' : 'code',
			scenario === 'denied' ? 'access_denied' : 'test-code'
		)
		const cookies = signIn.headers
			.getSetCookie()
			.map((cookie) => cookie.split(';')[0])
			.join('; ')
		return auth.handler(new Request(callback, { headers: { Cookie: cookies } }))
	}
	let response = await login()
	if (scenario === 'repeat') {
		response = await login()
	}
	return {
		database,
		response,
		tokenRequests,
		profileRequests,
		transportValid,
		auth
	}
}

test('completes browser login with PKCE, required headers, and a real Better Auth session', async () => {
	const result = await exercise('success')
	expect(result.transportValid).toBe(true)
	expect(result.response.headers.get('location')).toBe(
		'http://localhost:3000/done'
	)
	expect(result.database.user).toHaveLength(1)
	expect(result.database.account).toHaveLength(1)
	expect(result.database.session).toHaveLength(1)
	expect(result.database.user[0]).toEqual(
		expect.objectContaining({ email: 'test@example.com', emailVerified: true })
	)
	const cookies = result.response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0])
		.join('; ')
	const session = await result.auth.api.getSession({
		headers: new Headers({ Cookie: cookies })
	})
	expect(session?.user.email).toBe('test@example.com')
})

for (const scenario of [
	'nonce',
	'issuer',
	'audience',
	'expired',
	'signature',
	'subject',
	'missing-email',
	'malformed',
	'http-error',
	'missing-token',
	'denied',
	'state'
] as const) {
	test(`rejects ${scenario} without creating a user or session`, async () => {
		const result = await exercise(scenario)
		expect(result.database.user).toHaveLength(0)
		expect(result.database.session).toHaveLength(0)
		expect(result.response.headers.get('location')).not.toBe(
			'http://localhost:3000/done'
		)
		if (scenario === 'denied' || scenario === 'state') {
			expect(result.tokenRequests).toBe(0)
		}
		if (
			['nonce', 'issuer', 'audience', 'expired', 'signature'].includes(scenario)
		) {
			expect(result.profileRequests).toBe(0)
		}
	})
}

test('does not promote a string verification claim to verified', async () => {
	const result = await exercise('unverified')
	expect(result.database.user[0]).toEqual(
		expect.objectContaining({ emailVerified: false })
	)
})

test('honors disabled sign-up', async () => {
	const result = await exercise('success', true)
	expect(result.database.user).toHaveLength(0)
	expect(result.database.session).toHaveLength(0)
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
	const result = await exercise('success', false, 'production')
	expect(result.transportValid).toBe(true)
	expect(result.database.session).toHaveLength(1)
})

test('reuses the external account after the provider email changes', async () => {
	const result = await exercise('repeat')
	expect(result.response.headers.get('location')).toBe(
		'http://localhost:3000/done'
	)
	expect(result.profileRequests).toBe(2)
	expect(result.database.user).toHaveLength(1)
	expect(result.database.account).toHaveLength(1)
})
