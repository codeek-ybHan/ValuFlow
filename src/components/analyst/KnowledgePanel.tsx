import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultKnowledgeClient, KnowledgeError, knowledgeErrorText, type KnowledgeClient, type KnowledgeDocument } from '../../data/repository/knowledgeRepository.ts';

const STATE_TEXT: Record<KnowledgeDocument['state'], string> = { ready: 'Ready', indexing: 'Indexing', failed: 'Failed', 'already-exists': 'Already exists' };

export interface KnowledgeState { documents: KnowledgeDocument[] | null; error: string | null; reload: () => Promise<void> }

/** 문서 목록 상태: 목록을 불러오지 못하면 null + 오류 문구 (문서가 0건인 것과 구분한다). */
export function useKnowledge(client: KnowledgeClient = defaultKnowledgeClient): KnowledgeState & { client: KnowledgeClient; setDocuments: (d: KnowledgeDocument[]) => void } {
  const [documents, setDocuments] = useState<KnowledgeDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setDocuments(await client.list()); setError(null); } catch (e) { setDocuments(null); setError(e instanceof KnowledgeError ? e.message : knowledgeErrorText('unknown')); }
  }, [client]);
  useEffect(() => { void reload(); }, [reload]);
  return { documents, error, reload, client, setDocuments };
}

/**
 * Knowledge Documents: 사용자 PDF 의 업로드 · 목록. 삭제 · 재인덱싱(`manage`)은 관리자 전용 API 라서 공개 화면에는 보이지 않는다
 * (공유 저장소라 사용자별 소유권이 없다: 한 방문자의 삭제가 다른 방문자의 문서에 영향을 주지 않도록). 관리자는 access key 로 API 를 직접 호출한다.
 */
export function KnowledgePanel({ kn, manage = false }: { kn: ReturnType<typeof useKnowledge>; manage?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (key: string, job: () => Promise<string | null>) => {
    setBusy(key); setMessage(null);
    try { const ok = await job(); if (ok) setMessage({ tone: 'ok', text: ok }); await kn.reload(); }
    catch (e) { setMessage({ tone: 'error', text: e instanceof KnowledgeError ? e.message : knowledgeErrorText('unknown') }); }
    finally { setBusy(null); }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    void run('upload', async () => {
      const d = await kn.client.upload(file);
      return d.state === 'already-exists' ? `이미 올린 문서입니다: ${d.title}` : `업로드했습니다: ${d.title} (${d.chunkCount} chunks)`;
    });
    if (input.current) input.current.value = '';
  };

  return (
    <section className="ai-card knowledge" aria-label="Knowledge Documents">
      <div className="panel-head"><h4>Knowledge Documents</h4><span className="chip">PDF</span></div>
      <label className="btn small">
        {busy === 'upload' ? '업로드 중…' : 'Upload PDF'}
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy !== null} onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {message ? <p className={`small ${message.tone === 'error' ? 'k-error' : 'muted'}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
      {kn.error ? <p className="small k-error" role="alert">{kn.error}</p> : null}
      {kn.documents === null && !kn.error ? <p className="small muted">문서 목록을 불러오는 중…</p> : null}
      {kn.documents && kn.documents.length === 0 ? <p className="small muted">리서치 문서를 업로드하면 AI 분석에 포함됩니다.</p> : null}
      {kn.documents && kn.documents.length > 0 ? (
        <ul className="doc-list" aria-label="업로드한 문서">
          {kn.documents.map((d) => (
            <li key={d.documentId}>
              <div className="doc-title" title={d.originalFilename ?? d.title}>{d.title}</div>
              <div className="small muted">{[d.documentType, d.businessYear ? `${d.businessYear}` : null, `${d.chunkCount} chunks`].filter(Boolean).join(' · ')}</div>
              <div className="doc-actions">
                <span className={`doc-state doc-${d.state}`}>{STATE_TEXT[d.state]}</span>
                {manage ? (
                  <>
                <button type="button" className="link" disabled={busy !== null} onClick={() => run(`re-${d.documentId}`, async () => { await kn.client.reindex(d.documentId); return `다시 인덱싱했습니다: ${d.title}`; })}>Re-index</button>
                {pending === d.documentId ? (
                  <>
                    <button type="button" className="link danger" disabled={busy !== null} onClick={() => { setPending(null); void run(`del-${d.documentId}`, async () => { await kn.client.remove(d.documentId); return `삭제했습니다: ${d.title}`; }); }}>삭제 확인</button>
                    <button type="button" className="link" onClick={() => setPending(null)}>취소</button>
                  </>
                ) : <button type="button" className="link" disabled={busy !== null} onClick={() => setPending(d.documentId)}>Delete</button>}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
