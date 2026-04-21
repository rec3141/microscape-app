<svelte:head><title>Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-semibold">Admin</h1>
		<p class="text-sm text-slate-400">Lab settings, users, invites, API keys, and run access management.</p>
	</header>

	<ul class="grid gap-3 sm:grid-cols-2">
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/runs" class="block p-4">
				<div class="text-white font-semibold">Runs</div>
				<div class="text-sm text-slate-400 mt-1">Register pipeline outputs and manage per-user access grants.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/invites" class="block p-4">
				<div class="text-white font-semibold">Invites</div>
				<div class="text-sm text-slate-400 mt-1">Generate one-time invite links with a chosen role.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/users" class="block p-4">
				<div class="text-white font-semibold">Users</div>
				<div class="text-sm text-slate-400 mt-1">List lab members, adjust roles, reset local passwords, remove members.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/api-keys" class="block p-4">
				<div class="text-white font-semibold">API keys</div>
				<div class="text-sm text-slate-400 mt-1">Bearer tokens for external pipelines to deploy runs via POST /api/v1/deploy.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 hover:border-ocean-600 transition-colors">
			<a href="/settings/feedback" class="block p-4">
				<div class="text-white font-semibold">Feedback</div>
				<div class="text-sm text-slate-400 mt-1">Review messages submitted via the in-app feedback form.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
			<div class="text-slate-300 font-semibold">Backups</div>
			<div class="mt-1">UI pending. Configure a per-lab GitHub repo + PAT via <code class="text-slate-400">/api/lab/settings</code> to enable snapshots.</div>
		</li>
	</ul>
</div>
