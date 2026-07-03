/* eslint-disable react/prop-types */
import { getQmailAvatarAssetHref, getQmailAvatarModel } from "../avatar/qmailAvatar";

// MVP: cartouches/qcons are hidden until the cartouche system is secured.
// The svg still renders (layout keeps its space) but is invisible.
// Set to false to bring all cartouches back.
const HIDE_CARTOUCHES_FOR_MVP = true;

// Inner content area of the 100x100 frame: the frames/*.svg draw an
// upright chamfered placard (plate x=24..76, y=10..86 with a ~3px metal
// edge and a status strip below y=80). Stay inside it.
const CONTENT_X = 27;
const CONTENT_WIDTH = 46;
const CONTENT_Y = 14;
const CONTENT_HEIGHT = 64;

/**
 * Cartouche avatar for a dotted-decimal QMail address: the frame color
 * encodes the denomination, and one colored symbol per significant serial
 * byte (1-3, mirroring the address's dropped leading zeros) stacks top to
 * bottom in byte order — e.g. 51.254@bit shows symbol 051 above 254
 * inside the "bit" frame. Fewer symbols render larger.
 */
const QmailCartoucheAvatar = ({
  serialNumber,
  denominationCode,
  className = "email-list-pane__avatar-cartouche",
}) => {
  const avatarModel = getQmailAvatarModel({ serialNumber, denominationCode });
  if (!avatarModel) return null;

  const { tierName, symbolIndices } = avatarModel;
  const slotHeight = CONTENT_HEIGHT / symbolIndices.length;

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      style={HIDE_CARTOUCHES_FOR_MVP ? { visibility: "hidden" } : undefined}
    >
      <image
        href={getQmailAvatarAssetHref("frame", tierName)}
        x="0"
        y="0"
        width="100"
        height="100"
      />
      {symbolIndices.map((symbolIndex, position) => (
        <image
          // Position in the key: the same symbol may appear twice
          // (e.g. serial 51.51) and each occurrence is its own layer.
          key={`${position}-${symbolIndex}`}
          href={getQmailAvatarAssetHref("symbol", symbolIndex)}
          x={CONTENT_X}
          y={CONTENT_Y + position * slotHeight}
          width={CONTENT_WIDTH}
          height={slotHeight}
          preserveAspectRatio="xMidYMid meet"
        />
      ))}
    </svg>
  );
};

export default QmailCartoucheAvatar;
