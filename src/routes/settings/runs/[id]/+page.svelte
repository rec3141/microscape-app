<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	type Visibility = 'private' | 'shared' | 'public';

	interface RunRow {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		data_path: string;
		visibility: Visibility;
		pipeline_name: string;
		pipeline_slug: string;
		lab_slug: string;
		lab_name: string;
	}
	interface Grant {
		user_id: string;
		role: string;
		added_at: string;
		username: string;
		display_name: string | null;
		email: string | null;
	}
	interface GrantableUser {
		id: string;
		username: string;
		display_name: string | null;
		email: string | null;
	}

	interface Props {
		data: { run: RunRow; grants: Grant[]; grantableUsers: GrantableUser[] };
	}
	let { data }: Props = $props();

	// Edit form state — initialized from the loaded run.
	let slug = $state(data.run.slug);
	let name = $state(data.run.name);
	let dataPath = $state(data.run.data_path);
	let description = $state(data.run.description ?? '');
	let saveBusy = $state(false);
	let saveError = $state('');
	let saveOk = $state(false);

	// One sharing knob, three modes. None of these move the deployment —
	// the run stays in its owning lab regardless of who can see it.
	let visibility = $state<Visibility>(data.run.visibility);
	let sharingBusy = $state(false);
	let sharingError = $state('');

	// Already-granted user_ids — used to exclude them from the add-grant picker.
	const grantedIds = $derived(new Set(data.grants.map((g) => g.user_id)));
	const availableUsers = $derived(
		data.grantableUsers.filter((u) => !grantedIds.has(u.id))
	);

	let pickedUserId = $state('');
	let grantBusy = $state(false);
	let grantError = $state('');

	async function saveRun(e: Event) {
		e.preventDefault();
		saveBusy = true;
		saveError = '';
		saveOk = false;
		const res = await fetch(`/api/runs/${data.run.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				slug: slug.trim(),
				name: name.trim(),
				data_path: dataPath.trim(),
				description: description.trim() || null
			})
		});
		saveBusy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Save failed' }));
			saveError = body.error || body.issues?.[0]?.message || 'Save failed';
			return;
		}
		saveOk = true;
		await invalidateAll();
	}

	async function setVisibility(next: Visibility) {
		if (next === visibility) return;
		// Mirror the destructive nature of going public — the run becomes
		// readable to anyone on the internet, with no login required.
		if (next === 'public') {
			const ok = confirm(
				`Make "${data.run.name}" publicly readable?\n\n` +
					`Anyone on the internet will be able to view this run with no login. ` +
					`The run STAYS in the "${data.run.lab_name}" lab — only the audience changes. ` +
					`You can flip this back to "Private" or "All signed-in users" at any time.`
			);
			if (!ok) return;
		}
		sharingBusy = true;
		sharingError = '';
		const res = await fetch(`/api/runs/${data.run.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ visibility: next })
		});
		sharingBusy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Update failed' }));
			sharingError = body.error || 'Update failed';
			return;
		}
		visibility = next;
		await invalidateAll();
	}

	async function grantAccess(e: Event) {
		e.preventDefault();
		if (!pickedUserId) return;
		grantBusy = true;
		grantError = '';
		const res = await fetch(`/api/runs/${data.run.id}/access`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user_id: pickedUserId, role: 'viewer' })
		});
		grantBusy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Grant failed' }));
			grantError = body.error || 'Grant failed';
			return;
		}
		pickedUserId = '';
		await invalidateAll();
	}

	async function revokeAccess(userId: string, username: string) {
		if (!confirm(`Revoke ${username}'s access to this run?`)) return;
		const res = await fetch(`/api/runs/${data.run.id}/access/${userId}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
	}

	async function deleteRun() {
		if (!confirm(`Delete run "${data.run.name}"? This does not touch the underlying files.`)) return;
		const res = await fetch(`/api/runs/${data.run.id}`, { method: 'DELETE' });
		if (res.ok) await goto('/settings/runs');
	}
</script>

<svelte:head><title>{data.run.name} · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> ·
		<a href="/settings/runs" class="hover:text-slate-300">Runs</a> ·
		<span class="text-slate-400">{data.run.name}</span>
	</nav>

	<header class="flex items-baseline justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold">{data.run.name}</h1>
			<p class="text-xs text-slate-500 mt-0.5">{data.run.pipeline_name} · <span class="font-mono">{data.run.slug}</span></p>
		</div>
		<a href="/runs/{data.run.id}" class="text-sm text-ocean-400 hover:text-ocean-300">View as user →</a>
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-4">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Details</h2>
		<form onsubmit={saveRun} class="grid gap-3 sm:grid-cols-2">
			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">Slug</span>
				<input bind:value={slug} required pattern="[a-z0-9][a-z0-9-]*" maxlength="64"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500 font-mono text-sm" />
			</label>

			<label class="block sm:col-span-1">
				<span class="block text-xs text-slate-400 mb-1">Display name</span>
				<input bind:value={name} required maxlength="200"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500" />
			</label>

			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Data path</span>
				<input bind:value={dataPath} required pattern="/.*"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500 font-mono text-sm" />
			</label>

			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Description</span>
				<textarea bind:value={description} rows="3" maxlength="10000"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500"></textarea>
			</label>

			{#if saveError}
				<div class="sm:col-span-2 p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{saveError}</div>
			{/if}
			{#if saveOk}
				<div class="sm:col-span-2 p-2 rounded bg-emerald-900/30 border border-emerald-800 text-emerald-300 text-sm">Saved.</div>
			{/if}

			<div class="sm:col-span-2 flex items-center justify-between">
				<button type="submit" disabled={saveBusy}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{saveBusy ? 'Saving…' : 'Save changes'}
				</button>
				<button type="button" onclick={deleteRun}
					class="px-4 py-2 text-red-400 hover:text-red-300 text-sm">
					Delete run
				</button>
			</div>
		</form>
	</section>

	<!--
		One Sharing card. Three audience modes (Private / All signed-in users /
		Public web) and a per-user grant list. None of these MOVE the deployment
		— the run stays in {data.run.lab_name} regardless of audience.
	-->
	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-5">
		<header class="flex items-baseline justify-between gap-4">
			<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Sharing</h2>
			<span class="text-xs text-slate-500">Run stays in <span class="text-slate-400">{data.run.lab_name}</span></span>
		</header>

		<!-- Audience picker. Three mutually-exclusive modes. -->
		<div class="grid gap-2 sm:grid-cols-3">
			{#each [
				{ v: 'private', label: 'Private', sub: 'Lab members only' },
				{ v: 'shared', label: 'All signed-in users', sub: 'Any logged-in microscape user' },
				{ v: 'public', label: 'Public web', sub: 'Anyone, no login' }
			] as opt}
				{@const active = visibility === opt.v}
				<button
					type="button"
					onclick={() => setVisibility(opt.v as Visibility)}
					disabled={sharingBusy}
					class="text-left px-3 py-3 rounded border transition-colors disabled:opacity-50
						{active
							? opt.v === 'public'
								? 'border-amber-500 bg-amber-500/10 text-amber-200'
								: 'border-ocean-500 bg-ocean-500/10 text-ocean-200'
							: 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600'}"
				>
					<div class="flex items-center gap-2 font-medium text-sm">
						<span class="inline-block w-3 h-3 rounded-full border
							{active
								? opt.v === 'public' ? 'bg-amber-400 border-amber-400' : 'bg-ocean-400 border-ocean-400'
								: 'border-slate-500'}"></span>
						{opt.label}
					</div>
					<div class="text-xs text-slate-500 mt-1">{opt.sub}</div>
				</button>
			{/each}
		</div>
		{#if sharingError}
			<div class="p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{sharingError}</div>
		{/if}

		<!-- Per-user grants. Read-only access; lab admins keep edit rights via
		     lab membership. Same UI regardless of the audience mode above. -->
		<div class="space-y-3 pt-3 border-t border-slate-800">
			<div class="flex items-baseline justify-between gap-2">
				<h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Per-user grants</h3>
				<p class="text-xs text-slate-500">Read access for individual users in addition to the audience mode above.</p>
			</div>

			<form onsubmit={grantAccess} class="flex flex-wrap items-end gap-3">
				<label class="block flex-1 min-w-[14rem]">
					<span class="block text-xs text-slate-400 mb-1">User</span>
					<select bind:value={pickedUserId}
						class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500">
						<option value="">— pick a user —</option>
						{#each availableUsers as u}
							<option value={u.id}>{u.username}{u.display_name ? ` (${u.display_name})` : ''}</option>
						{/each}
					</select>
				</label>
				<button type="submit" disabled={grantBusy || !pickedUserId}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{grantBusy ? 'Granting…' : 'Grant read access'}
				</button>
			</form>
			{#if grantError}
				<div class="p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{grantError}</div>
			{/if}

			{#if data.grants.length === 0}
				<p class="text-sm text-slate-500 italic">No explicit grants.</p>
			{:else}
				<ul class="divide-y divide-slate-800 border-y border-slate-800">
					{#each data.grants as g}
						<li class="py-2 flex items-center justify-between gap-4 text-sm">
							<div>
								<span class="text-slate-200">{g.username}</span>
								{#if g.display_name}<span class="text-slate-500"> · {g.display_name}</span>{/if}
								{#if g.role !== 'viewer'}
									<span class="ml-2 px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]" title="Legacy role (new grants are always read-only)">{g.role}</span>
								{/if}
							</div>
							<div class="flex items-center gap-3">
								<time class="text-xs text-slate-500">{g.added_at.split(' ')[0]}</time>
								<button onclick={() => revokeAccess(g.user_id, g.username)} class="text-red-400 hover:text-red-300 text-xs">Revoke</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>
