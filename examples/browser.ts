import { Database } from 'bun:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { genericOAuth } from 'better-auth/plugins'
import { vipps } from '../src/index'

const baseURL = Bun.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
const secret = Bun.env.BETTER_AUTH_SECRET
if (!secret || secret.length < 32) {
	throw new Error('Set BETTER_AUTH_SECRET to at least 32 random characters')
}
const configuration = {
	baseURL,
	secret,
	database: new Database('vipps-example.sqlite'),
	plugins: [
		genericOAuth({
			config: [
				vipps({
					clientId: Bun.env.VIPPS_CLIENT_ID ?? '',
					clientSecret: Bun.env.VIPPS_CLIENT_SECRET ?? '',
					subscriptionKey: Bun.env.VIPPS_SUBSCRIPTION_KEY ?? '',
					merchantSerialNumber: Bun.env.VIPPS_MERCHANT_SERIAL_NUMBER ?? '',
					environment: 'test'
				})
			]
		})
	]
}
const { runMigrations } = await getMigrations(configuration)
await runMigrations()
const auth = betterAuth(configuration)
const page = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Vipps Login development example</title>
<body><h1>Vipps Login development example</h1>
<p>This example uses the Vipps test environment. Use official Vipps buttons before deploying.</p>
<button id="login">Start test login</button><pre id="error"></pre>
<script>
document.getElementById('login').onclick = async () => {
 const response = await fetch('/api/auth/sign-in/social', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({provider: 'vipps', callbackURL: '/session'})
 });
 const result = await response.json();
 if (response.ok && result.url) location.assign(result.url);
 else document.getElementById('error').textContent = 'Login could not start. Check server configuration.';
};
</script></body></html>`
const server = Bun.serve({
	port: 3000,
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname.startsWith('/api/auth/')) {
			return auth.handler(request)
		}
		if (url.pathname === '/session') {
			const session = await auth.api.getSession({ headers: request.headers })
			return Response.json(
				session
					? { name: session.user.name, email: session.user.email }
					: { signedIn: false },
				{
					headers: { 'Cache-Control': 'no-store' }
				}
			)
		}
		return new Response(page, {
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		})
	}
})
console.info(
	`Development server listening on ${server.url}; public base URL: ${baseURL}`
)
