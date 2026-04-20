<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let oldPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let saving = $state(false);
	let errorMsg = $state('');
	let savedMsg = $state('');

	const ROLE_LABELS: Record<string, string> = {
		admin: 'Administrator — full access, can manage users and settings',
		user: 'User — can read and edit all sample data',
		viewer: 'Viewer — read-only access to sample data'
	};

	// ----- Emoji avatar -----
	// Curated palette for one-click picking; the text input still accepts
	// anything the user types (ZWJ-joined emoji, skin tones, etc.).
	const EMOJI_SUGGESTIONS = [
		'🐙', '🐟', '🐚', '🦀', '🦞', '🦐', '🐠', '🐡', '🐳', '🐋', '🦑', '🐢',
		'🪸', '🌊', '🏝️', '⛵', '🚢', '🛶', '⚓', '🧭',
		'🧬', '🧪', '🔬', '🧫', '🦠', '🧑‍🔬', '👩‍🔬', '👨‍🔬',
		'🌱', '🌿', '🍃', '🌾', '🌳', '🌲', '🍄', '🧑‍🌾',
		'🐛', '🐜', '🐝', '🐞', '🦋', '🪲', '🪳', '🕷️',
		'🐦', '🦉', '🦜', '🐧', '🦩', '🦢', '🦆', '🐓', '🐤',
		'🗺️', '📍', '📡', '🛰️', '🌡️', '🧊', '☁️', '☀️', '🌧️', '❄️',
		'⭐', '✨', '🌟', '🎯', '🎨', '📚', '☕', '🍵'
	];

	let avatarEmoji = $state<string>(data.user?.avatar_emoji ?? '');
	let avatarSaving = $state(false);
	let avatarSavedMsg = $state('');
	let avatarErrorMsg = $state('');

	async function saveAvatar(emoji: string) {
		avatarSaving = true;
		avatarErrorMsg = '';
		avatarSavedMsg = '';
		const res = await fetch('/api/account/avatar', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emoji })
		});
		if (res.ok) {
			const body = await res.json();
			avatarEmoji = body.avatar_emoji ?? '';
			avatarSavedMsg = emoji ? 'Avatar saved.' : 'Avatar cleared.';
		} else {
			const err = await res.json().catch(() => null);
			avatarErrorMsg = err?.error || `Failed (${res.status})`;
		}
		avatarSaving = false;
	}
	function pickEmoji(emoji: string) {
		avatarEmoji = emoji;
		saveAvatar(emoji);
	}
	function clearEmoji() {
		avatarEmoji = '';
		saveAvatar('');
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		savedMsg = '';
		if (newPassword !== confirmPassword) {
			errorMsg = 'New passwords do not match';
			return;
		}
		if (newPassword.length < 10) {
			errorMsg = 'New password must be at least 10 characters';
			return;
		}
		saving = true;
		const res = await fetch('/api/account/password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
		});
		if (res.ok) {
			savedMsg = 'Password updated.';
			oldPassword = '';
			newPassword = '';
			confirmPassword = '';
		} else {
			const err = await res.json().catch(() => null);
			errorMsg = err?.error || `Failed (${res.status})`;
		}
		saving = false;
	}

	const inputCls =
		'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-ocean-500';

	// --- Danger zone: self-delete account ---
	let deleteOpen = $state(false);
	let deleteConfirm = $state('');
	let deleteBusy = $state(false);
	let deleteError = $state('');

	async function deleteAccount() {
		deleteBusy = true; deleteError = '';
		const res = await fetch('/api/account', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ confirm: deleteConfirm })
		});
		if (res.ok) {
			// Server already wiped the session cookie; navigate to login so
			// the user sees they're signed out (don't try to fetch again,
			// any further request would 401).
			window.location.href = '/auth/login';
			return;
		}
		deleteError = (await res.json().catch(() => ({}))).error || 'Delete failed';
		deleteBusy = false;
	}
</script>

<div class="max-w-xl space-y-8">
	<div>
		<h1 class="text-2xl font-bold text-white">Account</h1>
		<p class="text-slate-400 mt-1 text-sm">Your sign-in details and password.</p>
	</div>

	<!-- Identity card -->
	<div class="p-4 rounded-lg bg-slate-800/50 border border-slate-800 space-y-3">
		<div class="flex items-center gap-3">
			{#if avatarEmoji}
				<div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-2xl leading-none">
					{avatarEmoji}
				</div>
			{:else if data.user?.avatar_url}
				<img src={data.user.avatar_url} alt="" class="w-10 h-10 rounded-full" />
			{:else}
				<div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
					{data.user?.username?.charAt(0).toUpperCase()}
				</div>
			{/if}
			<div>
				<div class="text-white font-medium">{data.user?.username}</div>
				<div class="text-xs text-slate-500">
					{#if data.user?.is_local_account}local account{:else if data.user?.github_id}GitHub account{/if}
					{#if data.user?.email} · {data.user.email}{/if}
				</div>
			</div>
		</div>
		<div class="text-sm">
			<span class="px-2 py-0.5 rounded text-xs font-medium
				{data.user?.role === 'admin'
					? 'bg-ocean-900/40 text-ocean-300 border border-ocean-800'
					: data.user?.role === 'viewer'
						? 'bg-slate-800 text-slate-400 border border-slate-700'
						: 'bg-slate-700/50 text-slate-300 border border-slate-700'}">
				{data.user?.role}
			</span>
			<span class="text-slate-500 ml-2">{ROLE_LABELS[data.user?.role ?? 'user']}</span>
		</div>
	</div>

	<!-- Avatar emoji -->
	<div class="space-y-3">
		<div>
			<h2 class="text-base font-semibold text-white">Avatar emoji</h2>
			<p class="text-xs text-slate-500 mt-0.5">
				Shown in the navbar + personnel roster. Overrides a GitHub profile
				picture when set. Pick from the palette below, type your own, or
				clear to fall back to the role icon.
			</p>
		</div>

		{#if avatarErrorMsg}
			<div class="p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-xs">{avatarErrorMsg}</div>
		{/if}
		{#if avatarSavedMsg}
			<div class="p-2 rounded bg-green-900/30 border border-green-800 text-green-300 text-xs">{avatarSavedMsg}</div>
		{/if}

		<div class="flex items-center gap-3">
			<input
				type="text"
				bind:value={avatarEmoji}
				maxlength="8"
				placeholder="🐙"
				class="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-center text-2xl focus:outline-none focus:border-ocean-500"
			/>
			<button
				type="button"
				disabled={avatarSaving}
				onclick={() => saveAvatar(avatarEmoji.trim())}
				class="px-3 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 text-sm font-medium"
			>
				{avatarSaving ? 'Saving…' : 'Save'}
			</button>
			{#if data.user?.avatar_emoji || avatarEmoji}
				<button
					type="button"
					disabled={avatarSaving}
					onclick={clearEmoji}
					class="px-3 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm"
				>Clear</button>
			{/if}
		</div>

		<div class="flex flex-wrap gap-1.5">
			{#each EMOJI_SUGGESTIONS as e}
				<button
					type="button"
					onclick={() => pickEmoji(e)}
					disabled={avatarSaving}
					class="w-9 h-9 rounded-lg text-xl leading-none flex items-center justify-center transition-colors
						{avatarEmoji === e
							? 'bg-ocean-600 ring-2 ring-ocean-400'
							: 'bg-slate-800 hover:bg-slate-700'}"
					title={e}
				>{e}</button>
			{/each}
		</div>
	</div>

	<!-- Change password -->
	<div class="space-y-3">
		<h2 class="text-base font-semibold text-white">Change password</h2>

		{#if data.user?.is_local_account}
			<p class="text-xs text-slate-500">Set a new password for your local account.</p>

			{#if errorMsg}
				<div class="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
					{errorMsg}
				</div>
			{/if}
			{#if savedMsg}
				<div class="p-3 rounded-lg bg-green-900/30 border border-green-800 text-green-300 text-sm">
					{savedMsg}
				</div>
			{/if}

			<form onsubmit={submit} class="space-y-3">
				<input
					type="password"
					bind:value={oldPassword}
					required
					placeholder="Current password"
					class={inputCls}
				/>
				<input
					type="password"
					bind:value={newPassword}
					required
					minlength="10"
					placeholder="New password (min 10 characters)"
					class={inputCls}
				/>
				<input
					type="password"
					bind:value={confirmPassword}
					required
					minlength="10"
					placeholder="Confirm new password"
					class={inputCls}
				/>
				<button
					type="submit"
					disabled={saving}
					class="px-4 py-2 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 transition-colors text-sm font-medium"
				>
					{saving ? 'Updating...' : 'Update password'}
				</button>
			</form>
		{:else}
			<p class="text-sm text-slate-400">
				This account signs in via GitHub OAuth and doesn't have a local password.
				There's nothing to change here — manage your GitHub credentials at
				<a href="https://github.com/settings/security" target="_blank" class="text-ocean-400 hover:text-ocean-300">github.com/settings/security</a>.
			</p>
		{/if}
	</div>

	<!-- Danger zone -->
	<div class="p-4 rounded-lg border border-red-900/60 bg-red-950/20 space-y-3">
		<div>
			<h2 class="text-sm font-semibold text-red-300 uppercase tracking-wider">Danger zone</h2>
			<p class="text-xs text-slate-400 mt-1">
				Deleting your account signs you out and revokes access. Your past contributions
				(samples / extracts / notes you created) stay attributed to your username so the
				lab's audit trail isn't broken — but you can no longer sign in.
			</p>
		</div>
		{#if !deleteOpen}
			<button type="button" onclick={() => { deleteOpen = true; deleteError = ''; deleteConfirm = ''; }}
				class="px-3 py-1.5 border border-red-800 text-red-300 rounded-lg hover:bg-red-900/30 text-sm font-medium">
				Delete my account
			</button>
		{:else}
			<form onsubmit={(e) => { e.preventDefault(); deleteAccount(); }} class="space-y-2">
				<label for="del-confirm" class="block text-xs text-slate-300">
					Type <code class="text-red-300">{data.user?.username}</code> to confirm:
				</label>
				<input id="del-confirm" type="text" bind:value={deleteConfirm}
					autocomplete="off"
					class="{inputCls} border-red-900 focus:border-red-500" />
				{#if deleteError}
					<div class="text-xs text-red-400">{deleteError}</div>
				{/if}
				<div class="flex gap-2">
					<button type="submit" disabled={deleteBusy || deleteConfirm !== data.user?.username}
						class="px-3 py-1.5 bg-red-700 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-medium">
						{deleteBusy ? 'Deleting…' : 'Permanently delete'}
					</button>
					<button type="button" onclick={() => { deleteOpen = false; }}
						class="px-3 py-1.5 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800 text-sm font-medium">
						Cancel
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>
