// 앱이 사용하는 기본 저장소. 화면은 구현체가 아니라 FinancialRepository interface 만 안다.
import { BackendDartClient } from '../dart/client.ts';
import { DartFinancialRepository } from './dartRepository.ts';
import type { FinancialRepository } from './financialRepository.ts';

export const defaultFinancialRepository: FinancialRepository = new DartFinancialRepository(new BackendDartClient());
