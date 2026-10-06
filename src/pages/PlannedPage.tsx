import { PageHeader, ComingSoon } from '../components/ui';

export function PlannedPage({ eyebrow, title, comingIn, description, items }: { eyebrow: string; title: string; comingIn: string; description: string; items: string[] }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}><p className="muted">{description}</p></PageHeader>
      <ComingSoon comingIn={comingIn}>
        <h4>구성 예정</h4>
        <ul className="plain-list">{items.map((x) => <li key={x}>{x}</li>)}</ul>
      </ComingSoon>
    </>
  );
}
