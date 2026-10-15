/**
 * Sample-metadata parsing for the run admin page.
 *
 * A port of the nanopore_live viz's in-browser metadata import
 * (danaseq nanopore_live/viz/src/stores/data.js) so a file uploaded here
 * produces exactly the `data/metadata.json` shape the viz would build from
 * the same file: `{ "FLOWCELL:barcodeNN": { column: value, ... } }`.
 * Keep the two in sync when either side's rules change.
 */

export type SampleMetadata = Record<string, Record<string, string | number>>;

export type ParseResult = { ok: true; metadata: SampleMetadata; total: number } | { ok: false; error: string };

/** Normalize a barcode value to "barcodeNN" format.
 *  Accepts: "1", "01", "barcode1", "barcode01" → "barcode01". */
function normalizeBarcode(raw: string | undefined): string {
	if (!raw) return '';
	const s = String(raw).trim().toLowerCase();
	const m = s.match(/^(?:barcode)?(\d+)$/);
	if (!m) return '';
	return 'barcode' + m[1].padStart(2, '0');
}

/** Normalize a column header to its canonical name (case-insensitive aliases). */
function normalizeColumn(name: string): string {
	const lower = name.trim().toLowerCase();
	const aliases: Record<string, string> = {
		latitude: 'lat', longitude: 'lon', long: 'lon', lng: 'lon',
		samp_name: 'sample_id', flowcell_barcode: 'sample_id', id: 'sample_id'
	};
	return aliases[lower] || lower;
}

/** Split FLOWCELL:barcodeNN / FLOWCELL_barcodeNN / FLOWCELL-barcodeNN.
 *  Last separator wins so flowcells containing underscores still parse. */
function splitCombinedId(raw: string | undefined): [string, string] {
	if (!raw) return ['', ''];
	const s = String(raw).trim();
	if (!s) return ['', ''];
	let lastIdx = -1;
	for (let i = s.length - 1; i >= 0; i--) {
		const c = s[i];
		if (c === ':' || c === '_' || c === '-') { lastIdx = i; break; }
	}
	if (lastIdx < 0) return [s, ''];
	return [s.slice(0, lastIdx), s.slice(lastIdx + 1)];
}

type DateMode = 'iso' | 'yyyymmdd' | 'slashed-iso' | 'mdy' | 'dmy';

/** Try to parse a single value as a date and return ISO YYYY-MM-DD, or null. */
function tryParseDate(raw: string, mode: DateMode): string | null {
	const s = String(raw).trim();
	if (!s) return null;
	let m: RegExpMatchArray | null;
	if (mode === 'yyyymmdd') {
		m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
		if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	} else if (mode === 'iso') {
		m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
		if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	} else if (mode === 'slashed-iso') {
		m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
		if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	} else if (mode === 'mdy') {
		m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (m) {
			const mo = m[1].padStart(2, '0'), d = m[2].padStart(2, '0');
			if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${m[3]}-${mo}-${d}`;
		}
	} else if (mode === 'dmy') {
		m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (m) {
			const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
			if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${m[3]}-${mo}-${d}`;
		}
	}
	return null;
}

/** If ≥80% of a column's non-empty values share one date format, return a
 *  raw → ISO formatter for the column. Conservative: null on mixed/ambiguous. */
function detectDateFormat(values: string[]): ((v: string) => string) | null {
	const nonEmpty = values.filter((v) => v != null && String(v).trim() !== '');
	if (nonEmpty.length === 0) return null;
	const modes: DateMode[] = ['iso', 'yyyymmdd', 'slashed-iso', 'mdy', 'dmy'];
	const stats = {} as Record<DateMode, number>;
	for (const mode of modes) {
		let hits = 0;
		for (const v of nonEmpty) if (tryParseDate(v, mode)) hits++;
		stats[mode] = hits;
	}
	// MDY vs DMY: prefer DMY only when some value is impossible as MDY.
	const slashCount = nonEmpty.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(v).trim())).length;
	if (slashCount > 0) {
		let needsDmy = false;
		for (const v of nonEmpty) {
			const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
			if (m && +m[1] > 12 && +m[2] <= 12) { needsDmy = true; break; }
		}
		const slashMode: DateMode = needsDmy ? 'dmy' : 'mdy';
		if (stats[slashMode] / nonEmpty.length >= 0.8) {
			return (v) => tryParseDate(v, slashMode) ?? v;
		}
	}
	for (const mode of ['iso', 'yyyymmdd', 'slashed-iso'] as DateMode[]) {
		if (stats[mode] / nonEmpty.length >= 0.8) {
			return (v) => tryParseDate(v, mode) ?? v;
		}
	}
	return null;
}

/** Parse delimited text into rows. Honors quoted fields, "" escapes, CRLF/LF.
 *  Empty lines are skipped. */
function parseDelimited(text: string, delim: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let fieldStarted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; continue; }
				inQuotes = false;
				continue;
			}
			field += c;
			continue;
		}
		if (c === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; continue; }
		if (c === delim) { row.push(field); field = ''; fieldStarted = false; continue; }
		if (c === '\r') continue;
		if (c === '\n') {
			row.push(field);
			if (row.some((v) => v !== '')) rows.push(row);
			row = []; field = ''; fieldStarted = false;
			continue;
		}
		field += c;
		fieldStarted = true;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		if (row.some((v) => v !== '')) rows.push(row);
	}
	return rows;
}

/** Tab vs comma, sniffed from the first line. */
function detectDelimiter(text: string): string {
	let tabs = 0, commas = 0, inQuotes = false;
	const lookahead = Math.min(text.length, 4096);
	for (let i = 0; i < lookahead; i++) {
		const c = text[i];
		if (c === '"') inQuotes = !inQuotes;
		else if (!inQuotes) {
			if (c === '\n') { if (tabs > 0 || commas > 0) break; }
			else if (c === '\t') tabs++;
			else if (c === ',') commas++;
		}
	}
	return tabs > 0 ? '\t' : ',';
}

/** Turn [header, ...dataRows] into the canonical metadata object. Accepts
 *  flowcell + barcode columns, or one combined sample_id / samp_name /
 *  flowcell_barcode / id column. */
function processRows(rows: string[][]): ParseResult {
	if (!rows || rows.length < 2) return { ok: false, error: 'File has no data rows' };

	const header = rows[0].map(normalizeColumn);
	const hasFlowcell = header.includes('flowcell');
	const hasBarcode = header.includes('barcode');
	const useCombined = !(hasFlowcell && hasBarcode) && header.includes('sample_id');
	if (!useCombined && !(hasFlowcell && hasBarcode)) {
		return {
			ok: false,
			error: 'Requires either flowcell + barcode columns, or a combined sample_id/samp_name/flowcell_barcode/id column'
		};
	}

	// First pass keeps raw strings so date formats can be sniffed column-wide.
	const rawRows: { key: string; data: Record<string, string> }[] = [];
	for (let i = 1; i < rows.length; i++) {
		const fields = rows[i];
		const row: Record<string, string> = {};
		header.forEach((h, j) => { row[h] = fields[j] != null ? String(fields[j]) : ''; });

		let flowcell: string, barcode: string;
		if (useCombined) {
			const [fc, bc] = splitCombinedId(row.sample_id);
			flowcell = fc.trim();
			barcode = normalizeBarcode(bc);
		} else {
			flowcell = (row.flowcell || '').trim();
			barcode = normalizeBarcode(row.barcode);
		}
		if (!flowcell || !barcode) continue;
		const key = `${flowcell}:${barcode}`;

		const data: Record<string, string> = {};
		for (const [k, v] of Object.entries(row)) {
			if (k === 'flowcell' || k === 'barcode' || k === 'sample_id') continue;
			// MIxS lat_lon ("lat lon" or "lat,lon") → lat / lon.
			if (k === 'lat_lon') {
				const parts = String(v).trim().split(/[\s,]+/).filter(Boolean);
				if (parts.length >= 2) {
					data.lat = parts[0];
					data.lon = parts[1];
				}
				continue;
			}
			data[k] = v;
		}
		rawRows.push({ key, data });
	}
	if (rawRows.length === 0) return { ok: false, error: 'No rows parsed' };

	const allCols = new Set<string>();
	for (const r of rawRows) for (const k of Object.keys(r.data)) allCols.add(k);
	const dateFormatters: Record<string, (v: string) => string> = {};
	for (const col of allCols) {
		const fmt = detectDateFormat(rawRows.map((r) => r.data[col]).filter((v) => v !== undefined));
		if (fmt) dateFormatters[col] = fmt;
	}

	// Numbers stay numbers; date columns become ISO strings; blanks drop.
	const metadata: SampleMetadata = {};
	for (const { key, data } of rawRows) {
		const parsed: Record<string, string | number> = {};
		for (const [k, v] of Object.entries(data)) {
			if (v === '' || v == null) continue;
			if (dateFormatters[k]) { parsed[k] = dateFormatters[k](v); continue; }
			const num = Number(v);
			parsed[k] = isNaN(num) ? v : num;
		}
		metadata[key] = parsed;
	}
	const total = Object.keys(metadata).length;
	if (total === 0) return { ok: false, error: 'No rows parsed' };
	return { ok: true, metadata, total };
}

async function xlsxRows(buf: ArrayBuffer): Promise<string[][] | string> {
	let XLSX: typeof import('xlsx');
	try {
		XLSX = await import('xlsx');
	} catch {
		return 'XLSX support failed to load';
	}
	let wb: import('xlsx').WorkBook;
	try {
		wb = XLSX.read(buf, { type: 'array', cellDates: true });
	} catch {
		return 'Could not read XLSX file (corrupt or unsupported)';
	}
	const sheetName = wb.SheetNames[0];
	if (!sheetName) return 'Workbook contains no sheets';
	const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
		header: 1, defval: '', raw: true, blankrows: false
	});
	// Date cells → YYYY-MM-DD, everything else via String().
	return raw.map((r) => r.map((v) => {
		if (v == null) return '';
		if (v instanceof Date) {
			const m = String(v.getUTCMonth() + 1).padStart(2, '0');
			const d = String(v.getUTCDate()).padStart(2, '0');
			return `${v.getUTCFullYear()}-${m}-${d}`;
		}
		return String(v);
	}));
}

/** Parse an uploaded .tsv / .csv / .txt / .xlsx file. */
export async function parseMetadataFile(file: File): Promise<ParseResult> {
	const name = file.name.toLowerCase();
	const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
	if (ext === 'xlsx') {
		const rows = await xlsxRows(await file.arrayBuffer());
		return typeof rows === 'string' ? { ok: false, error: rows } : processRows(rows);
	}
	if (ext === 'tsv' || ext === 'csv' || ext === 'txt') {
		const text = await file.text();
		return processRows(parseDelimited(text, detectDelimiter(text)));
	}
	return {
		ok: false,
		error: `Unsupported file type${ext ? ` (.${ext})` : ''} — use .tsv, .csv, .txt, or .xlsx`
	};
}

/** Render metadata back to TSV (sample_id first, then the union of columns). */
export function metadataToTsv(metadata: SampleMetadata): string {
	const cols: string[] = [];
	const seen = new Set<string>();
	for (const row of Object.values(metadata)) {
		for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
	}
	const clean = (v: unknown) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
	const lines = [['sample_id', ...cols].join('\t')];
	for (const [key, row] of Object.entries(metadata)) {
		lines.push([key, ...cols.map((c) => clean(row[c]))].join('\t'));
	}
	return lines.join('\n') + '\n';
}
