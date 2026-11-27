import { useMe } from '../lib/couple';
import { useImageUrl } from '../lib/useImageUrl';
import { Icon } from './Icon';

/** 我的頭像：有自訂圖片就顯示圖片（只存在這支手機），否則顯示名字第一個字或衣架圖示 */
export function Avatar({ size = 36 }: { size?: number }) {
  const me = useMe();
  const url = useImageUrl(me.avatarId ?? null);
  const first = Array.from(me.name)[0];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : first ?? <Icon name="hanger" size={Math.round(size * 0.55)} />}
    </span>
  );
}
