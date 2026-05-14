<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Universal error → bounce to the landing page. Covers SvelteKit's
	// generated 404 (unknown route) plus any error thrown from a +page or
	// +layout load. Server-only +server.ts errors (e.g. the slug catch-all
	// or /api/*) bypass this component and return their raw status — they
	// must redirect at the handler.
	onMount(() => { goto('/', { replaceState: true }); });
</script>

<svelte:head><meta http-equiv="refresh" content="0; url=/" /></svelte:head>

<div class="text-center py-20 text-slate-400 text-sm">
	<p>{page.status} {page.error?.message ?? ''}</p>
	<p class="mt-2">Returning to <a href="/" class="text-ocean-400 hover:text-ocean-300">microscape.app</a>…</p>
</div>
