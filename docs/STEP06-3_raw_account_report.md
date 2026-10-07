# STEP 06-3 Raw 계정 조사 보고 (삼성전자, OpenDART 실제 응답)

```text
# Raw 계정 조사 — corpCode 00126380, 요청 연도 [2023, 2024, 2025], 조회 2026-10-07T05:21:52.752264+00:00
basisUsed=Consolidated fallback=False yearsReceived=[2023, 2024, 2025] missing=[] rawAccountCount=372
행 수(원본 구분): {'BS': 156, 'IS': 51, 'CIS': 39, 'CF': 126}

## Revenue candidates
- [IS] 기타수익  (id=dart_OtherGains)  2023:1180448000000, 2024:1960338000000, 2025:2267083000000
- [IS] 매출원가  (id=ifrs-full_CostOfSales)  2023:180388580000000, 2024:186562268000000, 2025:202235513000000
- [IS] 금융수익  (id=ifrs-full_FinanceIncome)  2023:16100148000000, 2024:16703304000000, 2025:16240302000000
- [IS] 매출총이익  (id=ifrs-full_GrossProfit)  2023:78546914000000, 2024:114308635000000, 2025:131370425000000
- [IS] 법인세비용(수익)  (id=ifrs-full_IncomeTaxExpenseContinuingOperations)  2023:-4480835000000, 2024:3078383000000, 2025:4274666000000
- [IS] 매출액  (id=ifrs-full_Revenue)  2023:258935494000000, 2024:300870903000000, 2025:333605938000000

## COGS candidates
- [IS] 매출원가  (id=ifrs-full_CostOfSales)  2023:180388580000000, 2024:186562268000000, 2025:202235513000000

## Operating Profit candidates
- [IS] 영업이익  (id=dart_OperatingIncomeLoss)  2023:6566976000000, 2024:32725961000000, 2025:43601051000000

## Net Income candidates
- [IS] 당기순이익  (id=ifrs-full_ProfitLoss)  2023:15487100000000, 2024:34451351000000, 2025:45206805000000
- [IS] 법인세비용차감전순이익  (id=ifrs-full_ProfitLossBeforeTax)  2023:11006265000000, 2024:37529734000000, 2025:49481471000000
- [CIS] 당기순이익  (id=ifrs-full_ProfitLoss)  2023:15487100000000, 2024:34451351000000, 2025:45206805000000

## Accounts Receivable candidates
- [BS] 매출채권  (id=ifrs-full_CurrentTradeReceivables)  2023:36647393000000, 2024:43623073000000, 2025:51127642000000

## Inventory candidates
- [BS] 재고자산  (id=ifrs-full_Inventories)  2023:51625874000000, 2024:51754865000000, 2025:52636828000000

## Accounts Payable candidates
- [BS] 매입채무  (id=ifrs-full_TradeAndOtherCurrentPayablesToTradeSuppliers)  2023:11319824000000, 2024:12370177000000, 2025:13039380000000

## Cash candidates
- [BS] 현금및현금성자산  (id=ifrs-full_CashAndCashEquivalents)  2023:69080893000000, 2024:53705579000000, 2025:57856378000000

## Interest-bearing Debt candidates
- [BS] 단기차입금  (id=-표준계정코드 미사용-)  2023:7114601000000, 2024:13172504000000, 2025:17574980000000
- [BS] 유동성장기부채  (id=ifrs-full_CurrentPortionOfLongtermBorrowings)  2023:1308875000000, 2024:2207290000000, 2025:1177508000000
- [BS] 사채  (id=ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued)  2023:537618000000, 2024:14530000000, 2025:7134000000
- [BS] 장기차입금  (id=ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived)  2023:3724850000000, 2024:3935860000000, 2025:6479517000000

## CFO candidates
- [CF] 영업활동현금흐름  (id=ifrs-full_CashFlowsFromUsedInOperatingActivities)  2023:44137427000000, 2024:72982621000000, 2025:85315148000000
- [CF] 영업활동으로 인한 자산부채의 변동  (id=dart_AdjustmentsForAssetsLiabilitiesOfOperatingActivities)  2023:-5458745000000, 2024:-1567557000000, 2025:-9613906000000

## PPE Acquisition candidates
- [CF] 유형자산의 처분  (id=ifrs-full_ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities)  2023:98341000000, 2024:156191000000, 2025:149828000000
- [CF] 유형자산의 취득  (id=ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities)  2023:57611292000000, 2024:51406355000000, 2025:47522179000000

## Intangible Acquisition candidates
- [CF] 무형자산의 처분  (id=ifrs-full_ProceedsFromSalesOfIntangibleAssetsClassifiedAsInvestingActivities)  2023:11744000000, 2024:15869000000, 2025:13554000000
- [CF] 무형자산의 취득  (id=ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities)  2023:2922875000000, 2024:2335284000000, 2025:4630970000000

## D&A candidates
- [CF] 단기상각후원가금융자산의 순감소(증가)  (id=-표준계정코드 미사용-)  2023:-195616000000, 2024:620858000000, 2025:0

```
