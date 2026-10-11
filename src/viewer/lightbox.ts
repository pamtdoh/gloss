import PhotoSwipe, { type SlideData } from "photoswipe";

// what the lightbox opens: the images and diagrams of one gallery root
// (a fact body, a note's text, a thread turn — each marked data-gallery)
const FIGURE = "img, .rk-mermaid svg";

// A Mermaid diagram as html content, so it stays vector-crisp at every
// zoom. A vector has no native size, so it is declared four viewports
// wide — room for PhotoSwipe's zoom ladder. pswp__img on the wrapper is
// what PhotoSwipe's click-to-zoom keys on.
function diagramSlide(svg: SVGSVGElement): SlideData {
  const box = svg.viewBox.baseVal;
  const width = box.width || svg.clientWidth || 800;
  const height = box.height || svg.clientHeight || 600;
  const scale = Math.max(1, (4 * window.innerWidth) / width);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  return {
    type: "html",
    html: `<div class="rk-mermaid-zoom pswp__img">${clone.outerHTML}</div>`,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

let open: PhotoSwipe | null = null;

export const lightboxOpen = (): boolean => open !== null;
export const closeLightbox = (): void => open?.close();

/** Open the gallery a clicked figure belongs to. The figures' HTML is
 * injected, so the click is delegated from the app root. */
export function openGallery(target: Element): void {
  const figure = target.closest(FIGURE);
  const body = figure?.closest("[data-gallery]");
  if (!figure || !body) return;
  const figures = Array.from(body.querySelectorAll(FIGURE));
  const pswp = new PhotoSwipe({
    dataSource: figures.map((el) =>
      el instanceof HTMLImageElement
        ? {
            src: el.currentSrc || el.src,
            width: el.naturalWidth || 1600,
            height: el.naturalHeight || 1200,
            alt: el.alt,
            msrc: el.currentSrc || el.src,
          }
        : diagramSlide(el as SVGSVGElement),
    ),
    index: Math.max(0, figures.indexOf(figure)),
    wheelToZoom: true,
    // figures are opened to inspect, many times a session: no transition
    showHideAnimationType: "none",
  });
  pswp.addFilter("isContentZoomable", (zoomable, content) => zoomable || content.data.type === "html");
  pswp.on("destroy", () => {
    if (open === pswp) open = null;
  });
  open = pswp;
  pswp.init();
}
