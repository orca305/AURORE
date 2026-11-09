BEGIN;

CREATE TABLE legal_prec_provi (
    id BIGSERIAL PRIMARY KEY,
    legal_prec_rev_id BIGINT NOT NULL REFERENCES legal_prec_rev(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ref_key TEXT NOT NULL CHECK (btrim(ref_key) <> ''),
    legal_provi_id BIGINT REFERENCES legal_provi(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    stat_cd VARCHAR(20) NOT NULL,
    evidence_desc TEXT NOT NULL CHECK (btrim(evidence_desc) <> ''),
    del_yn BOOLEAN NOT NULL DEFAULT FALSE,
    del_dttm TIMESTAMPTZ(0),
    del_id BIGINT,
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_legal_prec_provi_target CHECK (
        (stat_cd = 'VERIFIED' AND legal_provi_id IS NOT NULL)
        OR (stat_cd = 'UNVERIFIED' AND legal_provi_id IS NULL)
    ),
    CONSTRAINT ck_legal_prec_provi_delete CHECK (del_yn = (del_dttm IS NOT NULL))
);

CREATE UNIQUE INDEX uq_legal_prec_provi_active_ref
    ON legal_prec_provi (legal_prec_rev_id, ref_key) WHERE NOT del_yn;
CREATE INDEX idx_legal_prec_provi_target
    ON legal_prec_provi (legal_provi_id) WHERE legal_provi_id IS NOT NULL;

COMMIT;
