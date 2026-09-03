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
    WHERE rolname = 'tencorp_auth_gateway';

    IF role_is_unsafe IS NULL THEN
        RAISE EXCEPTION 'required role tencorp_auth_gateway does not exist';
    END IF;
    IF role_is_unsafe OR NOT role_can_login THEN
        RAISE EXCEPTION 'tencorp_auth_gateway must be LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = role_oid) THEN
        RAISE EXCEPTION 'tencorp_auth_gateway must not be a member of any other role';
    END IF;
END;
$$;

DO $$
DECLARE
    required_name text;
BEGIN
    FOREACH required_name IN ARRAY ARRAY[
        'web_auth_users',
        'web_auth_login_transactions',
        'web_auth_sessions',
        'web_auth_users_id_seq'
    ] LOOP
        IF to_regclass('public.' || required_name) IS NULL THEN
            RAISE EXCEPTION 'required auth relation public.% does not exist; apply migration 0014 first', required_name;
        END IF;
    END LOOP;
END;
$$;

-- Remove every direct runtime grant before installing the reviewed allowlist.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tencorp_auth_gateway;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tencorp_auth_gateway;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM tencorp_auth_gateway;
REVOKE CREATE ON SCHEMA public FROM tencorp_auth_gateway;
GRANT USAGE ON SCHEMA public TO tencorp_auth_gateway;

-- The runtime writes the verified profile during an OIDC callback, but normal
-- session checks do not need to read the stored phone or picture URL. Column
-- grants also keep the operator-owned status and identity keys immutable.
GRANT SELECT (
    id, issuer, subject, telegram_user_id, status,
    display_name, given_name, family_name, username
) ON TABLE web_auth_users TO tencorp_auth_gateway;
GRANT INSERT (
    issuer, subject, telegram_user_id, display_name, given_name, family_name,
    username, picture_url, phone_number, phone_number_verified, last_login_at
) ON TABLE web_auth_users TO tencorp_auth_gateway;
GRANT UPDATE (
    telegram_user_id, display_name, given_name, family_name, username,
    picture_url, phone_number, phone_number_verified, last_login_at, updated_at
) ON TABLE web_auth_users TO tencorp_auth_gateway;
GRANT SELECT, INSERT, DELETE ON TABLE web_auth_login_transactions TO tencorp_auth_gateway;
GRANT SELECT, INSERT, DELETE ON TABLE web_auth_sessions TO tencorp_auth_gateway;
GRANT USAGE, SELECT ON SEQUENCE web_auth_users_id_seq TO tencorp_auth_gateway;

DO $$
DECLARE
    relation record;
    routine record;
    privilege_name text;
    column_name text;
BEGIN
    IF NOT has_schema_privilege('tencorp_auth_gateway', 'public', 'USAGE') OR
       has_schema_privilege('tencorp_auth_gateway', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'tencorp_auth_gateway has an invalid public schema privilege set';
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF has_table_privilege('tencorp_auth_gateway', 'web_auth_users', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has table-wide % on web_auth_users', privilege_name;
        END IF;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'id', 'issuer', 'subject', 'telegram_user_id', 'status',
        'display_name', 'given_name', 'family_name', 'username'
    ] LOOP
        IF NOT has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'SELECT') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks SELECT on web_auth_users.%', column_name;
        END IF;
    END LOOP;
    FOREACH column_name IN ARRAY ARRAY[
        'picture_url', 'phone_number', 'phone_number_verified',
        'created_at', 'updated_at', 'last_login_at'
    ] LOOP
        IF has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'SELECT') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has SELECT on web_auth_users.%', column_name;
        END IF;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'issuer', 'subject', 'telegram_user_id', 'display_name', 'given_name',
        'family_name', 'username', 'picture_url', 'phone_number',
        'phone_number_verified', 'last_login_at'
    ] LOOP
        IF NOT has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'INSERT') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks INSERT on web_auth_users.%', column_name;
        END IF;
    END LOOP;
    FOREACH column_name IN ARRAY ARRAY['id', 'status', 'created_at', 'updated_at'] LOOP
        IF has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'INSERT') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has INSERT on web_auth_users.%', column_name;
        END IF;
    END LOOP;

    FOREACH column_name IN ARRAY ARRAY[
        'telegram_user_id', 'display_name', 'given_name', 'family_name', 'username',
        'picture_url', 'phone_number', 'phone_number_verified', 'last_login_at', 'updated_at'
    ] LOOP
        IF NOT has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'UPDATE') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks UPDATE on web_auth_users.%', column_name;
        END IF;
    END LOOP;
    FOREACH column_name IN ARRAY ARRAY['id', 'issuer', 'subject', 'status', 'created_at'] LOOP
        IF has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'UPDATE') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has UPDATE on web_auth_users.%', column_name;
        END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'DELETE'] LOOP
        IF NOT has_table_privilege('tencorp_auth_gateway', 'web_auth_login_transactions', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks % on web_auth_login_transactions', privilege_name;
        END IF;
        IF NOT has_table_privilege('tencorp_auth_gateway', 'web_auth_sessions', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks % on web_auth_sessions', privilege_name;
        END IF;
    END LOOP;
    FOREACH privilege_name IN ARRAY ARRAY['UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('tencorp_auth_gateway', 'web_auth_login_transactions', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has % on web_auth_login_transactions', privilege_name;
        END IF;
        IF has_table_privilege('tencorp_auth_gateway', 'web_auth_sessions', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has % on web_auth_sessions', privilege_name;
        END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['USAGE', 'SELECT'] LOOP
        IF NOT has_sequence_privilege('tencorp_auth_gateway', 'web_auth_users_id_seq', privilege_name) THEN
            RAISE EXCEPTION 'tencorp_auth_gateway lacks % on web_auth_users_id_seq', privilege_name;
        END IF;
    END LOOP;
    IF has_sequence_privilege('tencorp_auth_gateway', 'web_auth_users_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has UPDATE on web_auth_users_id_seq';
    END IF;

    FOR relation IN
        SELECT ns.nspname, class.relname, class.oid
        FROM pg_class AS class
        JOIN pg_namespace AS ns ON ns.oid = class.relnamespace
        WHERE ns.nspname = 'public'
          AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND class.relname NOT IN (
              'web_auth_users',
              'web_auth_login_transactions',
              'web_auth_sessions'
          )
    LOOP
        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege('tencorp_auth_gateway', relation.oid, privilege_name) THEN
                RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has % on %.%',
                    privilege_name, relation.nspname, relation.relname;
            END IF;
        END LOOP;
    END LOOP;

    FOR relation IN
        SELECT ns.nspname, class.relname, class.oid
        FROM pg_class AS class
        JOIN pg_namespace AS ns ON ns.oid = class.relnamespace
        WHERE ns.nspname = 'public'
          AND class.relkind = 'S'
          AND class.relname <> 'web_auth_users_id_seq'
    LOOP
        FOREACH privilege_name IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
            IF has_sequence_privilege('tencorp_auth_gateway', relation.oid, privilege_name) THEN
                RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has % on %.%',
                    privilege_name, relation.nspname, relation.relname;
            END IF;
        END LOOP;
    END LOOP;

    -- PostgreSQL grants EXECUTE on new routines to PUBLIC by default. A
    -- role-specific REVOKE cannot cancel that inherited privilege, so fail
    -- closed if any routine in public is executable through either PUBLIC or
    -- a future role membership. Migration owners must explicitly revoke the
    -- routine from PUBLIC before rerunning this allowlist.
    FOR routine IN
        SELECT ns.nspname, procedure.proname, procedure.oid
        FROM pg_proc AS procedure
        JOIN pg_namespace AS ns ON ns.oid = procedure.pronamespace
        WHERE ns.nspname = 'public'
    LOOP
        IF has_function_privilege('tencorp_auth_gateway', routine.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'tencorp_auth_gateway unexpectedly has EXECUTE on %.%',
                routine.nspname, routine.proname;
        END IF;
    END LOOP;
END;
$$;
