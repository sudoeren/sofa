import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** SVG path of the dark modules, one unit per module, with a quiet zone of `margin`. */
export function qrPath(text: string, margin = 2): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return { size: count + margin * 2, d };
}

/** A QR code drawn in currentColor on a transparent ground, so it follows the theme. */
export function QrCode({
  value,
  label,
  size = 168,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { size: units, d } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${units} ${units}`}
      shapeRendering="crispEdges"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
