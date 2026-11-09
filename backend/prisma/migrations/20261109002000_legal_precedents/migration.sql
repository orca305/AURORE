BEGIN;

CREATE TABLE legal_prec (
    id BIGSERIAL PRIMARY KEY,
    src_cd VARCHAR(60) NOT NULL,
    src_key TEXT NOT NULL,
    del_yn BOOLEAN NOT NULL DEFAULT FALSE,
    del_dttm TIMESTAMPTZ(6),
    del_id BIGINT,
    rgst_dttm TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_legal_prec_source UNIQUE (src_cd, src_key),
    CONSTRAINT ck_legal_prec_delete CHECK (del_yn = (del_dttm IS NOT NULL))
);

CREATE TABLE legal_prec_rev (
    id BIGSERIAL PRIMARY KEY,
    legal_prec_id BIGINT NOT NULL REFERENCES legal_prec(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    src_snapshot_id BIGINT NOT NULL REFERENCES src_snapshot(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    rev_no INTEGER NOT NULL CHECK (rev_no > 0),
    current_yn BOOLEAN NOT NULL DEFAULT FALSE,
    case_no TEXT NOT NULL,
    case_nm TEXT NOT NULL,
    court_nm TEXT NOT NULL,
    decision_dt DATE NOT NULL,
    issue_cont TEXT,
    summary_cont TEXT,
    decision_cont TEXT NOT NULL CHECK (btrim(decision_cont) <> ''),
    rgst_dttm TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_legal_prec_rev_no UNIQUE (legal_prec_id, rev_no),
    CONSTRAINT uq_legal_prec_rev_source UNIQUE (legal_prec_id, src_snapshot_id)
);

CREATE UNIQUE INDEX uq_legal_prec_current_rev
    ON legal_prec_rev (legal_prec_id) WHERE current_yn;
CREATE INDEX idx_legal_prec_rev_case_no ON legal_prec_rev (case_no);

COMMIT;
