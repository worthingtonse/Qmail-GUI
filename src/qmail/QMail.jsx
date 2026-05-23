import QMailDashboard from './screens/QMailDashboard';
import './screens/QMailDashboard.css';

// FIX-03: forward initialIdentity from App so QMailDashboard can seed
// userAccount synchronously when App already has the identity.
// eslint-disable-next-line react/prop-types
const QMail = ({ initialIdentity, onSignOut }) => {
  return (
    <QMailDashboard
      initialIdentity={initialIdentity}
      onSignOut={onSignOut}
    />
  );
};

export default QMail;
