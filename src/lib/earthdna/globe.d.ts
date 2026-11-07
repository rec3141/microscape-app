import type { RankedTaxon, Taxa, Taxon } from './taxa';

export interface GlobeRun {
	id: string;
	slug: string;
	name: string;
	lab_name: string;
}

export interface Globe {
	destroy: () => void;
	view: (level: number, filter: Taxon | null) => RankedTaxon[];
}

export function mountGlobe(
	root: HTMLElement,
	opts: {
		base: string;
		/** data build id, added to data URLs as ?v= */
		version?: string;
		/** null for a globe no amplicon runs are placed against */
		release: string | null;
		runs: GlobeRun[];
		/** what a point is, for the page's text (default 'sequences' / 'sequence') */
		unit?: string;
		unitOne?: string;
		onTaxa?: (taxa: Taxa) => void;
		onPick?: (lineage: Taxon[]) => void;
		onClear?: () => void;
		onAsvs?: () => void;
	}
): Globe;
