BEGIN;

CREATE TABLE legal_ver_rev (
    id BIGSERIAL PRIMARY KEY,
    legal_ver_id BIGINT NOT NULL REFERENCES legal_ver(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    rev_no INTEGER NOT NULL CHECK (rev_no > 0),
    src_snapshot_id BIGINT REFERENCES src_snapshot(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    current_yn BOOLEAN NOT NULL DEFAULT false,
    rgst_dttm TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_legal_ver_rev_no ON legal_ver_rev (legal_ver_id, rev_no);
CREATE UNIQUE INDEX uq_legal_ver_rev_source ON legal_ver_rev (legal_ver_id, src_snapshot_id);
CREATE UNIQUE INDEX uq_legal_ver_current_rev ON legal_ver_rev (legal_ver_id) WHERE current_yn;
CREATE INDEX idx_legal_ver_rev_snapshot ON legal_ver_rev (src_snapshot_id);

INSERT INTO legal_ver_rev (legal_ver_id, rev_no, src_snapshot_id, current_yn, rgst_dttm)
SELECT id, 1, src_snapshot_id, true, rgst_dttm FROM legal_ver ORDER BY id;

ALTER TABLE legal_provi ADD COLUMN legal_ver_rev_id BIGINT;
UPDATE legal_provi p
   SET legal_ver_rev_id = r.id
  FROM legal_ver_rev r
 WHERE r.legal_ver_id = p.legal_ver_id AND r.rev_no = 1;

ALTER TABLE legal_provi ALTER COLUMN legal_ver_rev_id SET NOT NULL;
ALTER TABLE legal_provi ADD CONSTRAINT legal_provi_legal_ver_rev_id_fkey
    FOREIGN KEY (legal_ver_rev_id) REFERENCES legal_ver_rev(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX uq_legal_provi_id_rev ON legal_provi (id, legal_ver_rev_id);
ALTER TABLE legal_provi ADD CONSTRAINT legal_provi_prnt_provi_id_legal_ver_rev_id_fkey
    FOREIGN KEY (prnt_provi_id, legal_ver_rev_id) REFERENCES legal_provi(id, legal_ver_rev_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE legal_provi DROP CONSTRAINT legal_provi_prnt_provi_id_legal_ver_id_fkey;
ALTER TABLE legal_provi DROP CONSTRAINT legal_provi_legal_ver_id_fkey;
DROP INDEX uq_legal_provi_id_ver;
DROP INDEX idx_legal_provi_sort;
ALTER TABLE legal_provi DROP COLUMN legal_ver_id;
CREATE INDEX idx_legal_provi_sort ON legal_provi (legal_ver_rev_id, sort_seq, id);
ALTER TABLE legal_ver DROP COLUMN src_snapshot_id;

COMMIT;
