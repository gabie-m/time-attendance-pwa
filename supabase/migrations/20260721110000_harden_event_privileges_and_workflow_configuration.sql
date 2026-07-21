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

COMMENT ON FUNCTION preflight_flag_review_workflow_map(date, date, jsonb) IS
  'Admin preflight for a proposed complete workflow map. Existing gaps covered by the proposal are not reported as surviving gaps.';
COMMENT ON FUNCTION set_flag_review_workflow_map(date, date, jsonb) IS
  'Applies only complete, future-effective workflow maps and preserves surrounding versions without creating gaps.';
COMMENT ON FUNCTION acknowledge_flag_review_workflow_gap(date, date, flag_type[], text) IS
  'Explicit admin confirmation for a finite legacy, import, or recovery gap. The UI must collect a non-empty reason and show the exact dates and flag types before invoking this RPC.';

CREATE OR REPLACE FUNCTION set_attendance_rule(
  p_rule_key text,
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
  expected_value_type public.attendance_rule_value_type;
  rule_description text;
  left_rule public.attendance_rules%ROWTYPE;
  right_rule public.attendance_rules%ROWTYPE;
  replacement_rule_id uuid;
  before_rows jsonb;
  integer_value numeric;
  text_value text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'Only active admins can configure attendance rules.';
  END IF;

  IF p_rule_key IS NULL OR length(btrim(p_rule_key)) = 0 THEN
    RAISE EXCEPTION 'An approved attendance rule key is required.';
  END IF;

  IF p_rule_key = 'flag_review_workflow_mode_by_flag_type' THEN
    RAISE EXCEPTION 'Flag workflow configuration must use set_flag_review_workflow_map().';
  END IF;

  expected_value_type := CASE p_rule_key
    WHEN 'late_grace_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'clock_discrepancy_threshold_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'photo_time_mismatch_threshold_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'lunch_deduction_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'overtime_threshold_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'early_lunch_return_threshold_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'short_attendance_gap_confirmation_minutes' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'max_edit_request_days_back' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'gps_low_accuracy_threshold_meters' THEN 'integer'::public.attendance_rule_value_type
    WHEN 'late_handling_mode' THEN 'text'::public.attendance_rule_value_type
    WHEN 'travel_time_reporting_mode' THEN 'text'::public.attendance_rule_value_type
    ELSE NULL
  END;

  IF expected_value_type IS NULL THEN
    RAISE EXCEPTION 'Unknown or unapproved attendance rule key: %.', p_rule_key;
  END IF;

  SELECT description
  INTO rule_description
  FROM public.attendance_rules
  WHERE rule_key = p_rule_key
  ORDER BY effective_from DESC, created_at DESC, id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved attendance rule key % has no seeded definition.', p_rule_key;
  END IF;

  IF p_effective_from IS NULL
    OR NOT isfinite(p_effective_from)
    OR p_effective_from <= CURRENT_DATE
    OR (p_effective_to IS NOT NULL AND NOT isfinite(p_effective_to))
    OR (p_effective_to IS NOT NULL AND p_effective_to < p_effective_from)
  THEN
    RAISE EXCEPTION 'Ordinary attendance rule changes must start after the current date and use a valid effective range.';
  END IF;

  CASE expected_value_type
    WHEN 'integer' THEN
      IF jsonb_typeof(p_rule_value) IS DISTINCT FROM 'number'
        OR p_rule_value::text !~ '^-?[0-9]+$'
      THEN
        RAISE EXCEPTION 'Attendance rule % requires an integer JSON value.', p_rule_key;
      END IF;

      integer_value := (p_rule_value #>> '{}')::numeric;
      IF integer_value < 0 THEN
        RAISE EXCEPTION 'Attendance rule % cannot be negative.', p_rule_key;
      END IF;

      IF p_rule_key IN (
        'overtime_threshold_minutes',
        'gps_low_accuracy_threshold_meters'
      ) AND integer_value = 0 THEN
        RAISE EXCEPTION 'Attendance rule % must be greater than zero.', p_rule_key;
      END IF;

    WHEN 'text' THEN
      IF jsonb_typeof(p_rule_value) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Attendance rule % requires a text JSON value.', p_rule_key;
      END IF;

      text_value := p_rule_value #>> '{}';
      IF p_rule_key = 'late_handling_mode'
        AND text_value NOT IN ('flag_only', 'flag_and_deduct')
      THEN
        RAISE EXCEPTION 'late_handling_mode must be flag_only or flag_and_deduct.';
      ELSIF p_rule_key = 'travel_time_reporting_mode'
        AND text_value <> 'paid_non_productive_separate'
      THEN
        RAISE EXCEPTION 'travel_time_reporting_mode must be paid_non_productive_separate.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Attendance rule % has an unsupported value type.', p_rule_key;
  END CASE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attendance_rule_configuration:' || p_rule_key, 0)
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(rules) ORDER BY rules.effective_from), '[]'::jsonb)
  INTO before_rows
  FROM public.attendance_rules AS rules
  WHERE rules.rule_key = p_rule_key
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
  WHERE rule_key = p_rule_key
    AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to >= p_effective_from)
  ORDER BY effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF p_effective_to IS NOT NULL THEN
    SELECT *
    INTO right_rule
    FROM public.attendance_rules
    WHERE rule_key = p_rule_key
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
  WHERE rules.rule_key = p_rule_key
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
    p_rule_key,
    p_rule_value,
    expected_value_type,
    rule_description,
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

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_json,
    after_json
  ) VALUES (
    auth.uid(),
    'attendance_rule_configured',
    'attendance_rule',
    replacement_rule_id,
    jsonb_build_object(
      'rule_key', p_rule_key,
      'overlapping_versions', before_rows
    ),
    jsonb_build_object(
      'rule_key', p_rule_key,
      'rule_value', p_rule_value,
      'value_type', expected_value_type,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to
    )
  );

  RETURN replacement_rule_id;
END;
$$;

COMMENT ON FUNCTION set_attendance_rule(text, date, date, jsonb) IS
  'Active-admin RPC for approved non-workflow attendance rules. Changes are future-effective, value-validated, range-preserving, and audited.';

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

CREATE OR REPLACE FUNCTION correct_existing_flag_review_workflow_maps()
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_rule public.attendance_rules%ROWTYPE;
  corrected_rule public.attendance_rules%ROWTYPE;
  corrected_map jsonb;
  corrected_count integer := 0;
  default_map constant jsonb := '{
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
  FOR existing_rule IN
    SELECT *
    FROM public.attendance_rules
    WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
    ORDER BY effective_from, id
    FOR UPDATE
  LOOP
    SELECT jsonb_object_agg(
      official.enumlabel,
      CASE
        WHEN official.enumlabel IN (
          'deactivated_user_record',
          'clock_discrepancy'
        ) THEN 'manager_view_admin_approve'
        WHEN existing_rule.rule_value ->> official.enumlabel IN (
          'manager_review_admin_observe',
          'manager_preapprove_admin_final',
          'manager_view_admin_approve'
        ) THEN existing_rule.rule_value ->> official.enumlabel
        ELSE default_map ->> official.enumlabel
      END
      ORDER BY official.enumsortorder
    )
    INTO corrected_map
    FROM pg_catalog.pg_enum AS official
    WHERE official.enumtypid = 'public.flag_type'::regtype;

    PERFORM public.assert_valid_flag_review_workflow_map(corrected_map);

    IF existing_rule.rule_value IS DISTINCT FROM corrected_map
      OR existing_rule.value_type IS DISTINCT FROM 'json'
    THEN
      UPDATE public.attendance_rules
      SET rule_value = corrected_map,
          value_type = 'json',
          description = 'Maps every official attendance flag type to an approved deterministic review workflow mode.',
          updated_at = now()
      WHERE id = existing_rule.id
      RETURNING * INTO corrected_rule;

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
        existing_rule.id,
        to_jsonb(existing_rule),
        to_jsonb(corrected_rule)
      );

      corrected_count := corrected_count + 1;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.attendance_rules
    WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
  ) THEN
    RAISE EXCEPTION 'At least one flag workflow rule version is required.';
  END IF;

  FOR existing_rule IN
    SELECT *
    FROM public.attendance_rules
    WHERE rule_key = 'flag_review_workflow_mode_by_flag_type'
    ORDER BY effective_from, id
  LOOP
    PERFORM public.assert_valid_flag_review_workflow_map(existing_rule.rule_value);
  END LOOP;

  RETURN corrected_count;
END;
$$;

SELECT correct_existing_flag_review_workflow_maps();

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
REVOKE ALL PRIVILEGES ON FUNCTION correct_existing_flag_review_workflow_maps()
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

REVOKE ALL PRIVILEGES ON FUNCTION set_attendance_rule(text, date, date, jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_attendance_rule(text, date, date, jsonb)
TO authenticated;
