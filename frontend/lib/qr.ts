import qrcode from "qrcode-generator";

/**
 * A QR code made here, in the browser: the text never leaves the page (it
 * used to be sent to a third-party image service). Returns the SVG path of
 * the dark squares in module units, and the side length in modules.
 *
 * Level M (about 15% can be damaged) suits a printed card; the version is
 * the smallest that fits the text.
 */
export function qrPath(text: string): { d: string; size: number } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  // One horizontal run per dark stretch: a short path, however the code looks.
  let d = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && qr.isDark(row, col)) col++;
      d += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return { d, size };
}
