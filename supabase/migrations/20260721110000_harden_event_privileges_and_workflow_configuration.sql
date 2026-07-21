-- Harden attendance evidence privileges and make flag workflow configuration
-- complete, effective-dated, and explicitly accountable when fallback is used.

REVOKE ALL PRIVILEGES ON TABLE attendance_events
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE attendance_flags
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE attendance_flag_reviews
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE attendance_events TO authenticated, service_role;
GRANT SELECT ON TABLE attendance_flags TO authenticated, service_role;
GRANT SELECT ON TABLE attendance_flag_reviews TO authenticated, service_role;

-- Flag generation belongs to the future controlled attendance recorder. The
-- previous trigger implemented only a subset of the required validations.
DROP TRIGGER attendance_events_create_automatic_flags ON attendance_events;
DROP FUNCTION create_automatic_attendance_flags();

CREATE TABLE flag_workflow_fallback_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL,
  effective_to date NOT NULL,
  flag_types flag_type[] NOT NULL,
  reason text NOT NULL,
  acknowledged_by_admin_id uuid NOT NULL,
  preflight_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flag_workflow_fallback_acknowledgments_range_valid CHECK (
    isfinite(effective_from)
    AND isfinite(effective_to)
    AND effective_to >= effective_from
  ),
  CONSTRAINT flag_workflow_fallback_acknowledgments_types_non_empty CHECK (
    cardinality(flag_types) > 0
    AND array_position(flag_types, NULL) IS NULL
  ),
  CONSTRAINT flag_workflow_fallback_acknowledgments_reason_required CHECK (
    length(btrim(reason)) > 0
  ),
  CONSTRAINT flag_workflow_fallback_acknowledgments_actor_fkey
    FOREIGN KEY (acknowledged_by_admin_id) REFERENCES users(id),
  CONSTRAINT flag_workflow_fallback_acknowledgments_preflight_object CHECK (
    jsonb_typeof(preflight_result) = 'object'
  )
);

CREATE INDEX flag_workflow_fallback_acknowledgments_range_idx
ON flag_workflow_fallback_acknowledgments (effective_from, effective_to);

ALTER TABLE attendance_flags
ADD COLUMN workflow_fallback_acknowledgment_id uuid
REFERENCES flag_workflow_fallback_acknowledgments(id);

COMMENT ON TABLE flag_workflow_fallback_acknowledgments IS
  'Append-only, finite admin authorization for manager_view_admin_approve fallback during an exact flag-type/date workflow gap.';
COMMENT ON COLUMN attendance_flags.workflow_fallback_acknowledgment_id IS
  'Audit reference required whenever a flag snapshots the authorized workflow fallback.';

CREATE OR REPLACE FUNCTION reject_flag_workflow_fallback_acknowledgment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Flag workflow fallback acknowledgments are append-only.';
END;
$$;

CREATE TRIGGER flag_workflow_fallback_acknowledgments_reject_mutation
BEFORE UPDATE OR DELETE ON flag_workflow_fallback_acknowledgments
FOR EACH ROW
EXECUTE FUNCTION reject_flag_workflow_fallback_acknowledgment_mutation();

ALTER TABLE flag_workflow_fallback_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select flag workflow fallback acknowledgments"
ON flag_workflow_fallback_acknowledgments
FOR SELECT
TO authenticated
USING (current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION assert_valid_flag_review_workflow_map(
  p_rule_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  official_flag_type text;
  configured_key text;
  configured_mode text;
BEGIN
  IF jsonb_typeof(p_rule_value) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Flag workflow configuration must be a JSON object.';
  END IF;

  FOR official_flag_type IN
    SELECT enumlabel
    FROM pg_catalog.pg_enum
    WHERE enumtypid = 'public.flag_type'::regtype
    ORDER BY enumsortorder
  LOOP
    IF NOT p_rule_value ? official_flag_type THEN
      RAISE EXCEPTION 'Flag workflow configuration is missing official flag type: %.', official_flag_type;
    END IF;

    configured_mode := p_rule_value ->> official_flag_type;
    IF configured_mode NOT IN (
      'manager_review_admin_observe',
      'manager_preapprove_admin_final',
      'manager_view_admin_approve'
    ) THEN
      RAISE EXCEPTION 'Flag workflow configuration has an invalid mode for %.', official_flag_type;
    END IF;
  END LOOP;

  FOR configured_key IN
    SELECT jsonb_object_keys(p_rule_value)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_enum
      WHERE enumtypid = 'public.flag_type'::regtype
        AND enumlabel = configured_key
    ) THEN
      RAISE EXCEPTION 'Flag workflow configuration contains an unknown flag type: %.', configured_key;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION find_flag_review_workflow_gaps(
  p_effective_from date,
  p_effective_to date
)
RETURNS TABLE (
  flag_type flag_type,
  gap_from date,
  gap_to date,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_effective_from IS NULL
    OR p_effective_to IS NULL
    OR NOT isfinite(p_effective_from)
    OR NOT isfinite(p_effective_to)
    OR p_effective_to < p_effective_from
  THEN
    RAISE EXCEPTION 'A valid finite date range is required.';
  END IF;

  RETURN QUERY
  WITH official_flag_types AS (
    SELECT enumlabel::public.flag_type AS official_type
    FROM pg_catalog.pg_enum
    WHERE enumtypid = 'public.flag_type'::regtype
  ),
  target AS (
    SELECT daterange(p_effective_from, p_effective_to, '[]') AS target_range
  ),
  valid_coverage AS (
    SELECT
      official.official_type,
      range_agg(
        daterange(
          greatest(rules.effective_from, p_effective_from),
          least(COALESCE(rules.effective_to, p_effective_to), p_effective_to),
          '[]'
        )
      ) AS covered_ranges
    FROM official_flag_types AS official
    JOIN public.attendance_rules AS rules
      ON rules.rule_key = 'flag_review_workflow_mode_by_flag_type'
     AND daterange(
       rules.effective_from,
       COALESCE(rules.effective_to, 'infinity'::date),
       '[]'
     ) && daterange(p_effective_from, p_effective_to, '[]')
     AND rules.rule_value ->> official.official_type::text IN (
       'manager_review_admin_observe',
       'manager_preapprove_admin_final',
       'manager_view_admin_approve'
     )
    GROUP BY official.official_type
  ),
  uncovered AS (
    SELECT
      official.official_type,
      unnest(
        datemultirange(target.target_range)
        - COALESCE(coverage.covered_ranges, '{}'::datemultirange)
      ) AS gap_range
    FROM official_flag_types AS official
    CROSS JOIN target
    LEFT JOIN valid_coverage AS coverage
      ON coverage.official_type = official.official_type
  )
  SELECT
    uncovered.official_type,
    lower(uncovered.gap_range),
    upper(uncovered.gap_range) - 1,
    'no_valid_effective_workflow_map'::text
  FROM uncovered
  ORDER BY uncovered.official_type, lower(uncovered.gap_range);
END;
$$;

CREATE OR REPLACE FUNCTION preflight_flag_review_workflow_map(
  p_effective_from date,
  p_effective_to date,
  p_rule_value jsonb
)
RETURNS TABLE (
  flag_type flag_type,
  gap_from date,
  gap_to date,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  official_flag_type public.flag_type;
  configured_key text;
  configured_mode text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Only active admins can preflight flag workflow configuration.';
  END IF;

  IF p_effective_from IS NULL
    OR p_effective_to IS NULL
    OR NOT isfinite(p_effective_from)
    OR NOT isfinite(p_effective_to)
    OR p_effective_to < p_effective_from
  THEN
    RAISE EXCEPTION 'A valid finite date range is required.';
  END IF;

  IF jsonb_typeof(p_rule_value) IS DISTINCT FROM 'object' THEN
    RETURN QUERY
    SELECT
      NULL::public.flag_type,
      p_effective_from,
      p_effective_to,
      'configuration_must_be_json_object'::text;
    RETURN;
  END IF;

  -- The proposal overlays the requested range. Existing gaps inside that
  -- range therefore do not survive when the proposed value is complete.
  FOR official_flag_type IN
    SELECT enumlabel::public.flag_type
    FROM pg_catalog.pg_enum
    WHERE enumtypid = 'public.flag_type'::regtype
    ORDER BY enumsortorder
  LOOP
    configured_mode := p_rule_value ->> official_flag_type::text;
    IF configured_mode IS NULL THEN
      RETURN QUERY
      SELECT official_flag_type, p_effective_from, p_effective_to, 'missing_workflow_mode'::text;
    ELSIF configured_mode NOT IN (
      'manager_review_admin_observe',
      'manager_preapprove_admin_final',
      'manager_view_admin_approve'
    ) THEN
      RETURN QUERY
      SELECT official_flag_type, p_effective_from, p_effective_to, 'invalid_workflow_mode'::text;
    END IF;
  END LOOP;

  FOR configured_key IN
    SELECT jsonb_object_keys(p_rule_value)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_enum
      WHERE enumtypid = 'public.flag_type'::regtype
        AND enumlabel = configured_key
    ) THEN
      RETURN QUERY
      SELECT
        NULL::public.flag_type,
        p_effective_from,
        p_effective_to,
        ('unknown_flag_type:' || configured_key)::text;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_flag_review_workflow_gap(
  p_effective_from date,
  p_effective_to date,
  p_flag_types flag_type[],
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  acknowledgment_id uuid;
  acknowledged_flag_type public.flag_type;
  normalized_flag_types public.flag_type[];
  preflight_json jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Only active admins can acknowledge flag workflow gaps.';
  END IF;

  IF p_effective_from IS NULL
    OR p_effective_to IS NULL
    OR NOT isfinite(p_effective_from)
    OR NOT isfinite(p_effective_to)
    OR p_effective_to < p_effective_from
    OR COALESCE(cardinality(p_flag_types), 0) = 0
    OR array_position(p_flag_types, NULL) IS NOT NULL
    OR length(btrim(COALESCE(p_reason, ''))) = 0
  THEN
    RAISE EXCEPTION 'A finite date range, at least one flag type, and a non-empty reason are required.';
  END IF;

  SELECT array_agg(DISTINCT selected_flag_type ORDER BY selected_flag_type)
  INTO normalized_flag_types
  FROM unnest(p_flag_types) AS selected_flag_type;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('flag_review_workflow_configuration', 0)
  );

  FOR acknowledged_flag_type IN
    SELECT unnest(normalized_flag_types)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.find_flag_review_workflow_gaps(p_effective_from, p_effective_to) AS gap
      WHERE gap.flag_type = acknowledged_flag_type
        AND gap.gap_from = p_effective_from
        AND gap.gap_to = p_effective_to
    ) THEN
      RAISE EXCEPTION 'Fallback requires an actual workflow gap for % across the exact requested range.', acknowledged_flag_type;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.flag_workflow_fallback_acknowledgments AS existing
    WHERE daterange(existing.effective_from, existing.effective_to, '[]')
      && daterange(p_effective_from, p_effective_to, '[]')
      AND existing.flag_types && normalized_flag_types
  ) THEN
    RAISE EXCEPTION 'An overlapping fallback acknowledgment already covers at least one requested flag type.';
  END IF;

  SELECT jsonb_build_object(
    'gaps',
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'flag_type', gap.flag_type,
          'gap_from', gap.gap_from,
          'gap_to', gap.gap_to,
          'reason', gap.reason
        )
        ORDER BY gap.flag_type, gap.gap_from
      ) FILTER (WHERE gap.flag_type = ANY(normalized_flag_types)),
      '[]'::jsonb
    )
  )
  INTO preflight_json
  FROM public.find_flag_review_workflow_gaps(p_effective_from, p_effective_to) AS gap;

  INSERT INTO public.flag_workflow_fallback_acknowledgments (
    effective_from,
    effective_to,
    flag_types,
    reason,
    acknowledged_by_admin_id,
    preflight_result
  ) VALUES (
    p_effective_from,
    p_effective_to,
    normalized_flag_types,
    btrim(p_reason),
    auth.uid(),
    preflight_json
  )
  RETURNING id INTO acknowledgment_id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_json
  ) VALUES (
    auth.uid(),
    'flag_workflow_gap_acknowledged',
    'flag_workflow_fallback_acknowledgment',
    acknowledgment_id,
    jsonb_build_object(
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'flag_types', normalized_flag_types,
      'reason', btrim(p_reason),
      'preflight', preflight_json
    )
  );

  RETURN acknowledgment_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_flag_review_workflow_map(
  p_effective_from date,
  p_effective_to date,
  p_rule_value jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  left_rule public.attendance_rules%ROWTYPE;
  right_rule public.attendance_rules%ROWTYPE;
  replacement_rule_id uuid;
  before_rows jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Only active admins can configure flag review workflows.';
  END IF;

  IF p_effective_from IS NULL
    OR NOT isfinite(p_effective_from)
    OR p_effective_from <= CURRENT_DATE
    OR (p_effective_to IS NOT NULL AND NOT isfinite(p_effective_to))
    OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from)
  THEN
    RAISE EXCEPTION 'Normal workflow changes must start after the current date and use a valid effective range.';
  END IF;

  PERFORM public.assert_valid_flag_review_workflow_map(p_rule_value);

  IF EXISTS (
    SELECT 1
    FROM public.preflight_flag_review_workflow_map(
      p_effective_from,
      COALESCE(p_effective_to, '9999-12-31'::date),
      p_rule_value
    )
  ) THEN
    RAISE EXCEPTION 'The proposed workflow map failed coverage preflight.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('flag_review_workflow_configuration', 0)
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(rules) ORDER BY rules.effective_from), '[]'::jsonb)
  INTO before_rows
  FROM public.attendance_rules AS rules
  WHERE rules.rule_key = 'flag_review_workflow_mode_by_flag_type'
    AND daterange(
      rules.effective_from,
      COALESCE(rules.effective_to, 'infinity'::date),
      '[]'
    ) && daterange(
      p_effective_from,
      COALESCE(p_effective_to, 'infinity'::date),
      '[]'
    );

  SELECT *
  INTO left_rule
  FROM public.attendance_rules
  WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
    AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  ORDER BY effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF p_effective_to IS NOT NULL THEN
    SELECT *
    INTO right_rule
    FROM public.attendance_rules
    WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
      AND effective_from <= p_effective_to
      AND (effective_to IS NULL OR effective_to > p_effective_to)
    ORDER BY effective_from DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF left_rule.id IS NOT NULL THEN
    UPDATE public.attendance_rules
    SET effective_to = p_effective_from - 1,
        updated_at = now()
    WHERE id = left_rule.id;
  END IF;

  DELETE FROM public.attendance_rules AS rules
  WHERE rules.rule_key = 'flag_review_workflow_mode_by_flag_type'
    AND daterange(
      rules.effective_from,
      COALESCE(rules.effective_to, 'infinity'::date),
      '[]'
    ) && daterange(
      p_effective_from,
      COALESCE(p_effective_to, 'infinity'::date),
      '[]'
    );

  INSERT INTO public.attendance_rules (
    rule_key,
    rule_value,
    value_type,
    description,
    effective_from,
    effective_to,
    created_by
  ) VALUES (
    'flag_review_workflow_mode_by_flag_type',
    p_rule_value,
    'json',
    'Maps every official attendance flag type to an approved deterministic review workflow mode.',
    p_effective_from,
    p_effective_to,
    auth.uid()
  )
  RETURNING id INTO replacement_rule_id;

  IF p_effective_to IS NOT NULL AND right_rule.id IS NOT NULL THEN
    INSERT INTO public.attendance_rules (
      rule_key,
      rule_value,
      value_type,
      description,
      effective_from,
      effective_to,
      created_by,
      created_at,
      updated_at
    ) VALUES (
      right_rule.rule_key,
      right_rule.rule_value,
      right_rule.value_type,
      right_rule.description,
      p_effective_to + 1,
      right_rule.effective_to,
      right_rule.created_by,
      right_rule.created_at,
      now()
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.find_flag_review_workflow_gaps(
      p_effective_from,
      COALESCE(p_effective_to, '9999-12-31'::date)
    )
  ) THEN
    RAISE EXCEPTION 'Workflow configuration would leave a gap in the requested range.';
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_json,
    after_json
  ) VALUES (
    auth.uid(),
    'flag_review_workflow_configured',
    'attendance_rule',
    replacement_rule_id,
    jsonb_build_object('overlapping_versions', before_rows),
    jsonb_build_object(
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'rule_value', p_rule_value
    )
  );

  RETURN replacement_rule_id;
END;
$$;

CREATE OR REPLACE FUNCTION snapshot_attendance_flag_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  flag_work_date date;
  selected_workflow text;
  selected_effective_from date;
  fallback_record public.flag_workflow_fallback_acknowledgments%ROWTYPE;
BEGIN
  SELECT work_date
  INTO flag_work_date
  FROM public.attendance_sessions
  WHERE id = NEW.session_id
    AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance flag must belong to its session owner.';
  END IF;

  IF NEW.attendance_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendance_events
      WHERE id = NEW.attendance_event_id
        AND session_id = NEW.session_id
        AND user_id = NEW.user_id
    )
  THEN
    RAISE EXCEPTION 'Attendance flag event must belong to the same user and session.';
  END IF;

  SELECT
    rules.rule_value ->> NEW.flag_type::text,
    rules.effective_from
  INTO selected_workflow, selected_effective_from
  FROM public.attendance_rules AS rules
  WHERE rules.rule_key = 'flag_review_workflow_mode_by_flag_type'
    AND rules.effective_from <= flag_work_date
    AND (rules.effective_to IS NULL OR rules.effective_to >= flag_work_date)
  ORDER BY rules.effective_from DESC
  LIMIT 1;

  IF selected_workflow IN (
    'manager_review_admin_observe',
    'manager_preapprove_admin_final',
    'manager_view_admin_approve'
  ) THEN
    NEW.workflow_mode = selected_workflow::flag_review_workflow_mode;
    NEW.workflow_effective_from = selected_effective_from;
    NEW.workflow_fallback_acknowledgment_id = NULL;
    RETURN NEW;
  END IF;

  SELECT *
  INTO fallback_record
  FROM public.flag_workflow_fallback_acknowledgments
  WHERE flag_work_date BETWEEN effective_from AND effective_to
    AND NEW.flag_type = ANY(flag_types)
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No valid flag workflow is configured for flag type % on work date %, and no acknowledged fallback exists.', NEW.flag_type, flag_work_date;
  END IF;

  NEW.workflow_mode = 'manager_view_admin_approve';
  NEW.workflow_effective_from = fallback_record.effective_from;
  NEW.workflow_fallback_acknowledgment_id = fallback_record.id;
  NEW.evidence = COALESCE(NEW.evidence, '{}'::jsonb) || jsonb_build_object(
    'workflow_fallback',
    jsonb_build_object(
      'acknowledgment_id', fallback_record.id,
      'effective_from', fallback_record.effective_from,
      'effective_to', fallback_record.effective_to,
      'flag_type', NEW.flag_type
    )
  );

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  current_rule public.attendance_rules%ROWTYPE;
  corrected_rule_id uuid;
  corrected_map jsonb := '{
    "outside_radius": "manager_preapprove_admin_final",
    "gps_low_accuracy": "manager_review_admin_observe",
    "offline_submission": "manager_view_admin_approve",
    "location_conflict": "manager_preapprove_admin_final",
    "missing_punch": "manager_review_admin_observe",
    "deactivated_user_record": "manager_view_admin_approve",
    "late_sync": "manager_review_admin_observe",
    "clock_discrepancy": "manager_view_admin_approve",
    "early_lunch_return": "manager_review_admin_observe",
    "photo_time_mismatch": "manager_review_admin_observe",
    "missing_photo": "manager_review_admin_observe"
  }'::jsonb;
BEGIN
  PERFORM public.assert_valid_flag_review_workflow_map(corrected_map);

  SELECT *
  INTO current_rule
  FROM public.attendance_rules
  WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  ORDER BY effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No current flag workflow rule exists to correct.';
  END IF;

  IF current_rule.rule_value IS DISTINCT FROM corrected_map THEN
    IF current_rule.effective_from < CURRENT_DATE THEN
      UPDATE public.attendance_rules
      SET effective_to = CURRENT_DATE - 1,
          updated_at = now()
      WHERE id = current_rule.id;

      INSERT INTO public.attendance_rules (
        rule_key,
        rule_value,
        value_type,
        description,
        effective_from,
        effective_to,
        created_by
      ) VALUES (
        'flag_review_workflow_mode_by_flag_type',
        corrected_map,
        'json',
        'Maps every official attendance flag type to an approved deterministic review workflow mode.',
        CURRENT_DATE,
        current_rule.effective_to,
        NULL
      )
      RETURNING id INTO corrected_rule_id;
    ELSE
      -- Date-effective rules cannot represent two versions within one day.
      -- Existing flags retain their original routing in snapshot columns.
      UPDATE public.attendance_rules
      SET rule_value = corrected_map,
          description = 'Maps every official attendance flag type to an approved deterministic review workflow mode.',
          updated_at = now()
      WHERE id = current_rule.id
      RETURNING id INTO corrected_rule_id;
    END IF;

    INSERT INTO public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_json,
      after_json
    ) VALUES (
      NULL,
      'flag_review_workflow_mapping_corrected_by_migration',
      'attendance_rule',
      corrected_rule_id,
      to_jsonb(current_rule),
      jsonb_build_object(
        'effective_from', CURRENT_DATE,
        'effective_to', current_rule.effective_to,
        'rule_value', corrected_map
      )
    );
  END IF;
END;
$$;

DROP POLICY "Admins can insert attendance rules" ON attendance_rules;
DROP POLICY "Admins can update attendance rules" ON attendance_rules;

REVOKE ALL PRIVILEGES ON TABLE attendance_rules
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE attendance_rules TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE flag_workflow_fallback_acknowledgments
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE flag_workflow_fallback_acknowledgments
TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION assert_valid_flag_review_workflow_map(jsonb)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION find_flag_review_workflow_gaps(date, date)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION reject_flag_workflow_fallback_acknowledgment_mutation()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION validate_attendance_event_insert()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION snapshot_attendance_flag_workflow()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION validate_attendance_flag_review_insert()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION reject_attendance_event_mutation()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION reject_attendance_flag_mutation()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION reject_attendance_flag_review_mutation()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION preflight_flag_review_workflow_map(date, date, jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION preflight_flag_review_workflow_map(date, date, jsonb)
TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION acknowledge_flag_review_workflow_gap(date, date, flag_type[], text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION acknowledge_flag_review_workflow_gap(date, date, flag_type[], text)
TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION set_flag_review_workflow_map(date, date, jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_flag_review_workflow_map(date, date, jsonb)
TO authenticated;
