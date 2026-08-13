-- Preserve the controlled recorder's existing contract while exposing an
-- explicit acknowledgement identifier for the durable client outbox.

CREATE FUNCTION public.record_attendance_event_acknowledged(
  p_client_event_id uuid,
  p_event_type public.event_type,
  p_captured_at_local timestamptz,
  p_location_id uuid,
  p_session_id uuid DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_gps_accuracy_meters numeric DEFAULT NULL,
  p_offline_declared boolean DEFAULT false,
  p_offline_evidence jsonb DEFAULT '{}'::jsonb,
  p_photo_path text DEFAULT NULL,
  p_photo_metadata jsonb DEFAULT '{}'::jsonb,
  p_photo_captured_at timestamptz DEFAULT NULL,
  p_gps_warning_acknowledged boolean DEFAULT false,
  p_missing_photo_acknowledged boolean DEFAULT false,
  p_short_gap_acknowledged boolean DEFAULT false
)
RETURNS TABLE (
  recorded_client_event_id uuid,
  recorded_event_id uuid,
  recorded_session_id uuid,
  recorded_event_type public.event_type,
  recorded_session_type public.session_type,
  recorded_work_date date,
  recorded_session_status public.session_status,
  recorded_validation_status public.validation_status,
  recorded_flag_types public.flag_type[],
  recorded_received_at_server timestamptz,
  idempotent_replay boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    p_client_event_id,
    recorded.recorded_event_id,
    recorded.recorded_session_id,
    recorded.recorded_event_type,
    recorded.recorded_session_type,
    recorded.recorded_work_date,
    recorded.recorded_session_status,
    recorded.recorded_validation_status,
    recorded.recorded_flag_types,
    recorded.recorded_received_at_server,
    recorded.idempotent_replay
  FROM public.record_attendance_event(
    p_client_event_id,
    p_event_type,
    p_captured_at_local,
    p_location_id,
    p_session_id,
    p_purpose,
    p_latitude,
    p_longitude,
    p_gps_accuracy_meters,
    p_offline_declared,
    p_offline_evidence,
    p_photo_path,
    p_photo_metadata,
    p_photo_captured_at,
    p_gps_warning_acknowledged,
    p_missing_photo_acknowledged,
    p_short_gap_acknowledged
  ) AS recorded;
$$;

REVOKE ALL ON FUNCTION public.record_attendance_event_acknowledged(
  uuid, public.event_type, timestamptz, uuid, uuid, text, numeric, numeric,
  numeric, boolean, jsonb, text, jsonb, timestamptz, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_attendance_event_acknowledged(
  uuid, public.event_type, timestamptz, uuid, uuid, text, numeric, numeric,
  numeric, boolean, jsonb, text, jsonb, timestamptz, boolean, boolean, boolean
) TO authenticated;

COMMENT ON FUNCTION public.record_attendance_event_acknowledged(
  uuid, public.event_type, timestamptz, uuid, uuid, text, numeric, numeric,
  numeric, boolean, jsonb, text, jsonb, timestamptz, boolean, boolean, boolean
) IS 'Controlled attendance recorder wrapper that echoes the exact client event id acknowledged by the database.';
