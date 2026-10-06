import type { Rich as RichT } from '../types';

export function Rich({ blocks }: { blocks: RichT }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (typeof b === 'string') return <p key={i}>{b}</p>;
        if ('formula' in b) return <pre key={i} className="formula">{b.formula}</pre>;
        if ('callout' in b) return <div key={i} className="callout">{b.callout}</div>;
        if ('list' in b)
          return (
            <ul key={i} className="plain-list">
              {b.list.map((x, j) => <li key={j}>{x}</li>)}
            </ul>
          );
        return (
          <div key={i} className="table-wrap">
            <table className="fin-table text-table">
              <thead><tr>{b.table.head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
              <tbody>{b.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
