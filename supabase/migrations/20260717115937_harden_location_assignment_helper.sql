-- Prevent authenticated callers from probing another user's location assignments.

CREATE OR REPLACE FUNCTION has_active_location_assignment(
  p_user_id uuid,
  p_location_id uuid,
  p_on_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_location_assignments
      JOIN public.locations
        ON locations.id = user_location_assignments.location_id
      WHERE user_location_assignments.user_id = p_user_id
        AND user_location_assignments.location_id = p_location_id
        AND user_location_assignments.effective_from <= p_on_date
        AND (
          user_location_assignments.effective_to IS NULL
          OR user_location_assignments.effective_to >= p_on_date
        )
        AND locations.active = true
    )
$$;
