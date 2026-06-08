/* eslint-disable react/prop-types */
import { getQmailAvatarAssetHref, getQmailAvatarModel } from "../avatar/qmailAvatar";

const QmailCartoucheAvatar = ({ serialNumber, denominationCode }) => {
  const avatarModel = getQmailAvatarModel({ serialNumber, denominationCode });
  if (!avatarModel) return null;

  return (
    <svg
      className="email-list-pane__avatar-cartouche"
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <image href={getQmailAvatarAssetHref("frame", avatarModel.tierName)} x="0" y="0" width="100" height="100" />
      <image
        href={getQmailAvatarAssetHref("adjectives", avatarModel.adjectiveIndex)}
        x="18"
        y="12"
        width="64"
        height="30"
        preserveAspectRatio="xMidYMid meet"
      />
      <image
        href={getQmailAvatarAssetHref("nouns", avatarModel.nounIndex)}
        x="15"
        y="40"
        width="70"
        height="42"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
};

export default QmailCartoucheAvatar;
