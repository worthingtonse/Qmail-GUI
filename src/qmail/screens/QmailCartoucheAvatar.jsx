/* eslint-disable react/prop-types */
import { useId } from "react";
import { getQmailAvatarAssetHref, getQmailAvatarTierName } from "../avatar/qmailAvatar";
import { serialSymbolColors } from "../avatar/serialColor";

import { TIER_BOX_COLORS } from "../avatar/tierColors";

// Box face is drawn dark regardless of app theme (like the frame art was);
// the tier tint and symbols read against it in both themes.
const BOX_BASE_FILL = "#141821";

// Rounded box inside the 100x100 viewBox, and the content area where the
// user's two chosen DRD symbols stack top to bottom.
const BOX_X = 5;
const BOX_Y = 5;
const BOX_SIZE = 90;
const BOX_RADIUS = 16;
const BOX_STROKE = 2.5;
const CONTENT_X = 25;
const CONTENT_WIDTH = 50;
const CONTENT_Y = 12;
const CONTENT_HEIGHT = 76;

/**
 * Cartouche avatar for a QMail user: a rounded box whose border color
 * encodes the denomination tier (bit/byte/kilo/mega/giga/epic), holding the
 * user's two CHOSEN DRD symbols stacked top to bottom (firstSymbol above
 * secondSymbol).
 *
 * Symbol COLORS come from the user's serial number: its last two bytes are
 * a 2-byte color space, read BIG-ENDIAN for the top symbol and
 * LITTLE-ENDIAN for the bottom (see avatar/serialColor.js) — two distinct
 * identity colors per user. The symbol SVGs draw with currentColor, so the
 * serial color is applied by alpha-masking a colored rect with the symbol
 * image; when no valid serialNumber is given the symbols fall back to
 * their baked golden-angle colors.
 *
 * Pass null for either symbol (or omit both) when symbols are unknown /
 * not chosen; this component then renders nothing so the caller can show
 * its fallback (letter-circle, qmailalpha.webp, etc.). Callers / the DRD
 * cache apply the (0,0)→null convention before props reach here.
 */
const QmailCartoucheAvatar = ({
  firstSymbol,
  secondSymbol,
  denominationCode,
  serialNumber,
  className = "email-list-pane__avatar-cartouche",
}) => {
  // React 18 useId contains ':' which is invalid inside url(#...) refs.
  const idBase = useId().replace(/:/g, "");

  if (firstSymbol == null || secondSymbol == null) return null;

  const tierName = getQmailAvatarTierName(denominationCode);
  if (!tierName) return null;

  const tierColor = TIER_BOX_COLORS[tierName];
  const faceGradientId = `${idBase}-face`;

  const colors = serialSymbolColors(serialNumber);
  const symbolIndices = [firstSymbol, secondSymbol];
  const slotHeight = CONTENT_HEIGHT / symbolIndices.length;

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={faceGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tierColor} stopOpacity="0.34" />
          <stop offset="100%" stopColor={tierColor} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect
        x={BOX_X}
        y={BOX_Y}
        width={BOX_SIZE}
        height={BOX_SIZE}
        rx={BOX_RADIUS}
        fill={BOX_BASE_FILL}
      />
      <rect
        x={BOX_X}
        y={BOX_Y}
        width={BOX_SIZE}
        height={BOX_SIZE}
        rx={BOX_RADIUS}
        fill={`url(#${faceGradientId})`}
        stroke={tierColor}
        strokeOpacity="0.65"
        strokeWidth={BOX_STROKE}
      />
      {symbolIndices.map((symbolIndex, position) => {
        const href = getQmailAvatarAssetHref("symbol", symbolIndex);
        const x = CONTENT_X;
        const y = CONTENT_Y + position * slotHeight;
        // Position in the key: the same symbol may appear twice
        // and each occurrence is its own layer.
        const key = `${position}-${symbolIndex}`;

        if (!colors) {
          // No serial available — render the baked symbol color as-is.
          return (
            <image
              key={key}
              href={href}
              x={x}
              y={y}
              width={CONTENT_WIDTH}
              height={slotHeight}
              preserveAspectRatio="xMidYMid meet"
            />
          );
        }

        const color = position === 0 ? colors.top : colors.bottom;
        const maskId = `${idBase}-s${position}`;
        return (
          <g key={key}>
            <mask
              id={maskId}
              // Alpha mask: the symbol's opaque pixels reveal the colored
              // rect below, so the glyph renders in the serial color
              // regardless of the color baked into the SVG file.
              style={{ maskType: "alpha" }}
              maskUnits="userSpaceOnUse"
              x={x}
              y={y}
              width={CONTENT_WIDTH}
              height={slotHeight}
            >
              <image
                href={href}
                x={x}
                y={y}
                width={CONTENT_WIDTH}
                height={slotHeight}
                preserveAspectRatio="xMidYMid meet"
              />
            </mask>
            <rect
              x={x}
              y={y}
              width={CONTENT_WIDTH}
              height={slotHeight}
              fill={color}
              mask={`url(#${maskId})`}
            />
          </g>
        );
      })}
    </svg>
  );
};

export default QmailCartoucheAvatar;
