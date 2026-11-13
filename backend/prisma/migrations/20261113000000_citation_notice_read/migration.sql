CREATE TABLE cite_notice_read (
 id BIGSERIAL PRIMARY KEY,
 ans_cite_id BIGINT NOT NULL REFERENCES ans_cite(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 target_snapshot_id BIGINT NOT NULL REFERENCES src_snapshot(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 user_id BIGINT REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 guest_sess_id UUID REFERENCES guest_sess(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 kind_cd VARCHAR(24) NOT NULL CHECK (kind_cd IN ('LAW_CORRECTED','PRECEDENT_CORRECTED')),
 compare_href TEXT,
 current_href TEXT NOT NULL,
 read_dttm TIMESTAMPTZ(0) NOT NULL,
 CONSTRAINT ck_cite_notice_read_owner CHECK ((user_id IS NOT NULL)::integer + (guest_sess_id IS NOT NULL)::integer=1),
 CONSTRAINT uq_cite_notice_read_source UNIQUE(ans_cite_id,target_snapshot_id),
 CONSTRAINT ck_cite_notice_read_href CHECK (current_href LIKE '/legals/%' OR current_href LIKE '/precedents?%')
);
CREATE INDEX idx_cite_notice_read_date ON cite_notice_read(read_dttm DESC,id DESC);
