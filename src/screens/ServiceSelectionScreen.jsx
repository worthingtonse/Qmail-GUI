// import React from 'react';
// import { Wallet, Mail } from 'lucide-react';
// import './ServiceSelectionScreen.css';

// const ServiceSelectionScreen = ({ onSelectService }) => {
//   return (
//     <div className="service-selection-screen">
//       <div className="service-selection-container">
//         <h1>Welcome to CloudCoin Pro</h1>
//         <p>Please select a service to continue.</p>
//         <div className="service-selection-buttons">
//           <button
//             onClick={() => onSelectService('wallet')}
//             className="service-button wallet"
//           >
//             <div className="service-button-content">
//               <Wallet className="service-button-icon" size={38} />
//               <span>Wallet Services</span>
//             </div>
//           </button>
//           <button
//             onClick={() => onSelectService('qmail')}
//             className="service-button qmail"
//           >
//             <div className="service-button-content">
//               <Mail className="service-button-icon" size={38} />
//               <span>QMail Services</span>
//             </div>
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ServiceSelectionScreen;


import React from 'react';
import { Mail, ArrowRight, Shield, Lock, ShieldCheck } from 'lucide-react';
import './ServiceSelectionScreen.css';

const ServiceSelectionScreen = ({ onSelectService }) => {
  return (
    <div className="service-selection-screen">
      <div className="service-selection-container">
        <div className="service-icon-header">
          <Mail className="main-service-icon" size={64} />
        </div>
        
        <h1>Welcome to QMail</h1>
        <p>
          Experience the next generation of secure communication. 
          Quantum-resistant encryption protecting your digital legacy.
        </p>

        <div className="service-selection-buttons">
          <button
            onClick={() => onSelectService('qmail')}
            className="service-button qmail primary-action"
          >
            <div className="service-button-content">
              <span>Launch QMail Dashboard</span>
              <ArrowRight className="service-button-icon" size={24} />
            </div>
          </button>
        </div>

        {/* <div className="maintenance-footer">
          <div className="maintenance-tag">
            <Shield size={14} />
            <span>Wallet Services Offline</span>
          </div>
          <p className="maintenance-text">
            Wallet functionality is temporarily suspended for scheduled security upgrades.
          </p>
        </div> */}
      </div>

      {/* 3D Encrypted Envelopes */}
      <div className="encrypted-envelopes">
        <div className="envelope-3d">
          <div className="envelope-body"></div>
          <div className="envelope-flap"></div>
          <Lock className="envelope-lock" size={28} />
          <div className="encryption-badge">
            <ShieldCheck size={18} />
          </div>
          <div className="encryption-particles">
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
          </div>
        </div>
        <div className="envelope-3d">
          <div className="envelope-body"></div>
          <div className="envelope-flap"></div>
          <Lock className="envelope-lock" size={28} />
          <div className="encryption-badge">
            <Shield size={18} />
          </div>
          <div className="encryption-particles">
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
          </div>
        </div>
        <div className="envelope-3d">
          <div className="envelope-body"></div>
          <div className="envelope-flap"></div>
          <Lock className="envelope-lock" size={28} />
          <div className="encryption-badge">
            <ShieldCheck size={18} />
          </div>
          <div className="encryption-particles">
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
            <div className="particle"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceSelectionScreen;