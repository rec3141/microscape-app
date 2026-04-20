<script lang="ts">
	import { page } from '$app/stores';

	let open = $state(false);
	let message = $state('');
	let sending = $state(false);
	let sent = $state(false);

	async function submit() {
		if (!message.trim()) return;
		sending = true;
		const res = await fetch('/api/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ page_url: $page.url.pathname, message: message.trim() })
		});
		if (res.ok) {
			sent = true;
			message = '';
			setTimeout(() => { sent = false; open = false; }, 2000);
		}
		sending = false;
	}
</script>

<div class="border-t border-slate-800 mt-8">
	{#if !open}
		<button onclick={() => open = true} class="w-full py-3 text-xs text-slate-600 hover:text-slate-400 transition-colors">
			Report an issue or suggestion
		</button>
	{:else}
		<div class="max-w-xl mx-auto py-4 px-4 space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-xs text-slate-400">Feedback <span class="text-slate-600">({$page.url.pathname})</span></span>
				<button onclick={() => open = false} class="text-xs text-slate-600 hover:text-slate-400">Close</button>
			</div>
			{#if sent}
				<p class="text-sm text-green-400">Thanks! Your feedback has been recorded.</p>
			{:else}
				<form onsubmit={(e) => { e.preventDefault(); submit(); }} class="flex gap-2">
					<input
						type="text"
						bind:value={message}
						placeholder="What's wrong or what could be better?"
						class="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-ocean-500"
					/>
					<button type="submit" disabled={sending || !message.trim()}
						class="px-3 py-1.5 bg-ocean-600 text-white rounded-lg hover:bg-ocean-500 disabled:opacity-50 text-sm font-medium">
						{sending ? '...' : 'Send'}
					</button>
				</form>
			{/if}
		</div>
	{/if}
</div>
