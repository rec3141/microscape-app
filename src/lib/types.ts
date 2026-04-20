// Core entity types for microscape-app: a gatekeeper that issues permissioned
// access to pipeline-run outputs produced by microscape-nf and danaseq.

/** Lab (tenant). Every run is scoped to a lab; users access data through lab
 *  membership plus optional per-run access grants. */
export interface Lab {
	id: string;
	name: string;
	slug: string;
	github_repo: string | null;
	github_token: string | null;
	backup_interval_hours: number | null;
	last_backup_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface User {
	id: string;
	/** The lab currently being viewed. Mapped from `users.active_lab_id` in the
	 *  session loader. Null for brand-new signups with no memberships. */
	lab_id: string | null;
	github_id: number | null;
	username: string;
	display_name: string | null;
	email: string | null;
	avatar_url: string | null;
	avatar_emoji: string | null;
	role: 'admin' | 'user' | 'viewer';
	is_local_account: number;
	is_demo: number;
	is_approved: number;
	must_change_password: number;
	created_at: string;
	updated_at: string;
}

/** A pipeline that produces gated artifacts. Global (not lab-scoped) — the
 *  same pipeline produces runs across many labs. */
export interface Pipeline {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
}

/** One execution of a pipeline for one lab, exposing a single output
 *  directory that is the unit of access control. */
export interface Run {
	id: string;
	lab_id: string;
	pipeline_id: string;
	slug: string;
	name: string;
	description: string | null;
	/** Absolute path to the run's output directory on the host filesystem.
	 *  The gated file endpoint maps requests to subpaths under this root. */
	data_path: string;
	/** When 1, the run is readable by any authenticated user (no ACL check).
	 *  Lab-private is the default (is_public=0). */
	is_public: number;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

/** Per-user grant of access to one run. Rows here are *in addition to* the
 *  implicit lab-membership grant; cross-lab collaborators get access via
 *  explicit run_access rows. */
export interface RunAccess {
	run_id: string;
	user_id: string;
	role: 'viewer' | 'user' | 'admin';
	added_at: string;
	added_by: string | null;
}
