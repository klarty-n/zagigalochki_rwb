-- Operational objects belong to the loader, outside raw/core business tables.
CREATE SCHEMA IF NOT EXISTS etl;
CREATE TABLE IF NOT EXISTS etl.load_runs (
    run_id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
    error_message text,
    source_mode text NOT NULL DEFAULT 'full_raw_snapshot',
    source_counts jsonb,
    sql_sha256 text NOT NULL
);
CREATE TABLE IF NOT EXISTS etl.rejected_rows (
    run_id uuid NOT NULL REFERENCES etl.load_runs,
    target_table text NOT NULL,
    source_ref text NOT NULL,
    source_key jsonb NOT NULL,
    source_record jsonb NOT NULL,
    errors text[] NOT NULL,
    PRIMARY KEY(run_id, target_table, source_ref),
    CHECK(cardinality(errors) > 0)
);
CREATE TABLE IF NOT EXISTS etl.table_stats (
    run_id uuid NOT NULL REFERENCES etl.load_runs,
    target_table text NOT NULL,
    read_rows bigint NOT NULL,
    accepted_rows bigint NOT NULL,
    rejected_rows bigint NOT NULL,
    inserted_rows bigint NOT NULL,
    updated_rows bigint NOT NULL,
    unchanged_rows bigint NOT NULL,
    PRIMARY KEY(run_id, target_table),
    CHECK(read_rows = accepted_rows + rejected_rows),
    CHECK(accepted_rows = inserted_rows + updated_rows + unchanged_rows)
);

CREATE OR REPLACE FUNCTION etl.clean(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(btrim(value, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)), '');
$$;

-- Guard every cast. Invalid inputs are diagnosed before publication, not rounded/coerced.
CREATE OR REPLACE FUNCTION etl.valid_value(value text, target_type text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF target_type = 'text' THEN RETURN true; END IF;
  IF target_type IN ('integer', 'smallint') THEN
    RETURN value ~ '^[+-]?[0-9]+$' AND pg_input_is_valid(value, target_type);
  ELSIF target_type = 'numeric(12,2)' THEN
    RETURN value ~ '^[+-]?[0-9]+([.][0-9]{1,2})?$' AND pg_input_is_valid(value, target_type);
  ELSIF target_type IN ('timestamp', 'date') THEN
    IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
       OR NOT pg_input_is_valid(value, 'timestamp without time zone') THEN RETURN false; END IF;
    RETURN target_type <> 'date' OR right(value, 8) = '00:00:00';
  END IF;
  RAISE EXCEPTION 'Unsupported ETL type: %', target_type;
END;
$$;
