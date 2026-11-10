BEGIN;
CREATE UNIQUE INDEX uq_legal_ver_edition ON legal_ver (legal_id, ver_key, enfc_dt);
CREATE UNIQUE INDEX uq_legal_ver_undated ON legal_ver (legal_id, ver_key) WHERE enfc_dt IS NULL;
DROP INDEX uq_legal_ver_key;
COMMIT;
