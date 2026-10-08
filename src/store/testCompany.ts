// 테스트 전용: 선택된 기업. 기업을 선택하기 전에는 어떤 Project 데이터도 복원하지 않으므로, reload 류 테스트는 기업이 선택된 상태에서 시작한다.
import type { SelectedCompany } from '../data/types.ts';
import { withSelectedCompany, type ProjectState } from './projectModel.ts';

export const TEST_COMPANY: SelectedCompany = { corpCode: '00126380', corpName: '삼성전자', corpNameEng: 'SAMSUNG ELECTRONICS CO.,LTD', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: '2026-10-08T00:00:00Z' };
export const withTestCompany = (s: ProjectState): ProjectState => withSelectedCompany(s, TEST_COMPANY);
