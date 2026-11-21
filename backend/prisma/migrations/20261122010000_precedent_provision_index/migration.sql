BEGIN;

-- 판례가 인용한 조문의 역인덱스. 판례 원문의 "참조조문" 글에서 자동으로 만든다.
-- 조문 행(legal_provi)은 시행본이 바뀌면 달라지므로 법령(legal_id)과 조문 번호(art_key, 예: 750, 54의2)로 연결한다.
CREATE TABLE legal_prec_ref (
    id BIGSERIAL PRIMARY KEY,
    legal_prec_id BIGINT NOT NULL REFERENCES legal_prec(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    legal_id BIGINT NOT NULL REFERENCES legal(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    art_key TEXT NOT NULL CHECK (btrim(art_key) <> ''),
    old_yn BOOLEAN NOT NULL DEFAULT FALSE,
    raw_law_nm TEXT NOT NULL CHECK (btrim(raw_law_nm) <> ''),
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_legal_prec_ref_target ON legal_prec_ref (legal_prec_id, legal_id, art_key, old_yn);
CREATE INDEX idx_legal_prec_ref_article ON legal_prec_ref (legal_id, art_key);

COMMIT;
