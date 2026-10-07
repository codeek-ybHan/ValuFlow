// 앱이 사용하는 기본 저장소. 화면은 구현체가 아니라 FinancialRepository interface 만 안다.
import { BackendDartClient } from '../dart/client.ts';
import { DatabaseFinancialRepository } from './databaseRepository.ts';
import type { FinancialRepository } from './financialRepository.ts';

// Database 우선 → 없거나 refresh 면 OpenDART → backend 가 정규화 · 저장. 화면은 OpenDART 도 DB 도 직접 알지 못한다.
export const defaultFinancialRepository: FinancialRepository = new DatabaseFinancialRepository(new BackendDartClient());
