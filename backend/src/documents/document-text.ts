// Pattern removal is a first pass; the owner must review names, addresses and context.
export function redactDocument(value: string) {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''))
    .replace(
      /[^\n]*(?:진단명|병력|질병|성생활|범죄경력|장애등급|정치성향|종교|노조가입)[^\n]*/g,
      '[민감정보가 포함될 수 있어 제외한 문장]',
    )
    .replace(
      /(?:성명|이름|주소|주민등록번호|계좌번호|신청인|피신청인|임대인|임차인)\s*[:：]\s*[^\n]+/g,
      (m) => m.split(/[:：]/)[0] + ': [제외]',
    )
    .replace(/(?<!\d)\d{6}\s*[-–]?\s*[1-8]\d{6}(?!\d)/g, '[주민등록번호 제외]')
    .replace(
      /(?<!\d)(?:\+82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g,
      '[연락처 제외]',
    )
    .replace(/(?<!\d)0\d{1,2}[ -]\d{3,4}[ -]\d{4}(?!\d)/g, '[연락처 제외]')
    .replace(/[^\s<>@]+@[^\s<>@]+\.[A-Z]{2,}/gi, '[이메일 제외]')
    .replace(
      /(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/g,
      '[카드번호 제외]',
    )
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}
export function markdownLiteral(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|>~-])/g, '\\$1');
}
