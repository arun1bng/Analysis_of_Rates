/** Print one estimate sheet as a standalone PDF from its current rendered state. */
export function exportEstimateSectionToPdf(
  root: HTMLElement | null,
  title: string,
  estimateId = "N/A",
) {
  if (!root) throw new Error(`The ${title} sheet is not ready to export.`);
  const printWindow = window.open("", "_blank", "width=1100,height=850");
  if (!printWindow) throw new Error("The PDF print window was blocked. Allow pop-ups and try again.");

  const content = root.cloneNode(true) as HTMLElement;
  content.querySelectorAll("button, [role=button], input[type=checkbox]").forEach(element => element.remove());
  content.querySelectorAll("input:not([type=checkbox]), textarea, select").forEach(element => {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    field.replaceWith(document.createTextNode(field.value || ""));
  });
  content.querySelectorAll("svg").forEach(icon => icon.remove());

  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map(style => style.outerHTML).join("\n");
  const safeTitle = title.replace(/[<>]/g, "");
  const safeEstimateId = estimateId.replace(/[<>]/g, "");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
    ${styles}
    <style>
      @page { size: A4 landscape; margin: 14mm 12mm 18mm; @bottom-left { content: "${safeTitle}"; font: 8pt Arial; } @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial; } @bottom-right { content: "EST ID: ${safeEstimateId}"; font: 8pt Arial; } }
      html, body { width: 100% !important; height: auto !important; margin: 0 !important; overflow: visible !important; background: white !important; color: black !important; }
      #estimate-pdf-root, #estimate-pdf-root * { max-height: none !important; }
      #estimate-pdf-root { display: block !important; width: 100% !important; height: auto !important; overflow: visible !important; padding: 0 !important; background: white !important; color: black !important; }
      #estimate-pdf-root, #estimate-pdf-root * { color: #111 !important; box-shadow: none !important; text-shadow: none !important; }
      #estimate-pdf-root [class*="bg-"] { background-color: transparent !important; }
      #estimate-pdf-root [class*="overflow-"] { overflow: visible !important; max-height: none !important; }
      #estimate-pdf-root table { width: 100%; border-collapse: collapse; }
      #estimate-pdf-root th, #estimate-pdf-root td { border: 0.5pt solid #555 !important; padding: 3pt !important; break-inside: avoid; }
      .print\\:hidden, [data-pdf-hide="true"] { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }
    </style></head><body><main id="estimate-pdf-root">${content.innerHTML}</main>
    <script>window.addEventListener('load',()=>{window.focus();setTimeout(()=>window.print(),250)});window.addEventListener('afterprint',()=>window.close());</script>
    </body></html>`);
  printWindow.document.close();
}
