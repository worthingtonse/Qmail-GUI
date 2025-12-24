import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, ArrowRightLeft, Settings, List, CloudCheck, Upload, Download, Key } from 'lucide-react'; 
import '../components/MainDashboard.css';
import useGlassSounds from '../../api/useGlassSounds';
import AuthenticateTab from './tabs/AuthenticateTab';
import ExportTab from './tabs/ExportTab';
import LockerDownloadTab from './tabs/LockerDownloadTab';
import LockerUploadTab from './tabs/LockerUploadTab';
import StoreTab from './tabs/StoreTab';
import PayoutTab from './tabs/PayoutTab';
import SettingsTab from './tabs/SettingsTab';
// import TransactionsTab from './tabs/TransactionsTab';
// import '../../styles/cloudcoin-cursors.css';

const MainDashboard = () => {

  const [activeTab, setActiveTab] = useState('authenticate');
  const { addGlassClickSound, playGlassTab, playGlassClick } = useGlassSounds();
  
  // Refs for adding sound effects
  const logoutButtonRef = useRef(null);
  const tabRefs = useRef({});

  const [footerVisible, setFooterVisible] = useState(false);
const footerRef = useRef(null);

  // Add sound effects when component mounts
  useEffect(() => {
    // Add click sound to logout button
    if (logoutButtonRef.current) {
      const cleanup = addGlassClickSound(logoutButtonRef.current, 'glassClick');
      return cleanup;
    }
  }, [addGlassClickSound]);

  useEffect(() => {
    // Add sounds to all tab buttons
    const cleanupFunctions = [];
    
    Object.values(tabRefs.current).forEach(tabElement => {
      if (tabElement) {
        const cleanup = addGlassClickSound(tabElement, 'glassTab');
        if (cleanup) cleanupFunctions.push(cleanup);
      }
    });

    // Return cleanup function
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup && cleanup());
    };
  }, [addGlassClickSound]);

  useEffect(() => {
  const handleScroll = () => {
    if (footerRef.current) {
      const footerRect = footerRef.current.getBoundingClientRect();
      const isVisible = footerRect.top <= window.innerHeight;
      setFooterVisible(isVisible);
    }
  };

  window.addEventListener('scroll', handleScroll);
  handleScroll(); // Check initial state

  return () => window.removeEventListener('scroll', handleScroll);
}, []);

  const handleLogout = () => {
    playGlassClick(); // Play sound immediately for instant feedback
    console.log('Logout clicked. Reloading...');
    
    // Small delay to let sound play before reload
    setTimeout(() => {
      window.location.reload();
    }, 150);
  };

  const handleTabChange = (tabId) => {
    if (tabId !== activeTab) {
      playGlassTab(); // Play tab switch sound
      setActiveTab(tabId);
    }
  };

  const tabs = [
    { id: 'authenticate', label: 'Authenticate', icon: CloudCheck },
    { id: 'export', label: 'Export', icon: Upload },
    { id: 'locker-download', label: 'Locker Download', icon: Download },
    { id: 'locker-upload', label: 'Locker Upload', icon: Key },
    { id: 'store', label: 'Store', icon: HardDrive },
    // { id: 'transactions', label: 'Transactions', icon: List },
    { id: 'payout', label: 'Payout', icon: ArrowRightLeft },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'authenticate':
        return <AuthenticateTab />;
      case 'export':
        return <ExportTab />;
      case 'locker-download':
        return <LockerDownloadTab />;
      case 'locker-upload':
        return <LockerUploadTab />;
      case 'store':
        return <StoreTab />;
      // case 'transactions':
      //   return <TransactionsTab />;
      case 'payout':
        return <PayoutTab />;
      case 'settings':
        return <SettingsTab />;
      default:
        return null;
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>CloudCoin Pro</h1>
          <span className="version">v1.0 - July 30 2025</span>
        </div>
        <div className="header-right">
          <button 
            ref={logoutButtonRef}
            className="logout-button glass-sound-btn" 
            onClick={handleLogout}
            title="Logout from CloudCoin Pro"
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="dashboard-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            ref={el => tabRefs.current[tab.id] = el}
            className={`nav-tab glass-sound-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
            title={`Switch to ${tab.label} tab`}
          >
            {/* Render the icon component */}
            <tab.icon size={32} className="tab-icon" />
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="dashboard-main">
        {renderTabContent()}
      </main>

      {/* <footer className="dashboard-footer">
        <p>CloudCoin Pro - Secure storage on USB drive</p>
        <p>Free from the CloudCoin Consortium</p>
      </footer> */}
      <footer 
  ref={footerRef}
  className={`dashboard-footer scroll-footer ${footerVisible ? 'visible' : ''}`}
>
  <p>CloudCoin Pro - Secure storage on USB drive</p>
  <p>Free from the CloudCoin Consortium</p>
</footer>
    </div>
  );
};

export default MainDashboard;