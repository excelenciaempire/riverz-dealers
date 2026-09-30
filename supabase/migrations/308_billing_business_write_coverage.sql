BEGIN;
-- Keep newly introduced business tables under the same read-only boundary.
CREATE FUNCTION public.install_billing_business_guards()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t record; command text; predicate text; parent record; depth integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('riverz.billing.business.guards'));
  FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=c.oid AND polname='billing_readonly_insert')
  LOOP
    predicate := NULL;
    IF t.relname='workspaces' THEN
      predicate := 'public.workspace_billing_write_allowed(id)';
    ELSIF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='workspace_id' AND NOT attisdropped) THEN
      predicate := 'public.workspace_billing_write_allowed(workspace_id)';
    ELSE
      -- Child tables (messages, comment metadata, agent-channel scopes, etc.)
      -- inherit the guard from their tenant parent, without blocking SELECT.
      FOR parent IN
        SELECT child.attname child_column, pc.relname parent_table, pa.attname parent_column,
          CASE WHEN pc.relname='workspaces' THEN 'id' ELSE 'workspace_id' END workspace_column
        FROM pg_constraint fk
        JOIN pg_attribute child ON child.attrelid=fk.conrelid AND child.attnum=fk.conkey[1]
        JOIN pg_class pc ON pc.oid=fk.confrelid
        JOIN pg_namespace pn ON pn.oid=pc.relnamespace
        JOIN pg_attribute pa ON pa.attrelid=pc.oid AND pa.attnum=fk.confkey[1]
        WHERE fk.contype='f' AND fk.conrelid=t.oid AND array_length(fk.conkey,1)=1 AND pn.nspname='public'
          AND (pc.relname='workspaces' OR EXISTS (SELECT 1 FROM pg_attribute wa
            WHERE wa.attrelid=pc.oid AND wa.attname='workspace_id' AND NOT wa.attisdropped))
      LOOP
        predicate := concat_ws(' AND ',predicate,format(
          'NOT EXISTS (SELECT 1 FROM public.%I billing_parent WHERE billing_parent.%I = %I.%I AND NOT public.workspace_billing_write_allowed(billing_parent.%I))',
          parent.parent_table,parent.parent_column,t.relname,parent.child_column,parent.workspace_column));
      END LOOP;
      IF predicate IS NULL AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='user_id' AND NOT attisdropped)
        AND t.relname NOT IN ('profiles','legal_consents') THEN
        predicate := format('NOT EXISTS (SELECT 1 FROM public.workspaces billing_owner WHERE billing_owner.owner_id = %I.user_id AND NOT public.workspace_billing_write_allowed(billing_owner.id))',t.relname);
      END IF;
    END IF;
    IF predicate IS NOT NULL THEN
      FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','billing_readonly_'||lower(command),t.relname);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
          'billing_readonly_'||lower(command),t.relname,command,
          CASE command WHEN 'INSERT' THEN 'WITH CHECK ('||predicate||')'
            WHEN 'UPDATE' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')'
            ELSE 'USING ('||predicate||')' END);
      END LOOP;
    END IF;
  END LOOP;

  FOR depth IN 1..6 LOOP
    FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=c.oid AND polname='billing_readonly_insert')
    LOOP
      predicate := NULL;
      FOR parent IN SELECT child.attname child_column,pc.relname parent_table,pa.attname parent_column,
          pg_get_expr(pol.polwithcheck,pol.polrelid) parent_guard
        FROM pg_constraint fk
        JOIN pg_attribute child ON child.attrelid=fk.conrelid AND child.attnum=fk.conkey[1]
        JOIN pg_class pc ON pc.oid=fk.confrelid
        JOIN pg_attribute pa ON pa.attrelid=pc.oid AND pa.attnum=fk.confkey[1]
        JOIN pg_policy pol ON pol.polrelid=pc.oid AND pol.polname='billing_readonly_insert'
        WHERE fk.contype='f' AND fk.conrelid=t.oid AND fk.confrelid<>t.oid AND array_length(fk.conkey,1)=1
      LOOP
        predicate := concat_ws(' AND ',predicate,format(
          'NOT EXISTS (SELECT 1 FROM public.%I WHERE %I.%I = %I.%I AND NOT (%s))',
          parent.parent_table,parent.parent_table,parent.parent_column,t.relname,parent.child_column,parent.parent_guard));
      END LOOP;
      IF predicate IS NOT NULL THEN
        FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
          EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
            'billing_readonly_'||lower(command),t.relname,command,
            CASE command WHEN 'INSERT' THEN 'WITH CHECK ('||predicate||')'
              WHEN 'UPDATE' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')'
              ELSE 'USING ('||predicate||')' END);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_trigger tr WHERE tr.tgrelid=c.oid AND tr.tgname='billing_enforce_write') AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=c.oid AND polname='billing_readonly_insert')
  LOOP
    EXECUTE format('CREATE TRIGGER billing_enforce_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.billing_enforce_business_write()',t.relname);
  END LOOP;

END $$;
REVOKE ALL ON FUNCTION public.install_billing_business_guards() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.install_billing_business_guards() TO service_role;
SELECT public.install_billing_business_guards();
CREATE FUNCTION public.billing_business_guards_covered()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
SELECT NOT EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
 AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='workspace_id' AND NOT a.attisdropped)
 AND (NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='billing_readonly_insert')
 OR NOT EXISTS (SELECT 1 FROM pg_trigger tr WHERE tr.tgrelid=c.oid AND tr.tgname='billing_enforce_write'))
);
$$;
REVOKE ALL ON FUNCTION public.billing_business_guards_covered() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_business_guards_covered() TO service_role;
CREATE FUNCTION public.billing_authenticated_upload_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS (SELECT 1 FROM public.workspaces w
  WHERE (w.owner_id=auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w.id AND m.user_id=auth.uid()))
   AND NOT public.workspace_billing_write_allowed(w.id));
$$;
REVOKE ALL ON FUNCTION public.billing_authenticated_upload_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_authenticated_upload_allowed() TO authenticated,service_role;
DO $$ DECLARE command text; BEGIN
 FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects','billing_readonly_'||lower(command));
  EXECUTE format('CREATE POLICY %I ON storage.objects AS RESTRICTIVE FOR %s TO authenticated %s',
   'billing_readonly_'||lower(command),command,
   CASE command WHEN 'INSERT' THEN 'WITH CHECK (public.billing_authenticated_upload_allowed())'
    WHEN 'UPDATE' THEN 'USING (public.billing_authenticated_upload_allowed()) WITH CHECK (public.billing_authenticated_upload_allowed())'
    ELSE 'USING (public.billing_authenticated_upload_allowed())' END);
 END LOOP;
END $$;
COMMIT;
