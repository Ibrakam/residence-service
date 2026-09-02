DO $$
DECLARE
    role_is_unsafe boolean;
BEGIN
    SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication
    INTO role_is_unsafe
    FROM pg_roles
    WHERE rolname = 'tencorp_ticket_bot';

    IF role_is_unsafe IS NULL THEN
        RAISE EXCEPTION 'required role tencorp_ticket_bot does not exist';
    END IF;
    IF role_is_unsafe THEN
        RAISE EXCEPTION 'tencorp_ticket_bot must be NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION';
    END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM tencorp_ticket_bot;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM tencorp_ticket_bot;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM tencorp_ticket_bot;
REVOKE CREATE ON SCHEMA public FROM tencorp_ticket_bot;
GRANT USAGE ON SCHEMA public TO tencorp_ticket_bot;

GRANT SELECT, INSERT ON TABLE ticket_automation_updates TO tencorp_ticket_bot;
GRANT SELECT, INSERT, UPDATE ON TABLE ticket_automation_offsets TO tencorp_ticket_bot;
GRANT SELECT, INSERT, UPDATE ON TABLE tickets TO tencorp_ticket_bot;
GRANT SELECT, INSERT ON TABLE ticket_messages TO tencorp_ticket_bot;
GRANT SELECT, INSERT, UPDATE ON TABLE ticket_attachments TO tencorp_ticket_bot;
GRANT SELECT, INSERT, UPDATE ON TABLE ticket_worker_lease TO tencorp_ticket_bot;

GRANT USAGE, SELECT ON SEQUENCE tickets_id_seq TO tencorp_ticket_bot;
GRANT USAGE, SELECT ON SEQUENCE ticket_messages_id_seq TO tencorp_ticket_bot;
GRANT USAGE, SELECT ON SEQUENCE ticket_attachments_id_seq TO tencorp_ticket_bot;
GRANT EXECUTE ON FUNCTION ticket_cap_body(text, text) TO tencorp_ticket_bot;

DO $$
DECLARE
    forbidden_table regclass;
    forbidden_name text;
    privilege_name text;
BEGIN
    IF NOT has_function_privilege('tencorp_ticket_bot', 'ticket_cap_body(text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'tencorp_ticket_bot lacks EXECUTE on ticket_cap_body(text,text)';
    END IF;

    FOREACH forbidden_name IN ARRAY ARRAY['leads', 'integrations'] LOOP
        forbidden_table := to_regclass('public.' || forbidden_name);
        IF forbidden_table IS NULL THEN
            CONTINUE;
        END IF;
        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ] LOOP
            IF has_table_privilege('tencorp_ticket_bot', forbidden_table, privilege_name) THEN
                RAISE EXCEPTION 'tencorp_ticket_bot unexpectedly has % on %', privilege_name, forbidden_name;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;
