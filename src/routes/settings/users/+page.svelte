<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	interface Member {
		id: string;
		username: string;
		display_name: string | null;
		email: string | null;
		avatar_emoji: string | null;
		github_id: number | null;
		is_local_account: number;
		is_demo: number;
		is_approved: number;
		must_change_password: number;
		role: 'admin' | 'user' | 'viewer';
		membership_status: 'active' | 'blocked';
		added_at: string;
		has_password: number;
	}

	interface Props { data: { users: Member[]; me_id: string }; }
	let { data }: Props = $props();

	// ---- Create local user form ----
	let newUsername = $state('');
	let newDisplayName = $state('');
	let newEmail = $state('');
	let newRole = $state<'admin' | 'user' | 'viewer'>('user');
	let newPassword = $state('');
	let createBusy = $state(false);
	let createError = $state('');

	async function createUser(e: Event) {
		e.preventDefault();
		createBusy = true;
		createError = '';
		const res = await fetch('/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: newUsername.trim(),
				password: newPassword,
				role: newRole,
				display_name: newDisplayName.trim() || null,
				email: newEmail.trim() || null
			})
		});
		createBusy = false;
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Request failed' }));
			createError = body.error || body.issues?.[0]?.message || 'Request failed';
			return;
		}
		newUsername = '';
		newDisplayName = '';
		newEmail = '';
		newPassword = '';
		newRole = 'user';
		await invalidateAll();
	}

	// ---- Per-row actions ----
	async function setRole(u: Member, role: 'admin' | 'user' | 'viewer') {
		if (u.role === role) return;
		const res = await fetch(`/api/users/${u.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Update failed' }));
			alert(body.error || 'Update failed');
			return;
		}
		await invalidateAll();
	}

	async function removeMember(u: Member) {
		if (!confirm(`Remove ${u.username} from this lab? Their account stays; only the membership is deleted.`)) return;
		const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Remove failed' }));
			alert(body.error || 'Remove failed');
			return;
		}
		await invalidateAll();
	}

	async function resetPassword(u: Member) {
		const pw = prompt(`Set a new password for ${u.username} (min 10 chars).\nThey'll be forced to change it on next login.`);
		if (!pw) return;
		const res = await fetch(`/api/users/${u.id}/reset-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: pw })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: 'Reset failed' }));
			alert(body.error || body.issues?.[0]?.message || 'Reset failed');
			return;
		}
		alert(`Password reset. ${u.username} will need to change it on next login.`);
	}

	function badge(cls: string) { return `px-1.5 py-0.5 rounded ${cls} uppercase tracking-wide text-[10px]`; }
</script>

<svelte:head><title>Users · Admin · microscape.app</title></svelte:head>

<div class="space-y-6">
	<nav class="text-xs text-slate-500">
		<a href="/settings" class="hover:text-slate-300">Admin</a> · <span class="text-slate-400">Users</span>
	</nav>

	<header>
		<h1 class="text-2xl font-semibold">Users</h1>
		<p class="text-sm text-slate-400">Members of this lab. Removing a member only revokes their membership — their account remains so historical attributions stay intact.</p>
	</header>

	<section class="rounded border border-slate-800 bg-slate-900/40 p-4 space-y-4">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Create local account</h2>
		<p class="text-xs text-slate-500">
			Creates a password-based account and adds it to this lab. Use this when
			someone can't authenticate via GitHub. Otherwise prefer an <a href="/settings/invites" class="text-ocean-400 hover:text-ocean-300">invite link</a> — they sign in with GitHub on first click.
		</p>
		<form onsubmit={createUser} class="grid gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="block text-xs text-slate-400 mb-1">Username</span>
				<input bind:value={newUsername} required maxlength="64" pattern="^[a-zA-Z0-9_.-]+$"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500" />
			</label>
			<label class="block">
				<span class="block text-xs text-slate-400 mb-1">Role</span>
				<select bind:value={newRole}
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500">
					<option value="viewer">Viewer</option>
					<option value="user">User</option>
					<option value="admin">Admin</option>
				</select>
			</label>
			<label class="block">
				<span class="block text-xs text-slate-400 mb-1">Display name <span class="text-slate-600">(optional)</span></span>
				<input bind:value={newDisplayName} maxlength="200"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500" />
			</label>
			<label class="block">
				<span class="block text-xs text-slate-400 mb-1">Email <span class="text-slate-600">(optional)</span></span>
				<input bind:value={newEmail} type="email" maxlength="200"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500" />
			</label>
			<label class="block sm:col-span-2">
				<span class="block text-xs text-slate-400 mb-1">Temporary password <span class="text-slate-600">(min 10 chars; user will be forced to change on first login)</span></span>
				<input bind:value={newPassword} type="password" required minlength="10" maxlength="128"
					class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:border-ocean-500 font-mono" />
			</label>

			{#if createError}
				<div class="sm:col-span-2 p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-sm">{createError}</div>
			{/if}

			<div class="sm:col-span-2">
				<button type="submit" disabled={createBusy}
					class="px-4 py-2 bg-ocean-600 text-white rounded hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium">
					{createBusy ? 'Creating…' : 'Create user'}
				</button>
			</div>
		</form>
	</section>

	<section class="space-y-2">
		<h2 class="text-sm font-semibold text-slate-300 uppercase tracking-wide">Members ({data.users.length})</h2>
		<ul class="divide-y divide-slate-800 border-y border-slate-800">
			{#each data.users as u}
				<li class="py-3 flex items-baseline justify-between gap-4">
					<div class="min-w-0 flex items-start gap-3">
						<span class="text-xl leading-none">{u.avatar_emoji ?? (u.role === 'admin' ? '🔑' : u.role === 'viewer' ? '👁' : '🔬')}</span>
						<div class="min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-slate-200 font-medium">{u.username}</span>
								{#if u.display_name}<span class="text-slate-500">· {u.display_name}</span>{/if}
								{#if u.github_id}
									<span class={badge('bg-slate-800 text-slate-400')}>GitHub</span>
								{:else if u.is_local_account}
									<span class={badge('bg-slate-800 text-slate-400')}>Local</span>
								{/if}
								{#if u.must_change_password}
									<span class={badge('bg-amber-900/40 text-amber-300')}>pw change pending</span>
								{/if}
								{#if u.membership_status === 'blocked'}
									<span class={badge('bg-red-900/40 text-red-300')}>blocked</span>
								{/if}
							</div>
							{#if u.email}
								<div class="text-xs text-slate-500 mt-0.5">{u.email}</div>
							{/if}
							<div class="text-xs text-slate-600 mt-0.5">joined {u.added_at.split(' ')[0]}</div>
						</div>
					</div>
					<div class="flex items-center gap-3 text-sm whitespace-nowrap">
						<select
							value={u.role}
							onchange={(e) => setRole(u, (e.currentTarget as HTMLSelectElement).value as 'admin' | 'user' | 'viewer')}
							disabled={u.id === data.me_id}
							title={u.id === data.me_id ? "You can't demote yourself" : 'Change role'}
							class="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs focus:outline-none focus:border-ocean-500 disabled:opacity-60">
							<option value="viewer">Viewer</option>
							<option value="user">User</option>
							<option value="admin">Admin</option>
						</select>
						{#if u.is_local_account}
							<button onclick={() => resetPassword(u)} class="text-slate-400 hover:text-white text-xs">Reset pw</button>
						{/if}
						{#if u.id !== data.me_id}
							<button onclick={() => removeMember(u)} class="text-red-400 hover:text-red-300 text-xs">Remove</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
</div>
