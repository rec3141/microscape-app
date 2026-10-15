import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireLabAdmin } from '$lib/server/guards';
import { assertLabOwnsRow } from '$lib/server/lab-scope';
import { parseBody } from '$lib/server/validation';
import { RunMetadataBody } from '$lib/server/schemas/runs';
import { getRunMetadata, readRunSampleIds } from '$lib/server/run-metadata';

/**
 * Admin-uploaded sample metadata for one run. The client parses the
 * spreadsheet ($lib/metadata.ts) and PUTs the resulting object; this
 * handler keeps only the rows whose FLOWCELL:barcodeNN key is a sample in
 * the run's own bundle, so a lab-wide master sheet can be uploaded as-is
 * and other runs' rows are never stored or served here.
 */

export const GET: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	assertLabOwnsRow(getDb(), 'runs', params.id!, labId);
	const row = getRunMetadata(params.id!);
	if (!row) return json(null);
	return json({
		filename: row.filename,
		sample_count: row.sample_count,
		uploaded_at: row.uploaded_at,
		metadata: JSON.parse(row.content)
	});
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { user, labId } = requireLabAdmin(locals);
	const parsed = parseBody(RunMetadataBody, await request.json().catch(() => null));
	if (!parsed.ok) return parsed.response;
	const { filename, metadata } = parsed.data;

	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);
	const run = db.prepare('SELECT data_path FROM runs WHERE id = ?').get(params.id) as {
		data_path: string;
	};

	const known = readRunSampleIds(run.data_path);
	if (!known) {
		return json(
			{ error: "This run's bundle has no data/samples.json, so rows can't be matched to its samples" },
			{ status: 409 }
		);
	}
	const kept: typeof metadata = {};
	for (const [key, row] of Object.entries(metadata)) {
		if (known.has(key)) kept[key] = row;
	}
	const keptCount = Object.keys(kept).length;
	const total = Object.keys(metadata).length;
	if (keptCount === 0) {
		return json({ error: `None of the ${total} rows match this run's samples` }, { status: 400 });
	}

	db.prepare(
		`INSERT INTO run_metadata (run_id, filename, content, sample_count, uploaded_by)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(run_id) DO UPDATE SET
		   filename = excluded.filename,
		   content = excluded.content,
		   sample_count = excluded.sample_count,
		   uploaded_by = excluded.uploaded_by,
		   uploaded_at = datetime('now')`
	).run(params.id, filename, JSON.stringify(kept), keptCount, user.id);

	return json({ kept: keptCount, total, discarded: total - keptCount, run_samples: known.size });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { labId } = requireLabAdmin(locals);
	const db = getDb();
	assertLabOwnsRow(db, 'runs', params.id!, labId);
	db.prepare('DELETE FROM run_metadata WHERE run_id = ?').run(params.id);
	return json({ ok: true });
};
