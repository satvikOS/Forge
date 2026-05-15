import { useEffect, useState } from 'react';
import { svgToPdfBytes } from '../foundation/SvgRaster.js';

/**
 * Drawing Preview — full-screen overlay that shows the SVG drawing
 * the foundation.buildDrawingSVG pipeline emits. Pops up when the
 * Standard 3 View ribbon tool runs (window.__lastDrawingSVG
 * populated) and stays until the user closes it.
 *
 * Buttons: Download SVG, Download PDF, Print, Close.
 */
export default function DrawingPreviewPanel() {
  const [svg, setSvg] = useState(null);
  const [visible, setVisible] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastDrawingSVG : null;
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
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `archdisc-drawing-${stamp}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /** Rasterise the SVG to a one-page A3 PDF and download it. */
  const handleDownloadPDF = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const pdf = await svgToPdfBytes(svg);
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archdisc-drawing-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.warn('PDF export failed', err);
    } finally {
      setPdfBusy(false);
    }
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>ArchDisc Drawing</title></head><body style="margin:0">${svg}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <div className="dpp-backdrop" onClick={() => setVisible(false)}>
      <div className="dpp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dpp-header">
          <span className="dpp-title">Engineering Drawing — A3 third-angle projection</span>
          <button className="dpp-btn" onClick={handleDownload} data-action="dpp-download">Download SVG</button>
          <button className="dpp-btn" onClick={handleDownloadPDF} disabled={pdfBusy}
                  data-action="dpp-download-pdf">{pdfBusy ? 'Rendering…' : 'Download PDF'}</button>
          <button className="dpp-btn" onClick={handlePrint} data-action="dpp-print">Print</button>
          <button className="dpp-close" onClick={() => setVisible(false)} data-action="dpp-close">×</button>
        </div>
        <div className="dpp-body" data-dpp-body
             dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
