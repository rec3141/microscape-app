<script lang="ts">
	import type { User } from '$lib/types';

	let labSwitcherOpen = $state(false);
	let mobileOpen = $state(false);

	interface Props {
		user: User | null;
		lab: { id: string; name: string; slug: string } | null;
		labs: { id: string; name: string; slug: string; role: string }[];
	}

	let { user, lab, labs }: Props = $props();
	const showLabSwitcher = $derived(labs.length > 0);

	async function switchLab(labId: string) {
		labSwitcherOpen = false;
		const res = await fetch('/api/account/active-lab', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ lab_id: labId })
		});
		if (res.ok) window.location.href = '/';
	}

	const ROLE_ICON: Record<string, string> = { admin: '🔑', user: '🔬', viewer: '👁' };
	const ROLE_LABEL: Record<string, string> = {
		admin: 'Administrator',
		user: 'User',
		viewer: 'Viewer (read-only)'
	};

	const navLinks: { href: string; label: string; adminOnly?: boolean }[] = [
		{ href: '/runs', label: 'Runs' },
		{ href: '/settings', label: 'Admin', adminOnly: true }
	];
</script>

<nav class="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
	<div class="px-4">
		<div class="flex items-center justify-between h-14">
			<div class="flex items-center gap-2">
				<a href="/" class="flex items-center gap-2 text-ocean-400 font-bold text-lg tracking-tight">
					<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
						<circle cx="12" cy="12" r="3" />
						<circle cx="12" cy="12" r="8" />
						<path d="M12 4v2 M12 18v2 M4 12h2 M18 12h2" />
					</svg>
					microscape.app
				</a>
				{#if lab}
					<span class="text-slate-600 hidden sm:inline">/</span>
					{#if showLabSwitcher}
						<div class="relative hidden sm:block">
							<button
								onclick={() => (labSwitcherOpen = !labSwitcherOpen)}
								class="text-sm text-slate-300 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 transition-colors"
							>
								{lab.name}
								<svg class="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path d="M6 9l6 6 6-6" />
								</svg>
							</button>
							{#if labSwitcherOpen}
								<button class="fixed inset-0 z-40" onclick={() => (labSwitcherOpen = false)} aria-label="Close"></button>
								<div class="absolute left-0 top-full mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 py-1">
									{#each labs as l}
										<button
											onclick={() => switchLab(l.id)}
											class="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 transition-colors flex items-center justify-between
												{l.id === lab.id ? 'text-ocean-400' : 'text-slate-300'}"
										>
											<span>{l.name}</span>
											<span class="text-xs text-slate-500">{l.role}</span>
										</button>
									{/each}
									{#if !user?.is_demo}
										<div class="border-t border-slate-700 mt-1 pt-1">
											<a
												href="/auth/setup-lab"
												onclick={() => (labSwitcherOpen = false)}
												class="block w-full text-left px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
											>
												<span class="inline-flex items-center gap-1.5">
													<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
													New lab
												</span>
											</a>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			{#if user}
				<div class="hidden md:flex items-center gap-1">
					{#each navLinks.filter((l) => !l.adminOnly || user?.role === 'admin') as link}
						<a
							href={link.href}
							class="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
						>
							{link.label}
						</a>
					{/each}
				</div>
			{/if}

			<div class="flex items-center gap-3">
				{#if user}
					<a
						href="/account"
						class="text-sm text-slate-400 hover:text-white hidden sm:inline"
						title="Manage account"
					>{user.username}</a>
					<a
						href="/account"
						class="text-base hover:opacity-80 transition-opacity"
						title="{ROLE_LABEL[user.role] ?? user.role} — manage account"
					>{user.avatar_emoji ?? ROLE_ICON[user.role] ?? '👤'}</a>
					<form method="POST" action="/auth/logout" class="inline">
						<button type="submit" class="text-sm text-slate-400 hover:text-white">Sign out</button>
					</form>

					<button
						class="md:hidden p-1.5 text-slate-400 hover:text-white"
						onclick={() => (mobileOpen = !mobileOpen)}
						aria-label="Toggle menu"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							{#if mobileOpen}
								<path d="M6 18L18 6M6 6l12 12" />
							{:else}
								<path d="M4 6h16M4 12h16M4 18h16" />
							{/if}
						</svg>
					</button>
				{:else}
					<a href="/auth/login" class="text-sm text-ocean-400 hover:text-ocean-300">Sign in</a>
				{/if}
			</div>
		</div>

		{#if mobileOpen && user}
			<div class="md:hidden pb-3 border-t border-slate-800 mt-1 pt-2">
				{#each navLinks.filter((l) => !l.adminOnly || user?.role === 'admin') as link}
					<a
						href={link.href}
						class="block px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded"
						onclick={() => (mobileOpen = false)}
					>
						{link.label}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</nav>
