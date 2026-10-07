import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 되돌릴 수 없는 덮어쓰기 전에 사용자에게 확인을 받는 대화상자.
 * 취소 버튼이 처음 포커스를 받고(실수로 Enter 를 눌러도 안전), Esc 와 바깥 클릭은 취소이며, 닫으면 열기 전 포커스로 돌아간다.
 */
export function ConfirmDialog({ open, title, message, cancelLabel, confirmLabel, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="dialog-scrim" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message" onClick={(e) => e.stopPropagation()}>
        <h3 id="dialog-title">{title}</h3>
        <p id="dialog-message">{message}</p>
        <div className="row dialog-actions">
          <button ref={cancelRef} className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
