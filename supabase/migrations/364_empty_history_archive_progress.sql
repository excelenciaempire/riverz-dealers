-- Preserve completed contact progress after an empty archive discards its payload.
-- Do not replay 363 or retain private content solely for progress reporting.
DO $$
DECLARE definition text; corrected text;
BEGIN
 definition=pg_catalog.pg_get_functiondef('public.read_native_history_archive(uuid,uuid,uuid)'::regprocedure);
 corrected=replace(definition,
  '''contacts_collected'',COALESCE((p->>''targetIndex'')::integer,0)',
  '''contacts_collected'',CASE WHEN job.state=''empty'' THEN jsonb_array_length(job.targets) ELSE COALESCE((p->>''targetIndex'')::integer,0) END');
 IF corrected=definition THEN RAISE EXCEPTION 'empty_history_progress_definition_changed'; END IF;
 EXECUTE corrected;
END $$;
