/* eslint-disable react/prop-types */
import { useId } from "react";
import { getQmailAvatarAssetHref, getQmailAvatarTierName } from "../avatar/qmailAvatar";
import { serialSymbolColors } from "../avatar/serialColor";

// Inner content area of the 100x100 frame: the frames/*.svg draw an
// upright chamfered placard (plate x=24..76, y=10..86 with a ~3px metal
// edge and a status strip below y=80). Stay inside it.
const CONTENT_X = 27;
const CONTENT_WIDTH = 46;
const CONTENT_Y = 14;
const CONTENT_HEIGHT = 64;

/**
 * Cartouche avatar for a QMail user: the frame encodes the denomination
 * tier (bit/byte/kilo/mega/giga/epic), and the user's two CHOSEN DRD
 * symbols stack top to bottom (firstSymbol above secondSymbol) inside the
 * placard.
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
  const maskIdBase = useId().replace(/:/g, "");

  if (firstSymbol == null || secondSymbol == null) return null;

  const tierName = getQmailAvatarTierName(denominationCode);
  if (!tierName) return null;

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
      <image
        href={getQmailAvatarAssetHref("frame", tierName)}
        x="0"
        y="0"
        width="100"
        height="100"
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
        const maskId = `${maskIdBase}-s${position}`;
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
