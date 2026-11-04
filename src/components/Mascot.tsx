import { useId } from 'react';
import type { Owner } from '../lib/types';
import { useCouple } from '../lib/couple';
import { useImageUrl } from '../lib/useImageUrl';

/**
 * App 原創吉祥物：兩隻小貓。
 * - 她：三花貓（白底，頭上一塊橘色、右耳深棕色），粉紅內耳、ω 嘴
 * - 他：橘虎斑貓，額頭三條紋、尾巴有條紋
 * 使用者若在設定上傳自訂頭像，頭像只存在這支手機的 IndexedDB，不會上傳或部署。
 */
const INK = '#2e2a4f';
const PAL = {
  her: { fur: '#ffffff', paw: '#fff3ea', inner: '#ffb3c6', patchA: '#ffb36b', patchB: '#6b4f4a', tail: '#ffb36b' },
  him: { fur: '#ffb565', paw: '#ffe2bf', inner: '#ff9fb4', patchA: '#e88a3a', patchB: '#e88a3a', tail: '#ffb565' },
};

export function Buddy({ who, size = 64, pose = 'stand', className }: { who: 'her' | 'him'; size?: number; pose?: 'stand' | 'wave' | 'face'; className?: string }) {
  const c = PAL[who];
  const id = useId().replace(/:/g, '');
  const face = pose === 'face';
  const vb = face ? '0 0 120 100' : '0 0 120 136';
  const head = 'M60 22 C86 22 104 36 104 60 C104 82 86 94 60 94 C34 94 16 82 16 60 C16 36 34 22 60 22 Z';
  return (
    <svg className={className} viewBox={vb} width={size} height={size * (face ? 100 : 136) / 120} aria-hidden="true" style={{ overflow: 'visible' }}>
      <defs><clipPath id={`h${id}`}><path d={head} /></clipPath></defs>
      <g stroke={INK} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {!face && <>
          {/* 尾巴：先畫墨線粗筆再疊毛色 */}
          <path d="M80 118 C102 122 112 104 102 90" fill="none" strokeWidth="13" />
          <path d="M80 118 C102 122 112 104 102 90" fill="none" stroke={c.tail} strokeWidth="7" />
          {who === 'him' && <path d="M98 113 L104 109 M104 100 L110 100" stroke={c.patchA} strokeWidth="3" />}
          {/* 身體 */}
          <path d="M38 86 C33 106 35 124 46 127 L74 127 C85 124 87 106 82 86 Z" fill={c.fur} />
          <path d="M50 104 C50 96 70 96 70 104 C70 116 50 116 50 104 Z" fill={c.paw} strokeWidth="0" />
          {/* 前腳 */}
          <ellipse cx="48" cy="126" rx="8.5" ry="6" fill={c.fur} />
          <ellipse cx="72" cy="126" rx="8.5" ry="6" fill={c.fur} />
          {pose === 'wave'
            ? <ellipse cx="103" cy="94" rx="7" ry="10" transform="rotate(-50 103 94)" fill={c.fur} />
            : <ellipse cx="80" cy="104" rx="6.5" ry="9.5" transform="rotate(-15 80 104)" fill={c.fur} />}
          <ellipse cx="40" cy="104" rx="6.5" ry="9.5" transform="rotate(15 40 104)" fill={c.fur} />
        </>}
        {/* 耳朵 */}
        <path d="M24 44 C20 28 22 14 26 10 C32 12 44 20 52 28 Z" fill={who === 'her' ? c.fur : c.fur} />
        <path d="M96 44 C100 28 98 14 94 10 C88 12 76 20 68 28 Z" fill={who === 'her' ? c.patchB : c.fur} />
        <path d="M28 36 C27 27 28 20 30 18 C34 20 40 24 44 28 Z" fill={c.inner} stroke="none" />
        <path d="M92 36 C93 27 92 20 90 18 C86 20 80 24 76 28 Z" fill={c.inner} stroke="none" />
        {/* 頭與花紋 */}
        <path d={head} fill={c.fur} />
        <g clipPath={`url(#h${id})`} stroke="none">
          {who === 'her'
            ? <><path d="M10 20 C30 18 48 28 50 44 C44 56 26 56 10 52 Z" fill={c.patchA} /><path d="M80 18 C96 22 108 30 110 44 C100 46 86 40 80 30 Z" fill={c.patchB} /></>
            : <><path d="M60 24 L56 38 L64 38 Z M47 26 L46 37 L52 36 Z M73 26 L74 37 L68 36 Z" fill={c.patchA} /></>}
        </g>
        <path d={head} fill="none" />
      </g>
      {/* 臉 */}
      <g fill={INK}>
        <ellipse cx="43" cy="60" rx="4.6" ry="5.6" />
        <ellipse cx="77" cy="60" rx="4.6" ry="5.6" />
        <circle cx="44.6" cy="58" r="1.6" fill="#fff" />
        <circle cx="78.6" cy="58" r="1.6" fill="#fff" />
      </g>
      <path d="M56.5 66.5 L63.5 66.5 L60 70.5 Z" fill="#ff7f9e" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M52 72 Q56 77 60 72 Q64 77 68 72" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <g stroke={INK} strokeWidth="2" strokeLinecap="round">
        <path d="M30 66 L14 63 M30 71 L15 73" /><path d="M90 66 L106 63 M90 71 L105 73" />
      </g>
      <ellipse cx="32" cy="76" rx="6.5" ry="4" fill="#ff8fab" opacity=".5" />
      <ellipse cx="88" cy="76" rx="6.5" ry="4" fill="#ff8fab" opacity=".5" />
    </svg>
  );
}

/** 頭像：有自訂圖片就顯示圖片（只在本機），否則顯示小貓 */
export function Avatar({ who, size = 36 }: { who: 'her' | 'him'; size?: number }) {
  const c = useCouple();
  const url = useImageUrl(who === 'her' ? c.herAvatarId : c.himAvatarId);
  return (
    <span className={`avatar avatar-${who}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <Buddy who={who} pose="face" size={size * 0.86} />}
    </span>
  );
}

/** 擁有者頭像：共用時兩個頭像疊在一起 */
export function OwnerAvatar({ owner, size = 22 }: { owner: Owner; size?: number }) {
  if (owner === 'both') return <span className="owner-pair"><Avatar who="her" size={size} /><Avatar who="him" size={size} /></span>;
  return <Avatar who={owner} size={size} />;
}

/** 兩隻小貓站在一起（空白頁） */
export function CoupleBuddies({ size = 72 }: { size?: number }) {
  const c = useCouple();
  const herUrl = useImageUrl(c.herAvatarId), himUrl = useImageUrl(c.himAvatarId);
  return (
    <div className="couple" aria-hidden="true">
      {herUrl ? <img className="couple-img" src={herUrl} alt="" style={{ width: size, height: size }} /> : <Buddy who="her" pose="wave" size={size} className="bob" />}
      <svg className="couple-heart" viewBox="0 0 24 24" width={size * 0.28} height={size * 0.28}><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill="#ff8fa3" /></svg>
      {himUrl ? <img className="couple-img" src={himUrl} alt="" style={{ width: size, height: size }} /> : <Buddy who="him" size={size} className="bob delay" />}
    </div>
  );
}
