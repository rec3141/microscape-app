<svelte:head><title>Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-semibold">Admin</h1>
		<p class="text-sm text-slate-400">Lab settings, users, invites, and run access management.</p>
	</header>

	<ul class="grid gap-3 sm:grid-cols-2">
		<li class="rounded border border-slate-800 bg-slate-900/40 p-4 hover:border-ocean-600 transition-colors">
			<a href="/settings/runs" class="block">
				<div class="text-white font-semibold">Runs</div>
				<div class="text-sm text-slate-400 mt-1">Register pipeline outputs and manage per-user access grants.</div>
			</a>
		</li>
		<li class="rounded border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
			<div class="text-slate-300 font-semibold">Users · invites · backups</div>
			<div class="mt-1">
				UIs pending. Backing endpoints
				(<code class="text-slate-400">/api/users</code>,
				<code class="text-slate-400">/api/invites</code>,
				<code class="text-slate-400">/api/lab/settings</code>,
				<code class="text-slate-400">/api/db/*</code>)
				are live.
			</div>
		</li>
	</ul>
</div>
