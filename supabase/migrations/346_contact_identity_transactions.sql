-- Contact links remain channel-specific. No rows, orders or conversations are merged.
CREATE TABLE public.contact_identity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL, actor_id uuid, source text NOT NULL CHECK(source IN ('human','system')),
 previous_primary_id uuid, primary_id uuid, previous_blocked boolean NOT NULL, blocked boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX contact_identity_events_case ON public.contact_identity_events(workspace_id,contact_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX contacts_identity_workspace_id ON public.contacts(workspace_id,id);
-- Enforce new writes without rewriting or silently repairing historical links.
ALTER TABLE public.contacts ADD CONSTRAINT contacts_identity_same_workspace FOREIGN KEY(workspace_id,unified_contact_id)
 REFERENCES public.contacts(workspace_id,id) NOT VALID;
ALTER TABLE public.contact_identity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_identity_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.contact_identity_events TO service_role;

-- NULL origins retain the explicit legacy policy of migration 206. New asserted data cannot link.
CREATE FUNCTION public.contact_link_phone(p_value text,p_origin text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN (p_origin IS NULL OR p_origin IN ('canal','pedido','tienda','pago','manual'))
 AND length(d) BETWEEN 8 AND 15 AND d !~ '^([0-9])\1+$'
 AND position(d IN '01234567890123456789')=0 AND position(d IN '09876543210987654321')=0 THEN '+'||d END
 FROM (SELECT regexp_replace(COALESCE(p_value,''),'[^0-9]','','g') AS d) normalized;
$$;
CREATE FUNCTION public.contact_link_email(p_value text,p_origin text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN (p_origin IS NULL OR p_origin IN ('canal','pedido','tienda','pago','manual'))
 AND e ~ '^[^@[:space:]%_]+@[^@[:space:]%_]+\.[^@[:space:]%_]+$'
 AND e !~ '^(no-?reply|info|ventas|sales|contacto|contact|hola|hello|admin|soporte|support|ayuda|help|team|equipo|billing|facturacion|pedidos|orders|marketing|newsletter|postmaster|mailer-daemon|webmaster)@'
 THEN e END FROM (SELECT lower(btrim(COALESCE(p_value,''))) AS e) normalized;
$$;
REVOKE ALL ON FUNCTION public.contact_link_phone(text,text),public.contact_link_email(text,text) FROM PUBLIC,anon,authenticated;
-- Pure input normalization also runs while maintaining indexes on ordinary authenticated writes.
GRANT EXECUTE ON FUNCTION public.contact_link_phone(text,text),public.contact_link_email(text,text) TO authenticated,service_role;
CREATE INDEX contacts_verified_phone ON public.contacts(workspace_id,public.contact_link_phone(phone,phone_origen));
CREATE INDEX contacts_verified_email ON public.contacts(workspace_id,public.contact_link_email(email,email_origen));

CREATE FUNCTION public.protect_contact_link_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user IN ('anon','authenticated') AND (NEW.unified_contact_id IS NOT NULL OR NEW.union_bloqueada) THEN RAISE EXCEPTION 'contact_identity_transaction_required';END IF;
  RETURN NEW;
 END IF;
 IF NEW.unified_contact_id IS DISTINCT FROM OLD.unified_contact_id OR NEW.union_bloqueada IS DISTINCT FROM OLD.union_bloqueada THEN
  IF current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'contact_identity_transaction_required';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_contact_link_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protect_contact_link_write() TO service_role;
CREATE TRIGGER contact_link_write_guard BEFORE INSERT OR UPDATE OF unified_contact_id,union_bloqueada ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.protect_contact_link_write();

CREATE FUNCTION public.audit_contact_link_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.unified_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts p
  WHERE p.id=NEW.unified_contact_id AND p.workspace_id=NEW.workspace_id AND p.id<>NEW.id)
 THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 IF TG_OP='UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) AND EXISTS(
  SELECT 1 FROM public.contacts c WHERE c.unified_contact_id=NEW.id AND c.workspace_id IS DISTINCT FROM NEW.workspace_id)
 THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 IF TG_OP='UPDATE' AND (NEW.unified_contact_id IS DISTINCT FROM OLD.unified_contact_id OR NEW.union_bloqueada IS DISTINCT FROM OLD.union_bloqueada) THEN
  INSERT INTO public.contact_identity_events(workspace_id,contact_id,actor_id,source,previous_primary_id,primary_id,previous_blocked,blocked)
  VALUES(NEW.workspace_id,NEW.id,auth.uid(),CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END,
   OLD.unified_contact_id,NEW.unified_contact_id,OLD.union_bloqueada,NEW.union_bloqueada);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_contact_link_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.audit_contact_link_write() TO service_role;
CREATE TRIGGER contact_link_scope_audit BEFORE INSERT OR UPDATE OF workspace_id,unified_contact_id,union_bloqueada ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.audit_contact_link_write();

CREATE FUNCTION public.link_verified_contact(p_workspace_id uuid,p_contact_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor public.contacts; ids uuid[]; roots uuid[]; primary_id uuid; phone_key text; email_key text;
BEGIN
 IF p_workspace_id IS NULL OR p_contact_id IS NULL THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-identity:'||p_workspace_id::text,0));
 SELECT * INTO anchor FROM public.contacts WHERE id=p_contact_id AND workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 IF anchor.union_bloqueada THEN RETURN anchor.id;END IF;
 phone_key=public.contact_link_phone(anchor.phone,anchor.phone_origen); email_key=public.contact_link_email(anchor.email,anchor.email_origen);
 IF phone_key IS NULL AND email_key IS NULL THEN RETURN anchor.id;END IF;
 SELECT array_agg(candidate.id) INTO ids FROM (SELECT c.id FROM public.contacts c WHERE c.workspace_id=p_workspace_id
  AND (c.id=anchor.id OR (phone_key IS NOT NULL AND public.contact_link_phone(c.phone,c.phone_origen)=phone_key)
   OR (email_key IS NOT NULL AND public.contact_link_email(c.email,c.email_origen)=email_key)) ORDER BY c.id LIMIT 51) candidate;
 IF cardinality(ids)>50 THEN RETURN anchor.id;END IF;
 SELECT array_agg(DISTINCT COALESCE(c.unified_contact_id,c.id)) INTO roots FROM public.contacts c WHERE c.workspace_id=p_workspace_id AND c.id=ANY(ids);
 SELECT array_agg(candidate.id) INTO ids FROM (SELECT c.id FROM public.contacts c WHERE c.workspace_id=p_workspace_id
  AND (c.id=ANY(ids) OR c.id=ANY(roots) OR c.unified_contact_id=ANY(roots)) ORDER BY c.id LIMIT 51) candidate;
 IF cardinality(ids)>50 THEN RETURN anchor.id;END IF;
 PERFORM 1 FROM public.contacts WHERE workspace_id=p_workspace_id AND id=ANY(ids) ORDER BY id FOR UPDATE;
 SELECT * INTO anchor FROM public.contacts WHERE id=p_contact_id AND workspace_id=p_workspace_id;
 phone_key=public.contact_link_phone(anchor.phone,anchor.phone_origen); email_key=public.contact_link_email(anchor.email,anchor.email_origen);
 -- Revalidate persisted identities after locking, including every preexisting sibling.
 IF anchor.union_bloqueada OR (phone_key IS NULL AND email_key IS NULL) OR EXISTS(SELECT 1 FROM public.contacts c
  WHERE c.workspace_id=p_workspace_id AND c.id=ANY(ids) AND (c.union_bloqueada
   OR (c.unified_contact_id IS NOT NULL AND NOT c.unified_contact_id=ANY(ids))
   OR NOT COALESCE((phone_key IS NOT NULL AND public.contact_link_phone(c.phone,c.phone_origen)=phone_key)
    OR (email_key IS NOT NULL AND public.contact_link_email(c.email,c.email_origen)=email_key),false))) THEN RETURN anchor.id;END IF;
 IF (SELECT count(DISTINCT lower(btrim(email))) FROM public.contacts WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND NULLIF(btrim(email),'') IS NOT NULL)>1
 OR (SELECT count(DISTINCT regexp_replace(phone,'[^0-9]','','g')) FROM public.contacts WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND NULLIF(regexp_replace(phone,'[^0-9]','','g'),'') IS NOT NULL)>1
 THEN RETURN anchor.id;END IF;
 SELECT c.id INTO primary_id FROM public.contacts c WHERE c.workspace_id=p_workspace_id AND c.id=ANY(ids) ORDER BY c.created_at NULLS FIRST,c.id LIMIT 1;
 UPDATE public.contacts SET unified_contact_id=NULL WHERE workspace_id=p_workspace_id AND id=primary_id AND unified_contact_id IS NOT NULL;
 UPDATE public.contacts SET unified_contact_id=primary_id WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND id<>primary_id AND unified_contact_id IS DISTINCT FROM primary_id;
 RETURN primary_id;
END $$;
REVOKE ALL ON FUNCTION public.link_verified_contact(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_verified_contact(uuid,uuid) TO service_role;

CREATE FUNCTION public.set_contact_unification_block(p_workspace_id uuid,p_contact_id uuid,p_separate boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid=auth.uid();target public.contacts;
BEGIN
 IF actor IS NULL OR p_workspace_id IS NULL OR p_contact_id IS NULL OR p_separate IS NULL THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-identity:'||p_workspace_id::text,0));
 PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=actor
  AND (allowed_sections IS NULL OR to_jsonb(allowed_sections) ? '/contactos' OR to_jsonb(allowed_sections) ? '/bandeja') FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 IF NOT public.workspace_billing_write_allowed(p_workspace_id) THEN RAISE EXCEPTION 'subscription_read_only';END IF;
 PERFORM 1 FROM public.contacts WHERE workspace_id=p_workspace_id AND (id=p_contact_id OR unified_contact_id=p_contact_id) ORDER BY id FOR UPDATE;
 SELECT * INTO target FROM public.contacts WHERE id=p_contact_id AND workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 IF p_separate THEN
  -- Separating a primary also detaches its children; they cannot keep reading that identity.
  UPDATE public.contacts SET unified_contact_id=NULL WHERE workspace_id=p_workspace_id AND unified_contact_id=target.id;
  UPDATE public.contacts SET unified_contact_id=NULL,union_bloqueada=true WHERE workspace_id=p_workspace_id AND id=target.id;
 ELSE
  UPDATE public.contacts SET union_bloqueada=false WHERE workspace_id=p_workspace_id AND id=target.id;
  PERFORM public.link_verified_contact(p_workspace_id,target.id);
 END IF;
 RETURN p_separate;
END $$;
REVOKE ALL ON FUNCTION public.set_contact_unification_block(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_contact_unification_block(uuid,uuid,boolean) TO authenticated,service_role;

CREATE FUNCTION public.verified_contact_family(p_workspace_id uuid,p_contact_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor public.contacts;root public.contacts;ids uuid[];phone_key text;email_key text;
BEGIN
 SELECT * INTO anchor FROM public.contacts WHERE workspace_id=p_workspace_id AND id=p_contact_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL) THEN RETURN '[]';END IF;
 IF anchor.union_bloqueada THEN RETURN jsonb_build_array(anchor.id);END IF;
 SELECT * INTO root FROM public.contacts WHERE workspace_id=p_workspace_id AND id=COALESCE(anchor.unified_contact_id,anchor.id);
 IF NOT FOUND OR root.union_bloqueada OR root.unified_contact_id IS NOT NULL THEN RETURN jsonb_build_array(anchor.id);END IF;
 phone_key=public.contact_link_phone(anchor.phone,anchor.phone_origen);email_key=public.contact_link_email(anchor.email,anchor.email_origen);
 SELECT array_agg(c.id) INTO ids FROM (SELECT id FROM public.contacts WHERE workspace_id=p_workspace_id
  AND (id=root.id OR unified_contact_id=root.id) ORDER BY id LIMIT 51) c;
 IF cardinality(ids)>50 OR NOT anchor.id=ANY(ids) OR (phone_key IS NULL AND email_key IS NULL) THEN RETURN jsonb_build_array(anchor.id);END IF;
 IF EXISTS(SELECT 1 FROM public.contacts c WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND (c.union_bloqueada
  OR NOT COALESCE((phone_key IS NOT NULL AND public.contact_link_phone(c.phone,c.phone_origen)=phone_key)
   OR (email_key IS NOT NULL AND public.contact_link_email(c.email,c.email_origen)=email_key),false)))
 OR (SELECT count(DISTINCT lower(btrim(email))) FROM public.contacts WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND NULLIF(btrim(email),'') IS NOT NULL)>1
 OR (SELECT count(DISTINCT regexp_replace(phone,'[^0-9]','','g')) FROM public.contacts WHERE workspace_id=p_workspace_id AND id=ANY(ids) AND NULLIF(regexp_replace(phone,'[^0-9]','','g'),'') IS NOT NULL)>1
 THEN RETURN jsonb_build_array(anchor.id);END IF;
 RETURN to_jsonb(ids);
END $$;
REVOKE ALL ON FUNCTION public.verified_contact_family(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verified_contact_family(uuid,uuid) TO service_role;

CREATE FUNCTION public.contact_identity_family(p_workspace_id uuid,p_contact_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=auth.uid()
  AND (allowed_sections IS NULL OR to_jsonb(allowed_sections) ? '/contactos' OR to_jsonb(allowed_sections) ? '/bandeja')) THEN RAISE EXCEPTION 'invalid_contact_identity';END IF;
 RETURN public.verified_contact_family(p_workspace_id,p_contact_id);
END $$;
REVOKE ALL ON FUNCTION public.contact_identity_family(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contact_identity_family(uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.read_verified_primary_contact(p_workspace_id uuid,p_contact_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(p) FROM public.contacts c JOIN public.contacts p ON p.id=c.unified_contact_id AND p.workspace_id=c.workspace_id
 JOIN public.workspaces w ON w.id=c.workspace_id AND w.deleted_at IS NULL
 WHERE c.workspace_id=p_workspace_id AND c.id=p_contact_id AND c.id<>p.id AND NOT c.union_bloqueada AND NOT p.union_bloqueada AND p.unified_contact_id IS NULL
 AND public.verified_contact_family(p_workspace_id,p_contact_id) ? p.id::text
 AND COALESCE(public.contact_link_phone(c.phone,c.phone_origen)=public.contact_link_phone(p.phone,p.phone_origen)
  OR public.contact_link_email(c.email,c.email_origen)=public.contact_link_email(p.email,p.email_origen),false)
 AND NOT (NULLIF(lower(btrim(c.email)),'') IS NOT NULL AND NULLIF(lower(btrim(p.email)),'') IS NOT NULL AND lower(btrim(c.email))<>lower(btrim(p.email)))
 AND NOT (NULLIF(regexp_replace(c.phone,'[^0-9]','','g'),'') IS NOT NULL AND NULLIF(regexp_replace(p.phone,'[^0-9]','','g'),'') IS NOT NULL
  AND regexp_replace(c.phone,'[^0-9]','','g')<>regexp_replace(p.phone,'[^0-9]','','g'));
$$;
REVOKE ALL ON FUNCTION public.read_verified_primary_contact(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_verified_primary_contact(uuid,uuid) TO service_role;

CREATE FUNCTION public.contact_identity_transactions_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.contact_identity_events'::regclass)
 AND NOT has_table_privilege('anon','public.contact_identity_events','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.contact_identity_events','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role','public.contact_identity_events','INSERT,UPDATE,DELETE')
 AND (SELECT count(*)=2 AND bool_and(tgenabled='O') FROM pg_catalog.pg_trigger WHERE tgrelid='public.contacts'::regclass
  AND tgname IN ('contact_link_write_guard','contact_link_scope_audit'))
 AND (SELECT count(*)=4 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""']
  AND NOT has_function_privilege('anon',oid,'execute') AND NOT has_function_privilege('authenticated',oid,'execute')
  AND has_function_privilege('service_role',oid,'execute')) FROM pg_catalog.pg_proc WHERE oid IN (
  'public.link_verified_contact(uuid,uuid)'::regprocedure,'public.read_verified_primary_contact(uuid,uuid)'::regprocedure,'public.audit_contact_link_write()'::regprocedure,'public.verified_contact_family(uuid,uuid)'::regprocedure))
 AND (SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.set_contact_unification_block(uuid,uuid,boolean)'::regprocedure)
 AND NOT has_function_privilege('anon','public.set_contact_unification_block(uuid,uuid,boolean)','execute')
 AND has_function_privilege('authenticated','public.set_contact_unification_block(uuid,uuid,boolean)','execute')
 AND NOT has_function_privilege('anon','public.contact_identity_family(uuid,uuid)','execute')
 AND has_function_privilege('authenticated','public.contact_identity_family(uuid,uuid)','execute')
 AND (SELECT NOT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.protect_contact_link_write()'::regprocedure)
 AND NOT has_function_privilege('authenticated','public.protect_contact_link_write()','execute')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conname='contacts_identity_same_workspace' AND conrelid='public.contacts'::regclass
  AND confrelid='public.contacts'::regclass AND contype='f')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid='public.contacts_identity_workspace_id'::regclass AND indisunique AND indisvalid);
$$;
REVOKE ALL ON FUNCTION public.contact_identity_transactions_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contact_identity_transactions_ready() TO service_role;
