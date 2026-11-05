# AURORE

법규·판례 원문을 근거로 쉬운 설명을 제공하는 법령 해설 AI 프로젝트입니다. 이전 프로젝트명은 **Easy Law AI**입니다.

- 저장소: [orca305/AURORE](https://github.com/orca305/AURORE)
- [설계 문서 목록](docs/README.md)
- [승인된 방향과 검토 중인 설계](docs/DESIGN_REVIEW.md)
- [설계 결정 기록](docs/DECISIONS.md)

최신 기준은 [v3.2 설계 결정·작업 정리](docs/V3_2_SUMMARY.md)입니다. 전체 40개 테이블의 설계 검토를 마무리한 것으로 간주하고 구현 준비로 전환했습니다. 실제 DB 검증과 DB·Prisma·마이그레이션·애플리케이션 적용은 최종 미승인 상태입니다. 이번 문서 정리·커밋은 구현 승인을 뜻하지 않습니다. 기존 v1.2 초안은 이전 기록으로 보존합니다.

## 기존 작업 폴더의 원격 주소 갱신

```powershell
git remote set-url origin https://github.com/orca305/AURORE.git
git remote -v
```

로컬 폴더 이름이 `easy-law-ai`여도 사용할 수 있습니다. 새 PC에서는 `git clone https://github.com/orca305/AURORE.git`으로 내려받습니다.
