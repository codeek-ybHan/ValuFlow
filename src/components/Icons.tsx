// 단순 라인 아이콘 (의존성 없음). 장식용이므로 aria-hidden.
const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconDashboard = () => <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
export const IconRoadmap = () => <svg {...p}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5" /></svg>;
export const IconReport = () => <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
export const IconCheck = () => <svg {...p} width={22} height={22}><path d="m5 12 5 5 9-10" /></svg>;
export const IconLayers = () => <svg {...p} width={22} height={22}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
export const IconBook = () => <svg {...p} width={22} height={22}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5" /></svg>;
export const IconPen = () => <svg {...p} width={22} height={22}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;
export const IconSun = () => <svg {...p} width={14} height={14}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const IconMoon = () => <svg {...p} width={14} height={14}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>;
export const IconMonitor = () => <svg {...p} width={14} height={14}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
