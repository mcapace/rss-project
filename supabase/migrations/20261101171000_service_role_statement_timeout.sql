-- The maintenance scripts read the content database as the service role; the
-- legacy-host scan over body_html needs longer than the API's 8 second default.
ALTER ROLE service_role SET statement_timeout = '180s';
NOTIFY pgrst, 'reload config';
