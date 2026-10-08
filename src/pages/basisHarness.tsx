// 테스트 전용: 재무제표 기준(연결/개별) 선택 컨트롤을 서버 렌더링한다.
import { renderToStaticMarkup } from 'react-dom/server';
import { BasisChoiceControl } from '../components/HistoricalSource';
import type { BasisChoice } from '../data/types';

export function renderBasis(value: BasisChoice, loadedBasis: 'Consolidated' | 'Separate' | null, disabled = false): string {
  return renderToStaticMarkup(<BasisChoiceControl value={value} onChange={() => undefined} disabled={disabled} loadedBasis={loadedBasis} />);
}
