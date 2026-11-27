import type { ReactNode } from 'react';
import { href, type Path } from '../lib/router';
import { Icon, type IconName } from './Icon';

export function PageHeader({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: Path; right?: ReactNode }) {
  return (
    <header className="page-header">
      {back && <a className="back" href={href(back)} aria-label="返回"><Icon name="back" /></a>}
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={36} /></div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ListLink({ to, icon, title, detail }: { to: Path; icon: IconName; title: string; detail?: string }) {
  return (
    <a className="list-row" href={href(to)}>
      <Icon name={icon} size={22} />
      <span className="list-title">{title}</span>
      {detail && <span className="list-detail">{detail}</span>}
      <Icon name="chevron" size={18} />
    </a>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
