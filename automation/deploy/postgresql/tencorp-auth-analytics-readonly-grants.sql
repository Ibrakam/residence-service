DO $$
DECLARE
    role_oid oid;
    role_is_unsafe boolean;
    role_can_login boolean;
BEGIN
    SELECT oid,
           rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR
           rolreplication OR rolbypassrls,
           rolcanlogin
    INTO role_oid, role_is_unsafe, role_can_login
    FROM pg_roles
    WHERE rolname = 'tencorp_auth_analytics_readonly';

    IF role_is_unsafe IS NULL THEN
        RAISE EXCEPTION 'required role tencorp_auth_analytics_readonly does not exist';
    END IF;
    IF role_is_unsafe OR NOT role_can_login THEN
        RAISE EXCEPTION 'tencorp_auth_analytics_readonly must be LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_auth_members
        WHERE member = role_oid OR roleid = role_oid
    ) THEN
        RAISE EXCEPTION 'tencorp_auth_analytics_readonly must not participate in role memberships';
    END IF;
END;
$$;

DO $$
DECLARE
    required_name text;
BEGIN
    FOREACH required_name IN ARRAY ARRAY['authorized_users', 'active_sessions'] LOOP
        IF to_regclass('auth_reporting.' || required_name) IS NULL THEN
            RAISE EXCEPTION 'required reporting view auth_reporting.% does not exist; apply migration 0020 first', required_name;
        END IF;
    END LOOP;
END;
$$;

ALTER ROLE tencorp_auth_analytics_readonly SET default_transaction_read_only = on;
ALTER ROLE tencorp_auth_analytics_readonly SET statement_timeout = '2s';
ALTER ROLE tencorp_auth_analytics_readonly SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE tencorp_auth_analytics_readonly SET search_path = pg_catalog, auth_reporting;

GRANT CONNECT ON DATABASE residence_service TO tencorp_auth_analytics_readonly;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
    FROM tencorp_auth_analytics_readonly;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
    FROM tencorp_auth_analytics_readonly;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
    FROM tencorp_auth_analytics_readonly;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth_reporting
    FROM tencorp_auth_analytics_readonly;
REVOKE CREATE ON SCHEMA public FROM tencorp_auth_analytics_readonly;
REVOKE CREATE ON SCHEMA auth_reporting FROM tencorp_auth_analytics_readonly;

GRANT USAGE ON SCHEMA auth_reporting TO tencorp_auth_analytics_readonly;
GRANT SELECT (
    telegram_user_id, status, display_name, given_name, family_name, username,
    picture_url, phone_number, phone_number_verified, created_at, updated_at,
    last_login_at, active_session_count
) ON TABLE auth_reporting.authorized_users
TO tencorp_auth_analytics_readonly;
GRANT SELECT (
    telegram_user_id, created_at, expires_at
) ON TABLE auth_reporting.active_sessions
TO tencorp_auth_analytics_readonly;

DO $$
DECLARE
    relation_name text;
    privilege_name text;
    column_name text;
    actual_columns text[];
    other_relation record;
    routine record;
BEGIN
    IF NOT has_database_privilege(
        'tencorp_auth_analytics_readonly',
        'residence_service',
        'CONNECT'
    ) THEN
        RAISE EXCEPTION 'tencorp_auth_analytics_readonly lacks CONNECT on residence_service';
    END IF;

    IF NOT has_schema_privilege(
        'tencorp_auth_analytics_readonly',
        'auth_reporting',
        'USAGE'
    ) OR has_schema_privilege(
        'tencorp_auth_analytics_readonly',
        'auth_reporting',
        'CREATE'
    ) THEN
        RAISE EXCEPTION 'tencorp_auth_analytics_readonly has an invalid auth_reporting schema privilege set';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace AS namespace
        WHERE namespace.nspname = 'auth_reporting'
          AND pg_get_userbyid(namespace.nspowner) = 'postgres'
    ) THEN
        RAISE EXCEPTION 'auth_reporting schema must be owned by postgres';
    END IF;

    FOREACH relation_name IN ARRAY ARRAY['authorized_users', 'active_sessions'] LOOP
        IF has_table_privilege(
            'tencorp_auth_analytics_readonly',
            'auth_reporting.' || relation_name,
            'SELECT'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has table-wide SELECT on auth_reporting.%', relation_name;
        END IF;

        FOREACH privilege_name IN ARRAY ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege(
                'tencorp_auth_analytics_readonly',
                'auth_reporting.' || relation_name,
                privilege_name
            ) THEN
                RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has % on auth_reporting.%',
                    privilege_name, relation_name;
            END IF;
        END LOOP;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'telegram_user_id', 'status', 'display_name', 'given_name',
        'family_name', 'username', 'picture_url', 'phone_number',
        'phone_number_verified', 'created_at', 'updated_at', 'last_login_at',
        'active_session_count'
    ] LOOP
        IF NOT has_column_privilege(
            'tencorp_auth_analytics_readonly',
            'auth_reporting.authorized_users',
            column_name,
            'SELECT'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly lacks SELECT on auth_reporting.authorized_users.%', column_name;
        END IF;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'telegram_user_id', 'created_at', 'expires_at'
    ] LOOP
        IF NOT has_column_privilege(
            'tencorp_auth_analytics_readonly',
            'auth_reporting.active_sessions',
            column_name,
            'SELECT'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly lacks SELECT on auth_reporting.active_sessions.%', column_name;
        END IF;
    END LOOP;

    FOREACH relation_name IN ARRAY ARRAY['web_auth_users', 'web_auth_sessions'] LOOP
        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege(
                'tencorp_auth_analytics_readonly',
                'public.' || relation_name,
                privilege_name
            ) THEN
                RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has % on public.%',
                    privilege_name, relation_name;
            END IF;
        END LOOP;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'id', 'issuer', 'subject', 'telegram_user_id', 'status',
        'display_name', 'given_name', 'family_name', 'username', 'picture_url',
        'phone_number', 'phone_number_verified', 'created_at', 'updated_at',
        'last_login_at'
    ] LOOP
        IF has_column_privilege(
            'tencorp_auth_analytics_readonly',
            'public.web_auth_users',
            column_name,
            'SELECT'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has SELECT on public.web_auth_users.%', column_name;
        END IF;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'token_hash', 'user_id', 'created_at', 'expires_at', 'revoked_at'
    ] LOOP
        IF has_column_privilege(
            'tencorp_auth_analytics_readonly',
            'public.web_auth_sessions',
            column_name,
            'SELECT'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has SELECT on public.web_auth_sessions.%', column_name;
        END IF;
    END LOOP;

    FOR other_relation IN
        SELECT namespace.nspname, class.relname, class.oid
        FROM pg_class AS class
        JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
    LOOP
        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege(
                'tencorp_auth_analytics_readonly',
                other_relation.oid,
                privilege_name
            ) THEN
                RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has % on %.%',
                    privilege_name, other_relation.nspname, other_relation.relname;
            END IF;
        END LOOP;
    END LOOP;

    FOR other_relation IN
        SELECT namespace.nspname, class.relname, class.oid
        FROM pg_class AS class
        JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relkind = 'S'
    LOOP
        FOREACH privilege_name IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
            IF has_sequence_privilege(
                'tencorp_auth_analytics_readonly',
                other_relation.oid,
                privilege_name
            ) THEN
                RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has % on %.%',
                    privilege_name, other_relation.nspname, other_relation.relname;
            END IF;
        END LOOP;
    END LOOP;

    SELECT array_agg(columns.column_name ORDER BY columns.ordinal_position)
    INTO actual_columns
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'auth_reporting'
      AND columns.table_name = 'authorized_users';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'telegram_user_id', 'status', 'display_name', 'given_name',
        'family_name', 'username', 'picture_url', 'phone_number',
        'phone_number_verified', 'created_at', 'updated_at', 'last_login_at',
        'active_session_count'
    ]::text[] THEN
        RAISE EXCEPTION 'authorized_users exposes an unexpected column set: %', actual_columns;
    END IF;

    SELECT array_agg(columns.column_name ORDER BY columns.ordinal_position)
    INTO actual_columns
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'auth_reporting'
      AND columns.table_name = 'active_sessions';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'telegram_user_id', 'created_at', 'expires_at'
    ]::text[] THEN
        RAISE EXCEPTION 'active_sessions exposes an unexpected column set: %', actual_columns;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class AS view_relation
        JOIN pg_namespace AS namespace ON namespace.oid = view_relation.relnamespace
        WHERE namespace.nspname = 'auth_reporting'
          AND view_relation.relname IN ('authorized_users', 'active_sessions')
        GROUP BY namespace.nspname
        HAVING count(*) = 2
           AND bool_and(view_relation.reloptions @> ARRAY['security_barrier=true'])
           AND bool_and(view_relation.reloptions @> ARRAY['security_invoker=false'])
           AND bool_and(pg_get_userbyid(view_relation.relowner) = 'postgres')
    ) THEN
        RAISE EXCEPTION 'auth reporting views must be postgres-owned security-barrier definer views';
    END IF;

    FOR other_relation IN
        SELECT namespace.nspname, class.relname, class.oid
        FROM pg_class AS class
        JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'auth_reporting'
          AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND class.relname NOT IN ('authorized_users', 'active_sessions')
    LOOP
        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege(
                'tencorp_auth_analytics_readonly',
                other_relation.oid,
                privilege_name
            ) THEN
                RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has % on %.%',
                    privilege_name, other_relation.nspname, other_relation.relname;
            END IF;
        END LOOP;
    END LOOP;

    FOR routine IN
        SELECT namespace.nspname, procedure.proname, procedure.oid
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname IN ('public', 'auth_reporting')
    LOOP
        IF has_function_privilege(
            'tencorp_auth_analytics_readonly',
            routine.oid,
            'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'tencorp_auth_analytics_readonly unexpectedly has EXECUTE on %.%',
                routine.nspname, routine.proname;
        END IF;
    END LOOP;
END;
$$;
