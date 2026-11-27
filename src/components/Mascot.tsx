import type { Owner } from '../lib/types';
import { useCouple } from '../lib/couple';
import { useImageUrl } from '../lib/useImageUrl';

/**
 * 兩人的頭像：有自訂圖片就顯示圖片（只存在這支手機），否則顯示名字第一個字的圓章。
 */
export function Avatar({ who, size = 36 }: { who: 'her' | 'him'; size?: number }) {
  const c = useCouple();
  const url = useImageUrl(who === 'her' ? c.herAvatarId : c.himAvatarId);
  const name = who === 'her' ? c.herName : c.himName;
  return (
    <span className={`avatar avatar-${who}`} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : Array.from(name)[0] ?? ''}
    </span>
  );
}

/** 擁有者頭像：共用時兩個頭像疊在一起 */
export function OwnerAvatar({ owner, size = 22 }: { owner: Owner; size?: number }) {
  if (owner === 'both') return <span className="owner-pair"><Avatar who="her" size={size} /><Avatar who="him" size={size} /></span>;
  return <Avatar who={owner} size={size} />;
}
