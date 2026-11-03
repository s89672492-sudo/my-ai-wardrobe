import { href, type Route } from '../lib/router';
import { Icon, type IconName } from './Icon';
import s from './BottomNav.module.css';

const TABS: { to: Route; label: string; icon: IconName }[] = [
  { to: '/', label: '首頁', icon: 'home' },
  { to: '/wardrobe', label: '我的衣櫥', icon: 'hanger' },
  { to: '/tryon', label: 'AI 試穿', icon: 'sparkle' },
  { to: '/outfits', label: '穿搭收藏', icon: 'heart' },
  { to: '/settings', label: '個人設定', icon: 'user' },
];

export function BottomNav({ route }: { route: Route }) {
  const active = (to: Route) => (to === '/' ? route === '/' : route.startsWith(to));
  return (
    <nav className={s.nav} aria-label="主要導覽">
      {TABS.map((t) => (
        <a key={t.to} href={href(t.to)} className={active(t.to) ? `${s.tab} ${s.active}` : s.tab} aria-current={active(t.to) ? 'page' : undefined}>
          <Icon name={t.icon} size={24} filled={active(t.to) && t.icon !== 'sparkle' && t.icon !== 'hanger'} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
