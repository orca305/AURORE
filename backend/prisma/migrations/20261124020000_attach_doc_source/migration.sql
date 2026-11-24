BEGIN;

-- 첨부 형식을 늘린다(스프레드시트·발표자료·표·RTF·OpenDocument).
ALTER TABLE attach_doc DROP CONSTRAINT attach_doc_format_cd_check;
ALTER TABLE attach_doc ADD CONSTRAINT attach_doc_format_cd_check
  CHECK (format_cd IN ('pdf', 'hwp', 'hwpx', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp',
                       'xlsx', 'pptx', 'csv', 'tsv', 'rtf', 'odt', 'ods', 'odp'));

-- 올린 원본 파일(개인정보를 가리지 않은 그대로)을 첨부자료와 1:1 로 보관한다. 내려받기용이며 답변 생성에는 쓰지 않는다.
-- 삭제는 첨부자료(attach_doc)의 소프트 삭제를 따르고, 보관 점검(privacy-retention)이 삭제된 첨부의 원본 보관 수를 센다.
CREATE TABLE attach_doc_src (
    attach_doc_id UUID PRIMARY KEY REFERENCES attach_doc(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    orig_nm VARCHAR(200) NOT NULL CHECK (char_length(btrim(orig_nm)) >= 1),
    mime_cd VARCHAR(100) NOT NULL,
    src_cont BYTEA NOT NULL CHECK (octet_length(src_cont) BETWEEN 1 AND 5242880),
    rgst_dttm TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
