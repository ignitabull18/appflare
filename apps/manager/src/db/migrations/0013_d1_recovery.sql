ALTER TABLE resources ADD COLUMN confirmed_deletion_at integer;
--> statement-breakpoint
ALTER TABLE snapshots ADD COLUMN container_state_json text;
