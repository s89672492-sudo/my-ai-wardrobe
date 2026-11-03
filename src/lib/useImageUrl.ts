import { useEffect, useState } from 'react';
import { getImageBlob } from './garments';

/** 從 IndexedDB 讀圖片並建立 object URL，元件卸載時釋放記憶體。 */
export function useImageUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let u: string | null = null, alive = true;
    void getImageBlob(id).then((b) => { if (alive && b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url;
}
