CREATE TABLE IF NOT EXISTS web_auth_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 255),
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
    telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
    given_name text NOT NULL DEFAULT '' CHECK (char_length(given_name) <= 255),
    family_name text NOT NULL DEFAULT '' CHECK (char_length(family_name) <= 255),
    username text NOT NULL DEFAULT '' CHECK (char_length(username) <= 64),
    picture_url text NOT NULL DEFAULT '' CHECK (
        char_length(picture_url) <= 2048 AND (picture_url = '' OR picture_url ~ '^https://')
    ),
    phone_number text NOT NULL CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    phone_number_verified boolean NOT NULL CHECK (phone_number_verified),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject),
    UNIQUE (issuer, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS web_auth_login_transactions (
    state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
    browser_binding_hash bytea NOT NULL CHECK (octet_length(browser_binding_hash) = 32),
    nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 43 AND 128),
    code_verifier text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
    return_to text NOT NULL CHECK (char_length(return_to) BETWEEN 1 AND 4096),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS web_auth_login_transactions_expiry_idx
    ON web_auth_login_transactions (expires_at);

CREATE TABLE IF NOT EXISTS web_auth_sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id bigint NOT NULL REFERENCES web_auth_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS web_auth_sessions_user_idx
    ON web_auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS web_auth_sessions_expiry_idx
    ON web_auth_sessions (expires_at);
