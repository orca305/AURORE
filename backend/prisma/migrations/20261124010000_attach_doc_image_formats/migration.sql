BEGIN;

-- 첨부자료에 이미지(PNG·JPG·WEBP)를 올릴 수 있게 허용 형식을 늘린다. 이미지는 글자 인식(OCR) 결과만 저장하고 원본 이미지는 저장하지 않는다.
ALTER TABLE attach_doc DROP CONSTRAINT attach_doc_format_cd_check;
ALTER TABLE attach_doc ADD CONSTRAINT attach_doc_format_cd_check
  CHECK (format_cd IN ('pdf', 'hwp', 'hwpx', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'));

COMMIT;
