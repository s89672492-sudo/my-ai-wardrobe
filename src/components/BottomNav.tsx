import { href, type Path, type Route } from '../lib/router';
import { Icon, type IconName } from './Icon';
import s from './BottomNav.module.css';

const TABS: { to: Path; label: string; icon: IconName; match: Route['name'][] }[] = [
  { to: '/', label: '首頁', icon: 'home', match: ['home'] },
  { to: '/wardrobe', label: '我的衣櫥', icon: 'hanger', match: ['wardrobe', 'garment', 'garment-new', 'garment-edit'] },
  { to: '/tryon', label: 'AI 試穿', icon: 'sparkle', match: ['tryon', 'person', 'person-new', 'studio'] },
  { to: '/outfits', label: '穿搭收藏', icon: 'heart', match: ['outfits'] },
  { to: '/settings', label: '個人設定', icon: 'user', match: ['settings', 'diagnostics', 'data'] },
];

export function BottomNav({ route }: { route: Route }) {
  const active = (t: (typeof TABS)[number]) => t.match.includes(route.name);
  return (
    <nav className={s.nav} aria-label="主要導覽">
      {TABS.map((t) => (
        <a key={t.to} href={href(t.to)} className={active(t) ? `${s.tab} ${s.active}` : s.tab} aria-current={active(t) ? 'page' : undefined}>
          <Icon name={t.icon} size={24} filled={active(t) && t.icon !== 'sparkle' && t.icon !== 'hanger'} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
