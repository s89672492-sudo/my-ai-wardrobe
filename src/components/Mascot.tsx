import type { Owner } from '../lib/types';
import { useCouple } from '../lib/couple';
import { useImageUrl } from '../lib/useImageUrl';

/**
 * App 原創吉祥物（向量繪製）：
 * - 她：白色小熊，粉紅內耳、耳朵上的蝴蝶結、胸前小愛心
 * - 他：奶茶色小熊，淺色口鼻、黑鼻頭、胸前小星星
 * 使用者若在設定上傳自訂頭像，頭像只存在這支手機的 IndexedDB，不會上傳或部署。
 */
const INK = '#5a3e2b';

export function Bear({ who, size = 64, pose = 'stand', className }: { who: 'her' | 'him'; size?: number; pose?: 'stand' | 'wave' | 'face'; className?: string }) {
  const her = who === 'her';
  const fur = her ? '#ffffff' : '#d4a77f';
  const inner = her ? '#ffc4cf' : '#b98560';
  const face = pose === 'face';
  const vb = face ? '0 0 120 100' : '0 0 120 140';
  return (
    <svg className={className} viewBox={vb} width={size} height={face ? size * (100 / 120) : size * (140 / 120)} aria-hidden="true" style={{ overflow: 'visible' }}>
      <g stroke={INK} strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round">
        {/* 身體 */}
        {!face && <>
          <path d="M34 92 C30 112 32 128 42 131 L78 131 C88 128 90 112 86 92 Z" fill={fur} />
          {/* 小手：wave 時右手舉起揮手 */}
          <ellipse cx="33" cy="106" rx="7.5" ry="11" transform="rotate(25 33 106)" fill={fur} />
          {pose === 'wave'
            ? <ellipse cx="97" cy="90" rx="7.5" ry="11" transform="rotate(-55 97 90)" fill={fur} />
            : <ellipse cx="87" cy="106" rx="7.5" ry="11" transform="rotate(-25 87 106)" fill={fur} />}
          <path d="M44 131 L44 136 L56 136 L56 131 M64 131 L64 136 L76 136 L76 131" fill={her ? '#ffffff' : '#c3946b'} />
          {her
            ? <path d="M60 116 C55 110 50 113 52 117 C53 120 60 124 60 124 C60 124 67 120 68 117 C70 113 65 110 60 116 Z" fill="#ff8fa3" strokeWidth="2.4" />
            : <path d="M60 108 L62.6 113.6 L68.6 114.2 L64 118 L65.4 124 L60 120.8 L54.6 124 L56 118 L51.4 114.2 L57.4 113.6 Z" fill="#ffd36b" strokeWidth="2.2" />}
        </>}
        {/* 耳朵 */}
        <circle cx="25" cy="24" r="14" fill={fur} />
        <circle cx="95" cy="24" r="14" fill={fur} />
        <circle cx="25" cy="24" r="6.5" fill={inner} stroke="none" />
        <circle cx="95" cy="24" r="6.5" fill={inner} stroke="none" />
        {/* 頭 */}
        <ellipse cx="60" cy="56" rx="47" ry="40" fill={fur} />
        {her && (
          // 蝴蝶結
          <g fill="#ff8fa3" strokeWidth="2.6">
            <path d="M92 10 L80 2 L80 18 Z" />
            <path d="M92 10 L104 2 L104 18 Z" />
            <circle cx="92" cy="10" r="3.6" />
          </g>
        )}
        {!her && <ellipse cx="60" cy="68" rx="17" ry="12.5" fill="#f3dcc6" strokeWidth="2.6" />}
      </g>
      {/* 臉 */}
      <g fill={INK}>
        <ellipse cx={her ? 42 : 40} cy={her ? 56 : 54} rx="4.2" ry="5" />
        <ellipse cx={her ? 78 : 80} cy={her ? 56 : 54} rx="4.2" ry="5" />
        <circle cx={her ? 43.4 : 41.4} cy={her ? 54.2 : 52.2} r="1.4" fill="#fff" />
        <circle cx={her ? 79.4 : 81.4} cy={her ? 54.2 : 52.2} r="1.4" fill="#fff" />
        {!her && <path d="M54.5 63 Q60 59.5 65.5 63 Q63 68 60 68 Q57 68 54.5 63 Z" />}
      </g>
      <path d={her ? 'M53 64 Q56.5 68.5 60 64.5 Q63.5 68.5 67 64' : 'M54 72 Q60 77 66 72'} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx={her ? 30 : 28} cy="68" rx="8" ry="5" fill={her ? '#ffb3c1' : '#f0a07a'} opacity={her ? 0.9 : 0.6} />
      <ellipse cx={her ? 90 : 92} cy="68" rx="8" ry="5" fill={her ? '#ffb3c1' : '#f0a07a'} opacity={her ? 0.9 : 0.6} />
    </svg>
  );
}

/** 頭像：有自訂圖片就顯示圖片（只在本機），否則顯示原創小熊臉 */
export function Avatar({ who, size = 36 }: { who: 'her' | 'him'; size?: number }) {
  const c = useCouple();
  const url = useImageUrl(who === 'her' ? c.herAvatarId : c.himAvatarId);
  return (
    <span className={`avatar avatar-${who}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <Bear who={who} pose="face" size={size * 0.92} />}
    </span>
  );
}

/** 擁有者頭像：共用時兩個頭像疊在一起 */
export function OwnerAvatar({ owner, size = 22 }: { owner: Owner; size?: number }) {
  if (owner === 'both') return <span className="owner-pair"><Avatar who="her" size={size} /><Avatar who="him" size={size} /></span>;
  return <Avatar who={owner} size={size} />;
}

/** 兩隻熊站在一起（首頁、空白頁） */
export function CoupleBears({ size = 72 }: { size?: number }) {
  const c = useCouple();
  const herUrl = useImageUrl(c.herAvatarId), himUrl = useImageUrl(c.himAvatarId);
  return (
    <div className="couple" aria-hidden="true">
      {herUrl ? <img className="couple-img" src={herUrl} alt="" style={{ width: size, height: size }} /> : <Bear who="her" pose="wave" size={size} className="bob" />}
      <svg className="couple-heart" viewBox="0 0 24 24" width={size * 0.28} height={size * 0.28}><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill="#ff8fa3" /></svg>
      {himUrl ? <img className="couple-img" src={himUrl} alt="" style={{ width: size, height: size }} /> : <Bear who="him" size={size} className="bob delay" />}
    </div>
  );
}
