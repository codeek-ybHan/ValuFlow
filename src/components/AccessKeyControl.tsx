import { useState } from 'react';
import { getAccessKey, setAccessKey } from '../data/access.ts';

/** Demo access key 입력: 비용이 드는 기능(AI · 업로드 · Report PDF · 저장)을 서버가 열어 주는 값. 이 탭(sessionStorage)에만 둔다. */
export function AccessKeyControl() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(() => getAccessKey() !== '');
  const save = () => { setAccessKey(value); setSaved(value.trim() !== ''); setValue(''); setOpen(false); };
  return (
    <div className="access-key">
      <button type="button" className={`btn small${saved ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} title="비용이 드는 기능을 쓰기 위한 데모 접근 키">
        Access key{saved ? ' · 설정됨' : ''}
      </button>
      {open ? (
        <form className="access-pop ai-card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="small" htmlFor="access-key-input">Demo access key</label>
          <input id="access-key-input" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={saved ? '새 키로 바꾸려면 입력' : '운영자에게 받은 키'} />
          <p className="small muted">AI 분석 · PDF 업로드 · Report PDF · 저장에 필요합니다. 이 브라우저 탭에만 저장되며 탭을 닫으면 지워집니다.</p>
          <div className="row">
            <button type="submit" className="btn small primary">저장</button>
            <button type="button" className="btn small" onClick={() => { setAccessKey(''); setSaved(false); setValue(''); setOpen(false); }}>지우기</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
