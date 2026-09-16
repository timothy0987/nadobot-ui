'use client';

import { useEffect, useRef, useState } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, drawPnlCard, shareText, type PnlCardData } from '@/lib/pnlCard';
import { track } from '@/lib/analytics';

/**
 * A shareable image of a closed trade. Traders posting results is how new traders find Nadobot, so the card credits
 * Nado and carries the site address. Dollar amounts are off by default so nobody reveals their size by accident.
 */
export function ShareCard({ data, chainId, onClose }: { data: PnlCardData; chainId: number; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showDollars, setShowDollars] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const site = typeof window === 'undefined' ? '' : window.location.host;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawPnlCard(ctx, data, { showDollars, site });
  }, [data, showDollars, site]);

  useEffect(() => {
    try {
      const probe = new File([new Blob()], 'probe.png', { type: 'image/png' });
      setCanShareFiles(Boolean(navigator.canShare?.({ files: [probe] })));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  const fileName = `nadobot-${data.symbol.toLowerCase()}-${data.returnPercent >= 0 ? 'win' : 'trade'}.png`;
  const toBlob = () =>
    new Promise<Blob>((resolve, reject) => canvasRef.current?.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));

  async function download() {
    const url = URL.createObjectURL(await toBlob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Image saved.');
    track('card_shared', chainId);
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob() })]);
      setStatus('Image copied. Paste it into your post.');
      track('card_shared', chainId);
    } catch {
      setStatus("This browser can't copy images. Use Download instead.");
    }
  }

  async function share() {
    try {
      const file = new File([await toBlob()], fileName, { type: 'image/png' });
      await navigator.share({ files: [file], text: shareText(data), url: window.location.origin });
      track('card_shared', chainId);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setStatus("Couldn't open sharing. Use Download instead.");
    }
  }

  function postOnX() {
    const url = `https://x.com/intent/post?text=${encodeURIComponent(shareText(data))}&url=${encodeURIComponent(window.location.origin)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setStatus('Attach the image (Download or Copy first) to your post on X.');
    track('card_shared', chainId);
  }

  return (
    <div className="share-card notice">
      <div className="share-card-header">
        <strong>Share this trade</strong>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <canvas ref={canvasRef} width={CARD_WIDTH} height={CARD_HEIGHT} className="share-card-canvas" role="img" aria-label={shareText(data)} />
      <label className="remind-toggle">
        <input type="checkbox" checked={showDollars} onChange={(e) => setShowDollars(e.target.checked)} />
        <span>Show the dollar amount (off by default, so your position size stays private)</span>
      </label>
      <div className="form-row">
        {canShareFiles && (
          <button className="btn btn-primary btn-sm" onClick={share}>
            Share…
          </button>
        )}
        <button className={`btn btn-sm ${canShareFiles ? 'btn-secondary' : 'btn-primary'}`} onClick={download}>
          Download image
        </button>
        <button className="btn btn-secondary btn-sm" onClick={copy}>
          Copy image
        </button>
        <button className="btn btn-secondary btn-sm" onClick={postOnX}>
          Post on X
        </button>
      </div>
      {status && <p className="muted" style={{ marginTop: '0.5rem' }}>{status}</p>}
    </div>
  );
}
