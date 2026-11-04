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
		release: string;
		runs: GlobeRun[];
		onTaxa?: (taxa: Taxa) => void;
		onPick?: (lineage: Taxon[]) => void;
		onClear?: () => void;
		onAsvs?: () => void;
	}
): Globe;
