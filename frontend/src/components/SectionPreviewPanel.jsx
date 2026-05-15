import { useEffect, useState } from 'react';

/**
 * Section Preview — full-screen overlay rendering the cross-section
 * SVG the Section View ribbon tool emits. Polls window.__lastSectionSVG,
 * shows the hatched section inline, offers an explicit SVG download.
 * Mirrors DrawingPreviewPanel.
 */
export default function SectionPreviewPanel() {
  const [svg, setSvg] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastSectionSVG : null;
      if (next && next !== svg) {
        setSvg(next);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [svg]);

  if (!visible || !svg) return null;

  const handleDownload = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archdisc-section-${new Date().toISOString().slice(0, 10)}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="spp-backdrop" onClick={() => setVisible(false)}>
      <div className="spp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="spp-header">
          <span className="spp-title">Section View — cross-section A-A</span>
          <button className="spp-btn" onClick={handleDownload} data-action="spp-download">Download SVG</button>
          <button className="spp-close" onClick={() => setVisible(false)} data-action="spp-close">×</button>
        </div>
        <div className="spp-body" data-spp-body
             dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
