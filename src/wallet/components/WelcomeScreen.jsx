import './WelcomeScreen.css';

/* eslint-disable react/prop-types -- project screens pass simple callback props without prop-types. */

const WelcomeScreen = ({ onAgree }) => {
  return (
    <main className="welcome-screen">
      <section
        className="welcome-screen__card"
        aria-labelledby="welcome-screen-title"
      >
        <header className="welcome-screen__header">
          <h1 id="welcome-screen-title" className="welcome-screen__title">
            CloudCoin Pro Edition
          </h1>
          <h2 className="welcome-screen__subtitle">Version: July 30 2025</h2>
        </header>
        
        <section className="welcome-screen__description" aria-label="Product description">
          <p>Used to Authenticate, Store and Payout CloudCoins</p>
        </section>
        
        <aside className="welcome-screen__disclaimer" aria-label="Software disclaimer">
          <p>
            This Software is provided as is with all faults, defects and errors, 
            and without warranty of any kind.
          </p>
          <p>
            Free from the CloudCoin Consortium.
          </p>
        </aside>
        
        <footer className="welcome-screen__actions">
          <button 
            className="welcome-screen__button"
            onClick={onAgree}
            type="button"
          >
            I Agree
          </button>
        </footer>
      </section>
    </main>
  );
};

export default WelcomeScreen;
