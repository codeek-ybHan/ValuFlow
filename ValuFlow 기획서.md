# AI 기업가치평가 업무 자동화 프로젝트 --- 학습·실습·개발 통합 명세서

> Claude Code 전달용\
> 목적: **가치평가 도메인을 실제로 학습하면서, 각 단계의 수작업을
> 점진적으로 자동화하여 최종적으로 AI 기반 기업가치평가 업무지원
> 플랫폼을 구축한다.**

------------------------------------------------------------------------

## 0. 프로젝트의 핵심 방향

이 프로젝트는 단순한 "기업가치 계산기"를 만드는 프로젝트가 아니다.

학습자가 먼저 가치평가 업무를 직접 수행하고, 각 단계에서 반복적이거나
구조화 가능한 업무를 발견한 뒤 이를 Python, OpenDART, DB, LLM Agent,
RAG, Tool Calling 등으로 단계적으로 자동화한다.

최종적으로 사이트에서 다음 성장 과정이 보여야 한다.

``` text
직접 재무제표 읽기
        ↓
직접 재무분석하기
        ↓
직접 DCF 계산하기
        ↓
직접 WACC와 기업가치 계산하기
        ↓
Python으로 계산 자동화
        ↓
OpenDART로 데이터 수집 자동화
        ↓
AI Agent + RAG로 분석·해석 자동화
        ↓
최종 Valuation Report 생성
```

핵심 스토리:

> **업무를 이해한 뒤 자동화한다.**

기술을 먼저 붙이는 것이 아니라 가치평가 Workflow를 이해하고, 실제 업무
중 자동화 가능한 지점을 기술로 개선한다.

------------------------------------------------------------------------

# 1. 사이트 정보 구조

기존 `DAY`라는 용어는 사용하지 않는다.

``` text
Home
│
├── Roadmap
│
├── STEP 01 Financial Statements
├── STEP 02 Financial Analysis
├── STEP 03 DCF
├── STEP 04 WACC & Valuation
├── STEP 05 Python Automation
├── STEP 06 Financial Data Automation
├── STEP 07 AI Valuation Agent
├── STEP 08 Final Product
│
└── Project Report
```

각 STEP 내부 구조는 통일한다.

``` text
STEP
│
├── Overview
├── Learning Goals
├── LESSON 01
├── LESSON 02
├── ...
├── Check Quiz
├── Practice Mission
├── Project Build
├── Reflection / Notes
└── Completion Checklist
```

학습 경험은 반드시 다음 순서를 따른다.

``` text
LEARN
  ↓
QUIZ
  ↓
PRACTICE
  ↓
BUILD
  ↓
COMPLETE
```

각 Lesson의 내부 구조:

``` text
1. 개념
2. 직관적인 설명
3. 숫자 예시
4. 재무제표 또는 가치평가와의 연결
5. 실무에서는 왜 중요한가?
6. Mini Check
```

------------------------------------------------------------------------

# 2. 최종 시스템 목표

``` text
기업 검색
    ↓
OpenDART 재무데이터 수집
    ↓
Financial Data Parser
    ↓
Database
    ↓
Financial Analysis Engine
    ↓
DCF / WACC Engine
    ↓
Sensitivity Analysis
    ↓
공시자료 RAG
    ↓
AI Valuation Agent
    ↓
Valuation Dashboard
    ↓
Valuation Report
```

## 책임 분리 원칙

### Python

정확하고 재현 가능해야 하는 계산 담당.

``` text
재무비율
NOPAT
FCFF
WACC
Terminal Value
Enterprise Value
Equity Value
Sensitivity Analysis
```

### LLM

``` text
계산 결과 해석
재무 변화 설명
공시자료 검색 및 요약
위험요인 탐색
Tool orchestration
보고서 초안 작성
```

### RAG

``` text
사업보고서
공시자료
기업 설명
산업/사업 관련 문서
```

에서 근거를 검색하여 LLM에 제공한다.

### 중요

LLM에게 DCF/WACC 등 핵심 숫자를 임의로 계산시키지 않는다.

``` text
LLM
 ↓ Tool Call
Python Valuation Engine
 ↓
검증된 계산 결과
 ↓
LLM Interpretation
```

------------------------------------------------------------------------

# STEP 01 --- 재무제표 이해

## 목표

기업의 3대 재무제표를 읽고, 하나의 경제적 사건이 세 재무제표에 어떻게
연결되는지 설명할 수 있다.

최종적으로 다음 질문에 답할 수 있어야 한다.

-   회사가 무엇을 가지고 있는가?
-   그 돈은 어디서 조달했는가?
-   일정 기간 얼마나 벌었는가?
-   실제 현금은 얼마나 들어오고 나갔는가?
-   이익과 현금은 왜 다른가?
-   이 숫자들이 가치평가와 어떻게 연결되는가?

------------------------------------------------------------------------

## LESSON 01 --- 재무상태표

학습 내용:

-   재무상태표의 의미
-   시점 개념
-   자산 = 부채 + 자본
-   유동자산 / 비유동자산
-   현금
-   매출채권
-   재고자산
-   유형자산
-   무형자산
-   차입금
-   자본

핵심:

``` text
자산
= 회사가 보유한 경제적 자원

부채 + 자본
= 그 자산을 어떤 자금으로 조달했는가
```

예제:

``` text
총자산 100억
총부채 40억
총자본 60억
```

주의:

``` text
회계상 자본 60억
≠
기업의 경제적 가치 60억
```

장부가치와 가치평가 결과는 다를 수 있다.

### 가치평가 연결

``` text
매출채권 / 재고
→ 운전자본
→ FCFF

유형자산
→ CAPEX / 감가상각
→ FCFF

차입금
→ Cost of Debt / Net Debt
→ WACC / Equity Value
```

------------------------------------------------------------------------

## LESSON 02 --- 매출채권과 재고

외상매출:

``` text
매출 +100
현금 +0
매출채권 +100
```

핵심:

> 매출 발생과 현금 수취 시점은 다를 수 있다.

재고 증가:

``` text
현금을 사용하여 재고 확보
→ 아직 판매되지 않음
→ 현금이 영업에 묶여 있는 상태
```

향후 운전자본 학습의 기초로 연결한다.

------------------------------------------------------------------------

## LESSON 03 --- 손익계산서

학습:

``` text
매출
- 매출원가
= 매출총이익

- 판매비와관리비
= 영업이익

± 영업외손익
- 법인세
= 당기순이익
```

주요 개념:

-   매출 성장률
-   매출총이익
-   영업이익
-   영업이익률
-   당기순이익

예:

``` text
매출 1,000
매출원가 600
판관비 250

영업이익 = 150
영업이익률 = 15%
```

### 가치평가적 사고

``` text
매출 증가
≠
무조건 좋은 변화
```

매출은 증가했지만 영업이익률이 하락했다면:

-   원가율 상승?
-   인건비 증가?
-   판관비 증가?
-   일회성 비용?
-   미래에도 지속되는 비용?

을 확인한다.

핵심 사고방식:

``` text
무엇이 변했는가?
→ 왜 변했는가?
→ 일시적인가?
→ 지속 가능한가?
→ 미래 현금흐름에 어떤 영향을 주는가?
```

------------------------------------------------------------------------

## LESSON 04 --- 이익과 현금의 차이

핵심:

> **이익 ≠ 현금**

대표 사례:

### 매출채권

이익은 발생했지만 현금을 아직 받지 못할 수 있다.

### 감가상각

손익계산서에서는 비용이지만 해당 기간의 현금 유출은 아니다.

이를 통해 발생주의 회계와 현금흐름의 차이를 직관적으로 이해한다.

------------------------------------------------------------------------

## LESSON 05 --- 현금흐름표

세 가지 영역:

``` text
CFO
영업활동현금흐름

CFI
투자활동현금흐름

CFF
재무활동현금흐름
```

### CFO

기업의 본업에서 발생하는 현금흐름.

예:

``` text
당기순이익       100
+ 감가상각        20
- 매출채권 증가    30
- 재고 증가        10
-------------------
영업현금흐름       80
```

### CFI

투자 관련 현금흐름.

대표 항목:

-   설비 취득
-   공장 건설
-   유형자산 투자
-   일부 금융자산 투자 등

### CFF

자금 조달·상환 관련 현금흐름.

예:

-   차입
-   회사채
-   증자
-   차입금 상환
-   배당
-   자사주 취득

------------------------------------------------------------------------

## LESSON 06 --- CAPEX와 감가상각

### CAPEX

Capital Expenditure.

앞으로 여러 기간 동안 사용할 자산을 취득·확충하기 위한 투자성 지출.

예:

``` text
100억짜리 생산설비 구매
→ 현금 -100억
→ CAPEX 100억
```

### 감가상각

취득한 자산의 원가를 사용기간에 걸쳐 회계상 비용으로 배분.

예:

``` text
100억 설비
내용연수 10년
잔존가치 0
정액법 가정

매년 감가상각비 10억
```

핵심 비교:

  CAPEX              감가상각
  ------------------ -----------------------------------------
  실제 투자성 지출   회계상 비용 배분
  현금 유출 발생     해당 기간의 현금 유출 아님
  FCFF에서 차감      비현금비용이므로 FCFF 계산 시 가산 조정

------------------------------------------------------------------------

## LESSON 07 --- 세 재무제표 연결

외상판매 사례:

``` text
[손익계산서]
매출 증가

[재무상태표]
매출채권 증가

[현금흐름]
아직 현금 유입 없음
```

향후 현금 회수:

``` text
매출채권 감소
현금 증가
```

최종 연결:

``` text
손익계산서
→ 수익성

재무상태표
→ 자산 / 부채 / 운전자본 / Net Debt

현금흐름표
→ 실제 현금창출

모두 결합
→ 미래 FCFF 추정
→ DCF
```

------------------------------------------------------------------------

## STEP 01 Check Quiz

포함할 문제:

1.  외상매출 발생 시 증가하는 자산
2.  은행 차입 시 자산/부채 변화
3.  장부상 자본과 기업가치가 다른 이유
4.  영업이익 및 영업이익률 계산
5.  매출 증가 + 영업이익 감소 해석
6.  당기순이익과 현금 증가가 같지 않은 이유
7.  CAPEX와 감가상각 차이
8.  순이익 증가 + CFO 감소 + 매출채권 증가 해석
9.  동일 CFO에서 CAPEX가 다른 두 기업 비교

------------------------------------------------------------------------

## STEP 01 Practice Mission --- 실제 기업 재무제표 읽기

기본 분석 기업: 삼성전자\
단, 기업은 변경 가능하게 한다.

사업보고서의 연결재무제표에서 직접 찾는다.

``` text
기업:
기준연도:
단위:

[재무상태표]
자산총계:
부채총계:
자본총계:

[손익계산서]
매출액:
영업이익:
당기순이익:

[현금흐름표]
영업활동현금흐름:
투자활동현금흐름:
재무활동현금흐름:
```

분석 질문:

1.  자산은 부채와 자본 중 어느 쪽의 비중이 더 큰가?
2.  영업이익률은 얼마인가?
3.  순이익과 CFO 중 무엇이 더 큰가?
4.  두 숫자의 차이를 설명하려면 어떤 항목을 추가 확인해야 하는가?
5.  영업으로 창출한 현금과 투자 규모를 비교하면 어떤가?
6.  추가로 확인하고 싶은 항목은 무엇인가?

### Project Build

재무데이터 수동 입력 Form + 저장 기능.

------------------------------------------------------------------------

# STEP 02 --- 재무분석

## 목표

재무제표 숫자를 읽는 단계에서 벗어나 기업의 과거 실적과 재무상태를
해석하고 미래 추정을 위한 질문을 만들 수 있다.

------------------------------------------------------------------------

## LESSON 01 --- 재무분석의 목적

재무비율을 계산하는 것이 최종 목적이 아니다.

``` text
과거 숫자
→ 변화 확인
→ 원인 분석
→ 정상화
→ 미래 추정
→ Valuation Assumption
```

------------------------------------------------------------------------

## LESSON 02 --- 성장성 분석

학습:

-   매출 성장률
-   영업이익 성장률
-   순이익 성장률
-   CAGR 개념

질문:

-   매출이 지속적으로 성장하는가?
-   이익이 매출보다 빠르게 증가하는가?
-   특정 연도만 급등/급락했는가?

------------------------------------------------------------------------

## LESSON 03 --- 수익성 분석

학습:

-   매출총이익률
-   영업이익률
-   순이익률
-   ROA
-   ROE

단순 계산뿐 아니라 변화 원인을 분석한다.

예:

``` text
매출 ↑
영업이익률 ↓
```

가능한 원인을 탐색한다.

------------------------------------------------------------------------

## LESSON 04 --- 안정성 분석

학습:

-   부채비율
-   유동비율
-   차입금
-   현금
-   Net Debt 기초

기업이 재무적으로 어떤 구조로 자금을 조달하고 있는지 이해한다.

------------------------------------------------------------------------

## LESSON 05 --- 활동성·효율성 및 운전자본

학습:

-   매출채권
-   재고
-   매입채무
-   운전자본 개념
-   현금이 영업 과정에 묶이는 구조

여기서는 DCF에 필요한 순운전자본 변화의 직관을 만든다.

------------------------------------------------------------------------

## LESSON 06 --- 현금창출력 분석

학습:

``` text
순이익 vs CFO
CFO vs CAPEX
CAPEX 추이
```

회계상 이익이 실제 현금으로 전환되는지를 살펴본다.

------------------------------------------------------------------------

## LESSON 07 --- 일회성 항목과 정상화

가치평가에서는 과거 숫자를 그대로 미래로 복사하지 않는다.

확인:

-   일회성 비용
-   일회성 이익
-   자산 매각
-   대규모 충당금
-   비정상적인 특정 연도

목표:

> 지속 가능한 영업성과와 일회성 요인을 구분한다.

------------------------------------------------------------------------

## LESSON 08 --- 과거에서 미래로

``` text
Historical Analysis
        ↓
Normalisation
        ↓
Revenue Assumption
Margin Assumption
CAPEX Assumption
Working Capital Assumption
        ↓
Forecast
```

재무분석이 DCF의 가정으로 연결되는 과정을 이해한다.

------------------------------------------------------------------------

## STEP 02 Practice Mission --- 실제 기업 3개년 분석

최근 3개년:

-   매출
-   영업이익
-   당기순이익
-   영업이익률
-   ROE
-   부채비율
-   CFO
-   CAPEX

를 비교한다.

산출물:

> **기업 재무상태 5줄 요약**

그리고:

> **DCF를 위해 추가로 확인해야 할 질문 3개**

를 작성한다.

### Project Build

자동 계산:

``` text
revenue_growth()
operating_income_growth()
operating_margin()
net_margin()
roe()
roa()
debt_ratio()
current_ratio()
```

차트:

-   Revenue Trend
-   Operating Income Trend
-   Margin Trend
-   CFO / CAPEX Trend

------------------------------------------------------------------------

# STEP 03 --- DCF

## 목표

기업의 미래 현금흐름을 현재가치로 바꾸는 논리를 처음부터 이해하고 직접
DCF를 계산할 수 있다.

------------------------------------------------------------------------

## LESSON 01 --- 기업가치란 무엇인가?

장부가치, 시장가치, 경제적 가치의 차이를 이해한다.

핵심 질문:

> 기업은 왜 미래에 벌어들일 돈을 기준으로 평가할 수 있는가?

------------------------------------------------------------------------

## LESSON 02 --- 화폐의 시간가치

``` text
오늘의 100만원
≠
5년 뒤의 100만원
```

이유:

-   투자기회
-   위험
-   시간

미래 현금을 현재 기준으로 비교하려면 할인해야 한다.

------------------------------------------------------------------------

## LESSON 03 --- Present Value

현재가치 개념.

``` text
PV = 미래 현금흐름을 할인한 값
```

할인율이 높아질수록 현재가치는 낮아진다는 관계를 직관적으로 학습한다.

------------------------------------------------------------------------

## LESSON 04 --- FCF와 FCFF

기업이 사업을 유지하고 필요한 투자를 한 뒤 창출하는 현금의 개념.

FCFF는 자본 제공자 전체에게 귀속되는 현금흐름 관점으로 학습한다.

------------------------------------------------------------------------

## LESSON 05 --- NOPAT

``` text
NOPAT
= EBIT × (1 - Tax Rate)
```

왜 당기순이익이 아니라 영업활동 기반 이익에서 출발하는지 설명한다.

------------------------------------------------------------------------

## LESSON 06 --- 감가상각과 CAPEX 재등장

STEP 01의 개념을 DCF 공식 안에서 다시 연결한다.

``` text
감가상각
→ 영업이익에서는 비용
→ 현금유출 아님
→ FCFF에서 가산

CAPEX
→ 실제 투자 현금유출
→ FCFF에서 차감
```

------------------------------------------------------------------------

## LESSON 07 --- 순운전자본과 ΔNWC

매출채권, 재고, 매입채무를 연결한다.

직관:

``` text
매출채권 ↑ → 현금 묶임
재고 ↑ → 현금 묶임
매입채무 ↑ → 현금 지급 지연
```

따라서 운전자본 증가가 현금흐름에 미치는 영향을 학습한다.

------------------------------------------------------------------------

## LESSON 08 --- FCFF 공식 완성

``` text
FCFF
= NOPAT
+ Depreciation & Amortization
- CAPEX
- ΔNWC
```

각 항목을 왜 더하고 빼는지 말로 설명할 수 있어야 한다.

------------------------------------------------------------------------

## LESSON 09 --- 미래 FCFF Forecast

과거 재무분석을 이용하여:

-   매출 성장률
-   영업이익률
-   세율
-   감가상각
-   CAPEX
-   운전자본

가정을 설정한다.

가정은 임의의 숫자가 아니라 근거가 필요하다는 점을 강조한다.

------------------------------------------------------------------------

## LESSON 10 --- Terminal Value

명시적 Forecast 기간 이후의 가치를 처리하는 이유.

영구성장모형의 개념을 학습한다.

``` text
Terminal Value
= FCFF(n+1) / (WACC - g)
```

공식 암기보다 WACC와 g 변화가 TV에 미치는 영향을 이해한다.

------------------------------------------------------------------------

## LESSON 11 --- DCF 구조 완성

``` text
Forecast FCFF
     ↓
각 연도 현재가치
     +
Terminal Value 현재가치
     ↓
Enterprise Value
```

------------------------------------------------------------------------

## STEP 03 Practice Mission --- 가상기업 DCF 손계산

제공 데이터:

-   Revenue
-   Revenue Growth
-   Operating Margin
-   Tax Rate
-   D&A
-   CAPEX
-   ΔNWC
-   Discount Rate
-   Terminal Growth

수행:

1.  EBIT
2.  NOPAT
3.  FCFF
4.  Forecast
5.  Terminal Value
6.  Discounted FCFF
7.  Enterprise Value

### Project Build

초기 DCF 계산 모듈 구현.

------------------------------------------------------------------------

# STEP 04 --- WACC & 기업가치평가

## 목표

DCF의 할인율을 이해하고 Enterprise Value에서 Equity Value까지 연결하며,
상대가치평가와 민감도 분석까지 수행한다.

------------------------------------------------------------------------

## LESSON 01 --- Enterprise Value vs Equity Value

``` text
Enterprise Value
→ 기업의 영업자산 전체 가치

Equity Value
→ 주주에게 귀속되는 가치
```

단순화된 연결:

``` text
Equity Value
= Enterprise Value
- Net Debt
```

필요 시 기타 조정항목이 존재할 수 있음을 명시한다.

------------------------------------------------------------------------

## LESSON 02 --- 자본구조

기업의 자금 조달:

``` text
Debt
+
Equity
```

채권자와 주주가 요구하는 수익률이 다르다는 것을 이해한다.

------------------------------------------------------------------------

## LESSON 03 --- Cost of Debt

기업이 부채를 사용하는 비용.

-   차입금 금리
-   채권 수익률
-   세금효과

를 학습한다.

------------------------------------------------------------------------

## LESSON 04 --- Cost of Equity와 CAPM

``` text
Cost of Equity
= Risk-free Rate
+ Beta × Market Risk Premium
```

학습:

-   Risk-free Rate
-   Beta
-   Market Risk Premium
-   위험이 요구수익률과 연결되는 이유

------------------------------------------------------------------------

## LESSON 05 --- WACC

``` text
WACC
= 자본구조를 반영한 가중평균 자본비용
```

Debt와 Equity의 비용을 비중에 따라 결합한다.

왜 FCFF를 WACC로 할인하는지 이해한다.

------------------------------------------------------------------------

## LESSON 06 --- Net Debt

기초:

``` text
Net Debt
≈ Interest-bearing Debt - Cash
```

실제 가치평가에서는 현금성자산과 부채 범위 등에 판단이 필요할 수 있음을
표시한다.

------------------------------------------------------------------------

## LESSON 07 --- DCF 완성

``` text
FCFF Forecast
→ WACC 할인
→ Enterprise Value
→ Net Debt 조정
→ Equity Value
```

------------------------------------------------------------------------

## LESSON 08 --- 상대가치평가

학습:

-   PER
-   PBR
-   EV/EBITDA
-   Comparable Companies
-   Trading Multiple

DCF와 상대가치평가의 접근 방식 차이를 이해한다.

------------------------------------------------------------------------

## LESSON 09 --- 민감도 분석

가치평가는 하나의 정답이 아니라 가정에 따라 달라진다.

예:

``` text
WACC
8% / 9% / 10%

Terminal Growth
1% / 2% / 3%
```

조합별 Enterprise Value / Equity Value를 계산한다.

------------------------------------------------------------------------

## LESSON 10 --- 가치평가 결과 해석

질문:

-   어떤 가정이 결과에 가장 큰 영향을 주는가?
-   WACC가 상승하면 왜 가치가 하락하는가?
-   Terminal Growth가 상승하면 왜 가치가 상승하는가?
-   지나치게 낙관적인 가정은 없는가?

------------------------------------------------------------------------

## STEP 04 Practice Mission --- 실제 기업 Valuation

실제 기업 한 곳을 대상으로:

1.  Forecast Assumption 작성
2.  WACC 산정
3.  DCF
4.  EV
5.  Net Debt
6.  Equity Value
7.  Sensitivity Matrix
8.  가능하면 Multiples 비교

를 수행한다.

### Project Build

Valuation Dashboard:

``` text
Enterprise Value
Equity Value
WACC
Terminal Growth
FCFF Forecast
Sensitivity Matrix
```

------------------------------------------------------------------------

# STEP 05 --- Python Valuation Automation

## 목표

STEP 02\~04에서 직접 수행한 계산을 재현 가능하고 검증 가능한 Python
코드로 전환한다.

------------------------------------------------------------------------

## LESSON 01 --- 재무모델을 코드로 바꾸는 방법

수식 하나를 거대한 함수로 만들지 않는다.

``` text
Input
→ Transformation
→ Calculation
→ Output
```

으로 분리한다.

------------------------------------------------------------------------

## LESSON 02 --- 데이터 구조 설계

예:

``` text
Company
FinancialStatement
ValuationAssumption
ValuationResult
```

연도별 데이터를 일관된 구조로 관리한다.

------------------------------------------------------------------------

## LESSON 03 --- Financial Analysis Functions

구현:

``` python
revenue_growth()
operating_margin()
net_margin()
roe()
roa()
debt_ratio()
```

------------------------------------------------------------------------

## LESSON 04 --- FCFF Engine

구현:

``` python
calculate_nopat()
calculate_fcff()
```

각 입력값과 출력값이 명확해야 한다.

------------------------------------------------------------------------

## LESSON 05 --- WACC Engine

구현:

``` python
calculate_cost_of_equity()
calculate_after_tax_cost_of_debt()
calculate_wacc()
```

------------------------------------------------------------------------

## LESSON 06 --- DCF Engine

구현:

``` python
forecast_fcff()
calculate_terminal_value()
discount_cash_flow()
calculate_enterprise_value()
calculate_equity_value()
```

------------------------------------------------------------------------

## LESSON 07 --- Sensitivity Engine

WACC × Terminal Growth 조합을 자동 계산한다.

------------------------------------------------------------------------

## LESSON 08 --- Validation

중요:

> 자동화했다고 계산이 맞는 것은 아니다.

검증:

``` text
손계산
vs
Excel
vs
Python
```

차이가 발생하면:

-   단위
-   부호
-   세율
-   연도
-   할인 시점
-   Terminal Value
-   Net Debt

등을 확인한다.

------------------------------------------------------------------------

## LESSON 09 --- 예외처리와 재현가능성

-   결측값
-   0으로 나누기
-   WACC ≤ g
-   음수 값
-   잘못된 단위
-   비정상 입력

처리.

### STEP 05 Practice Mission

STEP 04 실제 기업의 수기 계산과 Python 결과를 비교하고 검증 Report를
작성한다.

### Project Build

``` text
valuation/
├── financial_analysis.py
├── fcff.py
├── wacc.py
├── dcf.py
├── sensitivity.py
└── validation.py
```

------------------------------------------------------------------------

# STEP 06 --- 재무데이터 수집 자동화

## 목표

STEP 01에서 사람이 사업보고서를 열고 직접 입력했던 작업을 자동화한다.

------------------------------------------------------------------------

## LESSON 01 --- 공시 데이터 이해

-   DART
-   사업보고서
-   재무제표
-   연결재무제표
-   별도재무제표
-   계정과목
-   보고기간

------------------------------------------------------------------------

## LESSON 02 --- OpenDART API

학습:

-   API 요청/응답
-   기업 고유번호
-   보고서 코드
-   재무제표 조회
-   JSON 데이터

------------------------------------------------------------------------

## LESSON 03 --- 기업 검색과 corp_code

기업명만으로 필요한 데이터를 조회할 수 있도록 기업 검색 Flow를 만든다.

------------------------------------------------------------------------

## LESSON 04 --- 계정과목 Mapping

기업/보고서에 따라 계정명이 다를 수 있는 문제를 이해한다.

내부 표준 Schema로 변환한다.

예:

``` text
revenue
operating_income
net_income
assets
liabilities
equity
operating_cash_flow
capex
```

------------------------------------------------------------------------

## LESSON 05 --- 데이터 정제

-   숫자 변환
-   단위
-   결측값
-   중복
-   연도
-   연결/별도 구분

------------------------------------------------------------------------

## LESSON 06 --- DB 설계

PostgreSQL 기준 예:

``` text
companies
financial_statements
financial_items
valuation_assumptions
valuation_results
```

------------------------------------------------------------------------

## LESSON 07 --- SQL 활용

필요한 연도와 기업의 데이터를 조회하고 3개년 추세를 만드는 Query를
작성한다.

------------------------------------------------------------------------

## LESSON 08 --- Data Pipeline

``` text
Company Search
→ OpenDART
→ Parser
→ Normalizer
→ Database
→ Financial Analysis Engine
→ Valuation Engine
```

### STEP 06 Practice Mission

STEP 01에서 직접 입력했던 동일 기업/연도의 숫자를 API로 수집한다.

비교:

``` text
Manual Data
vs
OpenDART Data
```

불일치가 있으면 원인을 분석한다.

### Project Build

기업 선택 → 재무데이터 자동수집 → DB 저장 → 분석 자동실행.

------------------------------------------------------------------------

# STEP 07 --- AI Valuation Agent

## 목표

정확한 계산을 수행하는 Python Engine과 기업 문서를 검색하는 RAG를 LLM
Agent가 적절히 사용할 수 있도록 만든다.

------------------------------------------------------------------------

## LESSON 01 --- LLM을 어디에 써야 하는가?

잘하는 것:

-   자연어 이해
-   설명
-   요약
-   정보 연결
-   Tool 선택
-   보고서 작성

맡기면 위험한 것:

-   중요한 재무계산을 근거 없이 직접 수행
-   출처 없는 수치 생성
-   공시자료에 없는 사실 추정

------------------------------------------------------------------------

## LESSON 02 --- Tool Calling

Agent가 필요한 기능을 직접 호출하도록 한다.

예:

``` text
get_financial_statement()
calculate_financial_ratios()
calculate_fcff()
calculate_wacc()
calculate_dcf()
run_sensitivity_analysis()
```

------------------------------------------------------------------------

## LESSON 03 --- Agent

사용자 질문을 보고:

``` text
질문 이해
→ 필요한 데이터 판단
→ Tool 선택
→ 계산
→ 결과 확인
→ 설명
```

하는 흐름을 구현한다.

------------------------------------------------------------------------

## LESSON 04 --- RAG 기초

``` text
Document
→ Chunk
→ Embedding
→ Vector DB
→ Retrieval
→ Context
→ LLM
```

RAG와 일반 API 호출의 차이를 이해한다.

------------------------------------------------------------------------

## LESSON 05 --- 사업보고서 RAG

대상:

-   사업의 내용
-   위험요인
-   주요 계약
-   투자
-   연구개발
-   산업 관련 설명

등 가치평가 가정을 해석하는 데 필요한 비정형 정보를 검색한다.

------------------------------------------------------------------------

## LESSON 06 --- Chunking / Retrieval

학습:

-   Chunk Size
-   Overlap
-   Metadata
-   Semantic Search
-   Top-k
-   Retrieval Quality

단순히 Vector DB를 붙이는 것보다 검색 품질을 평가하는 것이 중요하다.

------------------------------------------------------------------------

## LESSON 07 --- Grounded Answer

AI 답변에 가능한 경우:

``` text
사용한 재무 데이터
사용한 계산 결과
검색한 공시 근거
```

가 드러나도록 한다.

------------------------------------------------------------------------

## LESSON 08 --- Hallucination과 계산 오류 방지

원칙:

``` text
Calculation
→ Python

Document Fact
→ RAG / Source

Interpretation
→ LLM
```

근거가 없으면 모른다고 처리하는 정책도 설계한다.

------------------------------------------------------------------------

## LESSON 09 --- Agent Evaluation

평가 예:

-   Tool 선택 정확도
-   계산 결과 전달 정확도
-   Retrieval relevance
-   Groundedness
-   답변 일관성

------------------------------------------------------------------------

## LESSON 10 --- MCP

MCP의 역할을 학습하고 프로젝트에 실제 필요성이 있을 때 외부 데이터/도구
연결 계층으로 확장한다.

MCP 자체를 사용하기 위해 억지로 도입하지 않는다.

------------------------------------------------------------------------

## STEP 07 Practice Mission

다음 질문을 Agent에게 수행시킨다.

``` text
"최근 3년간 이 기업의 수익성 변화를 분석해줘."

"DCF 결과가 WACC 변화에 얼마나 민감한지 설명해줘."

"사업보고서에서 향후 현금흐름에 영향을 줄 수 있는 위험요인을 찾아줘."

"해당 위험요인이 어떤 DCF 가정과 연결될 수 있는지 설명해줘."
```

각 답변에서:

-   Tool Call 여부
-   계산 정확성
-   근거 문서
-   출처 없는 주장 여부

를 검증한다.

### Project Build

``` text
User
 ↓
Valuation Agent
 ├── Financial Data Tool
 ├── Financial Analysis Tool
 ├── WACC Tool
 ├── DCF Tool
 ├── Sensitivity Tool
 └── Disclosure RAG
```

------------------------------------------------------------------------

# STEP 08 --- Final Product

## 목표

지금까지 만든 학습 결과와 자동화 기능을 실제 가치평가 업무지원 Web
Application으로 통합한다.

------------------------------------------------------------------------

## LESSON 01 --- 전체 Valuation Workflow 재설계

수작업 Workflow:

``` text
사업보고서 탐색
→ 재무정보 복사
→ 데이터 정리
→ 재무비율 계산
→ Forecast
→ WACC
→ DCF
→ Sensitivity
→ 자료 검색
→ 분석
→ Report
```

자동화 Workflow:

``` text
기업 선택
→ 데이터 자동수집
→ 재무분석
→ Valuation
→ 공시검색
→ AI Interpretation
→ Report
```

Before / After가 명확히 보여야 한다.

------------------------------------------------------------------------

## LESSON 02 --- 사용자 Flow

``` text
Company Search
→ Company Overview
→ Financial Dashboard
→ Historical Analysis
→ Assumption Setting
→ WACC
→ DCF
→ Sensitivity
→ AI Analysis
→ Source Evidence
→ Report
```

------------------------------------------------------------------------

## LESSON 03 --- Valuation Dashboard

표시:

-   Revenue
-   Operating Income
-   Operating Margin
-   CFO
-   CAPEX
-   FCFF
-   WACC
-   Enterprise Value
-   Equity Value

------------------------------------------------------------------------

## LESSON 04 --- Assumption UI

사용자가:

-   Revenue Growth
-   Margin
-   Tax Rate
-   CAPEX
-   NWC
-   WACC
-   Terminal Growth

등의 가정을 확인/수정할 수 있게 한다.

AI가 제안하더라도 최종 가정은 사용자가 확인할 수 있도록 한다.

------------------------------------------------------------------------

## LESSON 05 --- AI Analysis UI

단순 Chatbot이 아니라 분석 화면과 연결한다.

예:

> "왜 2025년 영업이익률이 하락했어?"

Agent가 현재 기업 데이터 + 공시자료를 사용하여 답한다.

------------------------------------------------------------------------

## LESSON 06 --- Report Generation

Report 구조:

1.  Executive Summary
2.  Company Overview
3.  Historical Financial Analysis
4.  Forecast Assumptions
5.  FCFF Forecast
6.  WACC
7.  DCF Valuation
8.  Sensitivity Analysis
9.  Comparable Valuation
10. Risk Factors
11. AI-assisted Interpretation
12. Sources / Assumptions

PDF export는 선택적으로 구현한다.

------------------------------------------------------------------------

## LESSON 07 --- 검증

최종 시스템 검증:

-   데이터가 원문과 일치하는가?
-   계산 결과가 수기 모델과 일치하는가?
-   Agent가 임의 숫자를 만들지 않는가?
-   RAG 근거가 실제 질문과 관련 있는가?
-   같은 입력에서 계산이 재현되는가?

------------------------------------------------------------------------

## LESSON 08 --- 배포 및 운영

핵심 기능 완료 후 선택적으로:

``` text
Docker
Cloud
Kubernetes
CI/CD
Logging
Monitoring
```

을 적용한다.

인프라 자체가 프로젝트 목적이 되지 않도록 한다.

------------------------------------------------------------------------

## STEP 08 Practice Mission --- End-to-End Valuation Case Study

실제 기업 하나를 선택한다.

처음부터 끝까지 수행:

``` text
기업 선택
→ 재무데이터
→ Historical Analysis
→ Forecast
→ WACC
→ DCF
→ Sensitivity
→ 공시 RAG
→ Risk Analysis
→ AI Interpretation
→ Final Report
```

최종 산출물:

**Valuation Case Study**

### Project Build

최종 Web Application + Portfolio Report.

------------------------------------------------------------------------

# 3. Roadmap UI 요구사항

``` text
STEP 01  Financial Statements       COMPLETE
STEP 02  Financial Analysis         NEXT
STEP 03  DCF                        LOCKED
STEP 04  WACC & Valuation           LOCKED
STEP 05  Python Automation          LOCKED
STEP 06  Data Automation            LOCKED
STEP 07  AI Valuation Agent         LOCKED
STEP 08  Final Product              LOCKED
```

상태:

``` text
NOT STARTED
IN PROGRESS
COMPLETE
```

단, 실제 기능상 강제 잠금 여부는 UX를 고려해 결정한다.

------------------------------------------------------------------------

# 4. Progress Tracking

각 STEP별 Checklist.

예:

``` text
STEP 01

[x] 재무상태표
[x] 손익계산서
[x] 현금흐름표
[x] CAPEX / 감가상각
[x] Check Quiz
[ ] 실제 기업 Practice
[ ] STEP 01 Reflection
```

전체 Progress도 표시.

------------------------------------------------------------------------

# 5. 학습 기록 기능

각 Lesson마다 사용자가 직접 기록할 수 있는 공간:

``` text
내가 이해한 내용
헷갈리는 내용
중요 공식
실무 연결
면접에서 설명한다면?
```

특히 `면접에서 설명한다면?` 영역은 취업 포트폴리오 목적상 유지한다.

------------------------------------------------------------------------

# 6. Practice 결과 저장

각 STEP의 Practice 결과를 저장한다.

최종 Project Report에서 자동으로 모아 보여줄 수 있는 구조를 고려한다.

``` text
STEP 01
Financial Statement Reading

STEP 02
3-Year Financial Analysis

STEP 03
Manual DCF

STEP 04
Valuation & Sensitivity

STEP 05
Python Validation

STEP 06
DART Pipeline Validation

STEP 07
Agent Evaluation

STEP 08
Final Case Study
```

------------------------------------------------------------------------

# 7. Project Report

이 페이지는 취업 포트폴리오 관점에서 특히 중요하다.

단순히 사용 기술을 나열하지 않는다.

다음 흐름을 보여준다.

``` text
Problem
↓
Manual Workflow
↓
Observed Inefficiency
↓
Automation Idea
↓
Implementation
↓
Validation
↓
Result
```

최종 메시지:

> 가치평가 업무를 먼저 직접 학습·수행한 뒤, 반복적인 데이터
> 수집·계산·분석 과정을 단계적으로 자동화하고 AI Agent를 결합하여
> 업무지원 시스템으로 발전시켰다.

------------------------------------------------------------------------

# 8. UI / Design

목표:

-   Professional
-   Financial
-   Minimal
-   Data-driven
-   Modern
-   Accounting / Consulting / Finance 느낌

지양:

-   과한 귀여움
-   과도한 Gradient
-   과도한 Glassmorphism
-   Emoji 남용
-   AI 서비스에서 흔한 보라색 Gradient 중심 디자인

권장:

-   밝은 Background
-   Black / Dark Gray Typography
-   넓은 여백
-   명확한 Hierarchy
-   숫자와 Table의 높은 가독성

사용 Component:

``` text
KPI Card
Financial Table
Line Chart
Bar Chart
Assumption Panel
Sensitivity Matrix
Source Evidence Card
Progress Stepper
Lesson Navigation
Quiz Card
Practice Workspace
```

------------------------------------------------------------------------

# 9. Home 화면

Hero 메시지는 단순히:

> AI 기업가치평가 플랫폼

이라고 하지 않는다.

프로젝트의 과정이 보이게 한다.

예:

> **Learn Valuation. Automate the Workflow.**

Subcopy 예:

> 재무제표를 직접 읽는 것부터 DCF, WACC, 데이터 자동화, AI Agent까지.\
> 가치평가 업무를 이해하고 단계적으로 자동화하는 프로젝트.

Home에서 보여줄 것:

``` text
Current Step
Overall Progress
Latest Practice
Project Evolution
Final System Architecture
```

------------------------------------------------------------------------

# 10. Project Evolution UI

이 프로젝트의 차별점이므로 별도 시각화한다.

``` text
STEP 01
Manual Financial Statement Reading
        ↓
STEP 02
Manual Financial Analysis
        ↓
STEP 03
Manual DCF
        ↓
STEP 04
Manual Valuation
        ↓
STEP 05
Python Calculation Automation
        ↓
STEP 06
Financial Data Automation
        ↓
STEP 07
AI-assisted Analysis
        ↓
STEP 08
End-to-End Valuation Platform
```

각 STEP에서:

``` text
What I did manually
What problem I found
What I automated
```

를 보여줄 수 있도록 데이터 구조를 설계한다.

------------------------------------------------------------------------

# 11. 개발 우선순위

한 번에 최종 시스템을 만들지 않는다.

## Phase 1

학습 사이트부터 구현.

``` text
Home
Roadmap
STEP Layout
Lesson
Quiz
Practice
Progress
Notes
```

## Phase 2

STEP 01\~04 학습과 수동 Practice 지원.

## Phase 3

Python Valuation Engine.

## Phase 4

OpenDART + DB.

## Phase 5

Agent + RAG.

## Phase 6

Final Dashboard / Report / Deployment.

------------------------------------------------------------------------

# 12. 현재 진행 상태

현재 학습은:

``` text
STEP 01 — Financial Statements

재무상태표       COMPLETE
손익계산서       COMPLETE
현금흐름표       COMPLETE
CAPEX/감가상각   COMPLETE
Check Quiz       COMPLETE
Practice Mission NEXT
```

따라서 사이트 초기 구현 시 **STEP 01을 IN PROGRESS** 상태로 표시한다.

다음 실제 학습 작업:

> 실제 기업의 연결재무제표에서 주요 9개 항목을 직접 찾아 분석한다.

------------------------------------------------------------------------

# 13. 절대 놓치지 말아야 할 설계 원칙

1.  이 사이트는 강의자료 모음이 아니라 **학습 + 실습 + 개발 과정**이다.
2.  각 STEP에는 반드시 실제 학습 내용이 존재해야 한다.
3.  모든 이론은 가치평가 Workflow와 연결한다.
4.  Quiz는 단순 암기보다 숫자 해석과 이유 설명을 포함한다.
5.  Practice는 실제 기업 또는 현실적인 가상 기업 데이터로 진행한다.
6.  각 Practice 결과가 다음 STEP의 입력으로 이어지도록 한다.
7.  앞에서 수작업한 것을 뒤에서 자동화하는 구조를 유지한다.
8.  LLM과 deterministic calculation의 책임을 분리한다.
9.  자동화 결과는 반드시 수기 결과 또는 원문 데이터와 검증한다.
10. 최종적으로는 "무엇을 만들었는가"뿐 아니라 **왜 그렇게
    자동화했는가**가 보여야 한다.

------------------------------------------------------------------------

# 14. 최종 학습 흐름 한 장 요약

``` text
STEP 01
재무제표를 읽는다
│
│ Practice: 실제 기업 재무제표
▼

STEP 02
기업의 재무상태와 성과를 분석한다
│
│ Practice: 3개년 재무분석
▼

STEP 03
미래 FCFF를 추정하고 DCF를 이해한다
│
│ Practice: DCF 손계산
▼

STEP 04
WACC를 산정하고 기업가치를 계산한다
│
│ Practice: 실제 기업 Valuation
▼

STEP 05
계산 과정을 Python으로 자동화한다
│
│ Practice: 수기 vs Python 검증
▼

STEP 06
OpenDART로 데이터 수집까지 자동화한다
│
│ Practice: 수동 입력 vs API 검증
▼

STEP 07
Agent + Tool Calling + RAG를 연결한다
│
│ Practice: AI 분석 정확성/근거 검증
▼

STEP 08
End-to-End 서비스로 통합한다
│
│ Practice: 실제 기업 Case Study
▼

AI 기반 기업가치평가 업무지원 플랫폼
```

------------------------------------------------------------------------

# 15. Claude Code 구현 요청

위 구조를 기준으로 먼저 전체 프로젝트의 정보 구조와 재사용 가능한
STEP/Lesson 데이터 모델을 설계한다.

중요:

-   STEP별 내용을 컴포넌트에 하드코딩하지 말고 확장 가능한 데이터 구조로
    관리한다.
-   학습 콘텐츠, Quiz, Practice, Progress 상태를 분리한다.
-   추후 STEP별 콘텐츠가 추가되어도 UI 구조를 변경할 필요가 없도록 한다.
-   STEP 01부터 실제 사용할 수 있는 수준으로 구현하고, 나머지 STEP도 위
    명세의 Lesson 구조와 Practice Mission이 모두 보이도록 구성한다.
-   아직 구현되지 않은 자동화 기능은 가짜 결과를 생성하지 않는다.
-   미구현 기능은 명확하게 `Coming in STEP XX` 또는 개발 예정 상태로
    표시한다.
-   재무 계산 로직과 LLM 로직은 향후 분리 가능한 Architecture를 전제로
    설계한다.

이 프로젝트의 최우선 목표는 예쁜 데모가 아니라:

> **가치평가를 이해하고 → 직접 수행하고 → 검증하면서 → 업무를 단계적으로
> 자동화해 나가는 과정 자체를 보여주는 것**

이다.

---

# 16. 서비스명 / Branding

## ValuFlow

*From Financial Statements to AI-powered Valuation.*

### Naming Concept

**ValuFlow = Valuation + Flow**

재무제표를 이해하는 단계에서 시작해 기업가치평가와 AI 기반 업무 자동화까지 이어지는 전체 흐름을 의미한다.

```text
Financial Statements
        ↓
Financial Analysis
        ↓
DCF
        ↓
WACC & Valuation
        ↓
Python Automation
        ↓
Financial Data Automation
        ↓
AI Valuation Agent
        ↓
AI-powered Valuation
```

사이트와 최종 서비스 전반에서 공식 명칭은 **ValuFlow**를 사용한다.

### Brand Message

> **ValuFlow**  
> *From Financial Statements to AI-powered Valuation.*

이 문구를 Home Hero, 프로젝트 소개, README 및 포트폴리오의 대표 브랜딩 문구로 활용한다.

