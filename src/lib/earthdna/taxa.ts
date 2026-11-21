/**
 * Retired taxon names and the ones that replaced them, so a search for an old
 * name still leads somewhere. Copied from danaSeq illumina_amplicon viz
 * (viz/src/stores/data.svelte.js); keep the two in step.
 */
export const TAXON_SYNONYMS: Record<string, string[]> = {
	proteobacteria: ['Pseudomonadota'],
	firmicutes: ['Bacillota'],
	actinobacteria: ['Actinomycetota'],
	actinobacteriota: ['Actinomycetota'],
	bacteroidetes: ['Bacteroidota'],
	cyanobacteria: ['Cyanobacteriota'],
	chloroflexi: ['Chloroflexota'],
	verrucomicrobia: ['Verrucomicrobiota'],
	planctomycetes: ['Planctomycetota'],
	acidobacteria: ['Acidobacteriota'],
	spirochaetes: ['Spirochaetota'],
	fusobacteria: ['Fusobacteriota'],
	nitrospirae: ['Nitrospirota'],
	tenericutes: ['Mycoplasmatota'],
	chlamydiae: ['Chlamydiota'],
	synergistetes: ['Synergistota'],
	thermotogae: ['Thermotogota'],
	aquificae: ['Aquificota'],
	armatimonadetes: ['Armatimonadota'],
	gemmatimonadetes: ['Gemmatimonadota'],
	lentisphaerae: ['Lentisphaerota'],
	'deinococcus-thermus': ['Deinococcota'],
	epsilonbacteraeota: ['Campylobacterota'],
	desulfobacterota: ['Thermodesulfobacteriota'],
	crenarchaeota: ['Thermoproteota'],
	thaumarchaeota: ['Nitrososphaerota'],
	euryarchaeota: ['Methanobacteriota', 'Halobacteriota', 'Thermoplasmatota']
};

/**
 * The strings to look for, given what was typed: the query itself, plus the
 * current name of any retired taxon the query is starting to spell. Prefix
 * rather than substring, and only once enough has been typed to be aiming at
 * something.
 */
const MIN_SYNONYM_PREFIX = 3;

export function expandTaxonQuery(query: string): string[] {
	const lower = (query || '').toLowerCase().trim();
	if (!lower) return [];
	const out = [lower];
	if (lower.length < MIN_SYNONYM_PREFIX) return out;
	for (const [old, current] of Object.entries(TAXON_SYNONYMS)) {
		if (old.startsWith(lower)) {
			for (const name of current) {
				const n = name.toLowerCase();
				if (!out.includes(n)) out.push(n);
			}
		}
	}
	return out;
}

export interface Taxon {
	rank: number;
	code: number;
	name: string;
	contains?: string; // a "contains" search: every point carrying this taxon (rank and code are -1, or the taxon picked among those points)
	within?: string; // with a picked taxon inside a "contains" search: the taxon searched for
}

export interface RankedTaxon {
	name: string;
	code: number;
	count: number;
	asvs?: number;
	color: string;
}

export interface Taxa {
	levels: string[];
	names: string[][];
	find: (name: string) => Taxon[] | null | Promise<Taxon[] | null>;
	count: (name: string) => number; // references carrying the most-used taxon of that name
	describe: (name: string) => string; // 'genus · 8,123' for a suggestion list
	start?: number; // the level coloured when nothing is picked (default: class)
	title?: string;
	searchNames?: string[]; // what the search box suggests, when it can find more than the label names // the panel heading ('Taxa' by default; a label set's name)
	noun?: string; // what a name is, for the search box ('taxon' by default; 'category' for environment labels)
}

export const NONE = 65535;
