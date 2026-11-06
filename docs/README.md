# AURORE 설계 문서

현재 구현 상태와 후속 코드 변경 승인 범위는 [코드 현황](CODE_STATUS.md)에서 확인한다. 아래 v3.2는 설계 기록이며 전체 기능의 구현 완료를 뜻하지 않는다.

최신 기준은 [AURORE v3.2 결정·작업 정리](V3_2_SUMMARY.md)다(2026-11-05). 40개 테이블의 설계 검토를 마무리한 것으로 간주하고 구현 준비로 전환했으며, 실제 DB 검증 및 구현 승인은 별도다. 이번 작업은 문서 정리·커밋에 한정한다. 아래 v1.2 통합 설명과 DB 초안은 이전 기록으로 보존한다.

2026-11-05에 기존 Markdown 및 참조 대화에서 확인 가능한 v1.2 결정과 후속 소프트 삭제 지시를 통합했다. **문서화 승인과 DB 구현 승인은 별개이며 전체 물리설계는 미승인이다.**

| 문서 | 확인할 내용 |
| --- | --- |
| [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | 승인된 방향, 미승인 초안, 남은 검토 |
| [DECISIONS.md](DECISIONS.md) | 결정 근거와 이전 제안의 대체 관계 |
| [DB_CONVENTIONS.md](DB_CONVENTIONS.md) | 명명, 약어, 코드, 삭제 규칙 |
| [DB_DESIGN.md](DB_DESIGN.md) | 도메인 관계 및 v1.2 스키마 초안 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Verbatim RAG, 원본·검색·설명 분리 |
| [FEATURES.md](FEATURES.md) | 회원별 기능과 향후 검토 단계 |

근거 대화: 「법령 해설 프로그램 개발환경 세팅」, ID `6aa81388-db70-83e9-857e-a0d811879d82`. v1.2 통합 당시 확인 범위와 이번 v2.8~v3.2 확인 범위는 구분한다. 최신 확인 범위는 v3.2 요약에 기록했으며, 확인되지 않은 세부사항은 확정으로 간주하지 않는다.

## 다른 PC에서 이어 보기

처음 받는 PC에서는 `git clone https://github.com/orca305/AURORE.git` 후 `docs/README.md`를 연다. 기존 작업 폴더에서는 미커밋 변경을 먼저 확인하고 `git pull --ff-only origin main`으로 갱신한다. 충돌이나 분기가 있으면 강제 덮어쓰기 없이 검토한다. 설계 변경은 결정 기록과 검토 상태를 함께 갱신하여 커밋·푸시한다. GitHub에는 실제 상담·개인정보·비밀정보를 넣지 않는다.
