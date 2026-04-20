<script lang="ts">
	export type Crumb = { label: string; href?: string };
	let { items }: { items: Crumb[] } = $props();
</script>

{#if items.length > 0}
	<nav aria-label="Breadcrumb" class="text-sm text-slate-400 flex items-center flex-wrap gap-x-1.5 gap-y-0.5 leading-tight mt-1">
		{#each items as item, i}
			{#if i > 0}<span class="text-slate-600" aria-hidden="true">→</span>{/if}
			{#if item.href && i < items.length - 1}
				<a href={item.href} class="text-ocean-400 hover:text-ocean-300 transition-colors">{item.label}</a>
			{:else}
				<span class:text-slate-300={i === items.length - 1}>{item.label}</span>
			{/if}
		{/each}
	</nav>
{/if}
