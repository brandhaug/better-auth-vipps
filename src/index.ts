import { type GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'
import { decodeJwt } from 'jose'

/** Merchant credentials and browser-login configuration. Keep these on the server. */
export type VippsOptions = {
	clientId: string
	clientSecret: string
	subscriptionKey: string
	merchantSerialNumber: string
	environment: 'test' | 'production'
	providerId?: string
	redirectURI?: string
	disableSignUp?: boolean
	disableImplicitSignUp?: boolean
}

/** Identity fields consumed from Vipps UserInfo. Additional claims are discarded. */
export type VippsProfile = {
	sub: string
	name: string
	email: string
	email_verified: boolean
}

function isNonempty(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0
}

function parseProfile(value: unknown): VippsProfile | null {
	if (typeof value !== 'object' || value === null) {
		return null
	}
	if (
		!('sub' in value) ||
		!isNonempty(value.sub) ||
		!('name' in value) ||
		!isNonempty(value.name) ||
		!('email' in value) ||
		!isNonempty(value.email)
	) {
		return null
	}
	return {
		sub: value.sub,
		name: value.name,
		email: value.email,
		email_verified: 'email_verified' in value && value.email_verified === true
	}
}

/** Configure Vipps merchant Login through Better Auth's genericOAuth plugin. */
export function vipps(options: VippsOptions): GenericOAuthConfig {
	for (const field of [
		'clientId',
		'clientSecret',
		'subscriptionKey',
		'merchantSerialNumber'
	] as const) {
		if (!isNonempty(options[field])) {
			throw new TypeError(`Vipps requires a nonempty ${field}`)
		}
	}
	if (!['test', 'production'].includes(options.environment)) {
		throw new TypeError('Vipps environment must be test or production')
	}
	const providerId = options.providerId ?? 'vipps'
	if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) {
		throw new TypeError(
			'Vipps providerId must contain only letters, digits, underscores, or hyphens'
		)
	}
	const origin =
		options.environment === 'production'
			? 'https://api.vipps.no'
			: 'https://apitest.vipps.no'
	const issuer = `${origin}/access-management-1.0/access/`
	const headers = {
		'Merchant-Serial-Number': options.merchantSerialNumber,
		'Vipps-System-Name': 'better-auth',
		'Vipps-System-Version': '1.7.2',
		'Vipps-System-Plugin-Name': 'better-auth-vipps',
		'Vipps-System-Plugin-Version': '0.0.0'
	}
	const subscriptionKey = options.subscriptionKey
	const clientId = options.clientId
	return {
		providerId,
		name: 'Vipps',
		clientId,
		clientSecret: options.clientSecret,
		discoveryUrl: `${issuer}.well-known/openid-configuration`,
		accountIssuer: issuer,
		discoveryHeaders: headers,
		authorizationHeaders: headers,
		tokenEndpointAuth: { method: 'client_secret_basic' },
		requireIdTokenVerification: true,
		pkce: true,
		scopes: ['openid', 'name', 'email'],
		// Vipps discovery advertises a logout endpoint named "not-in-use".
		disableProviderLogout: true,
		redirectURI: options.redirectURI,
		disableSignUp: options.disableSignUp,
		disableImplicitSignUp: options.disableImplicitSignUp,
		async getUserInfo(tokens) {
			if (!tokens.idToken || !tokens.accessToken) {
				return null
			}
			try {
				// Better Auth 1.7.2 verifies the signature, audience, expiry, and nonce
				// before invoking this callback. Decoding here binds UserInfo to that
				// verified identity; this function is not a standalone token verifier.
				const claims = decodeJwt(tokens.idToken)
				const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
				if (
					claims.iss !== issuer ||
					!audiences.includes(clientId) ||
					!isNonempty(claims.sub)
				) {
					return null
				}
				const response = await fetch(`${origin}/vipps-userinfo-api/userinfo/`, {
					headers: {
						...headers,
						Authorization: `Bearer ${tokens.accessToken}`,
						'Ocp-Apim-Subscription-Key': subscriptionKey
					},
					redirect: 'error',
					signal: AbortSignal.timeout(10_000)
				})
				if (!response.ok) {
					return null
				}
				const body: unknown = await response.json()
				const profile = parseProfile(body)
				if (!profile || profile.sub !== claims.sub) {
					return null
				}
				return {
					sub: profile.sub,
					name: profile.name,
					email: profile.email,
					emailVerified: profile.email_verified
				}
			} catch {
				// Better Auth turns a null profile into its standard failed-login path.
				// Do not forward provider bodies or transport errors containing tokens.
				return null
			}
		}
	}
}
