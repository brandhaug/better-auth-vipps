import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const destination = mkdtempSync(join(tmpdir(), 'better-auth-vipps-pack-'))
const output = process.env.PACK_CHECK_OUTPUT
const artifact = output ?? join(destination, 'package.tgz')
const packageJson = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const betterAuthVersion = packageJson.peerDependencies['better-auth']
const typescriptVersion = packageJson.catalog.typescript

try {
	execFileSync(
		'bun',
		['pm', 'pack', '--filename', artifact, '--ignore-scripts', '--quiet'],
		{ stdio: ['ignore', 'inherit', 'inherit'] }
	)
	const packageDirectory = join(destination, 'package')
	execFileSync('tar', ['-xzf', artifact, '-C', destination])
	const pack = JSON.parse(
		readFileSync(join(packageDirectory, 'package.json'), 'utf8')
	)
	if (!readFileSync(join(packageDirectory, 'dist/index.js'), 'utf8')) {
		throw new Error('Packed package does not contain dist/index.js')
	}
	if (!readFileSync(join(packageDirectory, 'dist/index.d.ts'), 'utf8')) {
		throw new Error('Packed package does not contain dist/index.d.ts')
	}
	if (pack.private === true) {
		throw new Error('Package is still marked private')
	}
	for (const dependency of Object.values(pack.dependencies ?? {})) {
		if (dependency === 'catalog:') {
			throw new Error(
				'Packed package contains an unresolved catalog dependency'
			)
		}
	}

	const consumer = join(destination, 'consumer')
	execFileSync(
		'npm',
		[
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--prefix',
			consumer,
			artifact,
			`better-auth@${betterAuthVersion}`,
			`typescript@${typescriptVersion}`
		],
		{ stdio: ['ignore', 'inherit', 'inherit'] }
	)
	writeFileSync(
		join(consumer, 'consumer.mts'),
		"import { vipps, type VippsOptions } from 'better-auth-vipps'\nconst options: VippsOptions = { clientId: 'id', clientSecret: 'secret', subscriptionKey: 'subscription', merchantSerialNumber: 'serial', environment: 'test' }\nvipps(options)\n"
	)
	execFileSync(
		'node',
		[
			join(consumer, 'node_modules/typescript/bin/tsc'),
			'--noEmit',
			'--strict',
			'--skipLibCheck',
			'--target',
			'ES2022',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			'--ignoreConfig',
			join(consumer, 'consumer.mts')
		],
		{ stdio: ['ignore', 'inherit', 'inherit'] }
	)
	const smokeTest =
		"import('better-auth-vipps').then(({ vipps }) => vipps({ clientId: 'id', clientSecret: 'secret', subscriptionKey: 'subscription', merchantSerialNumber: 'serial', environment: 'test' }))"
	for (const runtime of ['node', 'bun']) {
		execFileSync(runtime, ['-e', smokeTest], {
			cwd: consumer,
			stdio: ['ignore', 'inherit', 'inherit']
		})
	}
	console.info(`Package check passed: ${artifact}`)
} finally {
	rmSync(destination, { recursive: true, force: true })
}
