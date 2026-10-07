# STEP 08-4 외부 provider 검토 — 개발 fallback 과 운영 후보

## 1. 현재 사용 범위 (코드 기준)
| 용도 | provider | 등급 | 코드 |
|---|---|---|---|
| 현재가 · 시가총액 · 발행주식수 · 52주 범위 · 베타 · 부채 지표 | Yahoo Finance (yfinance) | 비공식 · development | `app/external/yahoo.py` |
| 비교기업 후보(같은 산업 분류 screener) · 배수 · 영업이익률 · 매출 | Yahoo Finance | 비공식 · development | `YahooComparables` |
| 무위험수익률 (한국 장기 국채 10Y, 월평균) | FRED 의 OECD 시리즈 | 재배포(secondary) · development | `app/external/fred.py` |
| 뉴스 (제목 · 요약) | Google News RSS | 비공식(개인 · 비상업) · development | `app/external/news.py` |

Yahoo 는 Valuation 의 입력이 되지 않는다: Tool 결과는 읽기 전용(`applied:false`)이고 재무 Actual 은 OpenDART / ValuFlow Historical 만 쓴다.

## 2. 운영에서 교체해야 하는 이유
- Yahoo / yfinance: 공식 API 계약 · SLA 가 없고 스크래핑에 가까운 접근이라 예고 없는 차단 · 필드 변경 · 지연이 가능하다. 실제로 삼성전자 영업이익률 52%, 매출 485조원처럼 DART 기준(약 13%, 333조원)과 크게 다른 값이 나왔다. 한국 종목의 PER · PBR 은 누락이 많았다. 재배포 · 상업 이용 조건도 불분명하다.
- Google News RSS: feed 문구가 개인 · 비상업 이용으로 한정되고 API 계약이 없다.
- FRED(OECD): 월 단위라 한 달 이상 늦고, 한국 공식 일별 국고채 수익률이 아니다.
→ 코드는 `APP_ENV=production` 에서 development 등급 provider 를 막고(그 Tool 만 unavailable), 결과에 비공식 경고를 붙인다.

## 3. 교체 후보 (확인 수준을 구분해서 적는다)
### 시장 데이터 (주가 · 시가총액 · 발행주식수 · 52주 범위)
| 후보 | 확인한 내용 | 확인하지 못한 내용 |
|---|---|---|
| 공공데이터포털 「금융위원회_주식시세정보」(data.go.kr 15094808) | **공식 페이지에서 확인**: 시가 · 종가 · 고가 · 저가 · 거래량 · 시가총액(`mrktTotAmt`) · 상장주식수(`lstgStCnt`) 제공. 일 1회, 기준일 다음 영업일 13시 이후 제공(금요일 데이터는 월요일). 개발계정 10,000건/일. 라이선스 "공공저작물 제4유형: 출처표시, **상업적 이용금지**, 변경금지", 상업 목적은 KRX Data Marketplace 유료 구매. 무료. | 엔드포인트 · 응답 전체 필드(Swagger), 이력 보관 기간. 52주 범위는 필드로 제공되지 않아 일별 이력으로 직접 계산해야 한다(그러면 이력 조회 한도가 영향). |
| KRX Data Marketplace / KRX Open API | 위 공공데이터 페이지가 상업 이용 시 KRX 유료 구매를 안내한다. | 요금 · 승인 절차 · 상업 이용 조건 · 실시간 여부는 공식 페이지에서 읽지 못했다(견적 문의 필요). |
| 증권사 / 데이터 벤더(예: 상용 시세 API) | 조사하지 않았다. | 한국 시장 지원 · 가격 · 라이선스는 비교 견적이 필요하다. |

→ 비상업 · 학습 목적이면 공공데이터포털 주식시세정보가 가장 가깝다(지연 시세, 비상업). 상업 서비스면 KRX 유료 라이선스 또는 상용 벤더가 필요하다. 어느 쪽이든 **베타 · 비교기업 배수 · 부채 지표는 이 API 에 없다**: 베타는 일별 수익률로 직접 산출하고, 비교기업 배수는 DART 재무 + 시총으로 직접 계산하는 방식이 valuation-grade 에 맞다 (후속 작업).

### 무위험수익률
| 후보 | 확인한 내용 | 확인하지 못한 내용 |
|---|---|---|
| 한국은행 ECOS Open API | 한국은행 공식 경제통계시스템. 검색 결과 기준으로 무료 인증키(이메일 · 사용 목적 신청), 키당 일 약 1,000건 한도라는 설명이 있었다(2차 자료). | 공식 문서 페이지는 SPA 라 읽지 못했다: 이용약관 원문, 일별 시장금리 국고채 10년의 통계표 · 항목 코드(예: 817Y002 계열이라는 추정은 **검증 전**), 재배포 조건. |
→ 한국 국고채 10년의 일별 공식 값이므로 FRED 를 대체하는 1순위 후보다. 구현 전에 통계코드와 약관을 공식 문서로 확인해야 한다.

### 뉴스
| 후보 | 확인한 내용 | 확인하지 못한 내용 |
|---|---|---|
| 네이버 검색 Open API(뉴스) | 2차 자료 기준: 앱 등록 후 무료, 검색 전체 일 25,000 호출. | 공식 개발자 문서를 가져오지 못했다(접근 차단). 응답 필드 · 저장/표시 조건 · 상업 이용 조건 미확인. |
| 한국언론진흥재단 BigKinds 등 | 조사하지 않았다. | 승인 · 이용 조건 필요. |
| 상용 뉴스 API | 조사하지 않았다. | 한국어 지원 · 가격 · 라이선스. |
→ 어느 provider 든 약관의 저장 · 재표시 · 출처표기 조건을 확인해야 하고, Tool 은 지금처럼 제목 · 요약 · 링크만 쓰는 방식이 안전하다.

## 4. 기존 Tool contract 변경 없이 교체 가능한가
가능하다. Tool 은 `providers.py` 의 Protocol(`MarketDataProvider` · `RiskFreeRateProvider` · `ComparableProvider` · `NewsProvider`)에만 의존한다. 새 provider 는 같은 dataclass(`MarketSnapshot` · `RiskFreeRate` · `NewsItem`)를 돌려주는 adapter 와 `info = ProviderInfo(...)` 만 추가하고 `registry.py` 에 등록하면 된다 (`tests/test_credentials.py` 가 공식 provider 로 바꿔도 출력 필드가 같음을 검증한다). 단 provider 가 주지 못하는 필드(예: 공공데이터에는 베타 · 배수가 없음)는 `missing` / null 로 내려가므로 **데이터 범위가 줄어드는 것은 contract 변경이 아니라 provider 능력의 차이**다. 필요하면 beta / peer multiple 은 ValuFlow 안에서 DART + 일별 시세로 계산하는 별도 provider 로 만든다.

## 5. API Key · 비용 · 라이선스 요약
| provider | Key | 비용 | 라이선스 / 이용 조건 | 상태 |
|---|---|---|---|---|
| Yahoo Finance (현재) | 불필요 | 무료 | 계약 없음, 상업 이용 · 재배포 불분명 | development 전용 |
| FRED / OECD (현재) | 불필요 | 무료 | 미검증 (재배포 조건 확인 필요) | development 전용 |
| Google News RSS (현재) | 불필요 | 무료 | 개인 · 비상업(feed 문구) | development 전용 |
| 공공데이터포털 주식시세정보 | 필요(무료 신청) | 무료 | 출처표시 · 상업 이용 금지 · 변경 금지 | 후보(비상업) |
| KRX Data Marketplace | 필요 | 유료(미확인) | 상업 이용 가능(공공데이터 페이지 안내) | 후보(상업) |
| 한국은행 ECOS | 필요(무료 신청) | 무료 | 약관 미확인 | 후보(Rf 1순위) |
| 네이버 검색 Open API | 필요(무료 신청) | 무료 | 공식 조건 미확인 | 후보(뉴스) |
