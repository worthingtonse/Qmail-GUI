/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { Dices, Download, Printer, Cloud, ArrowLeft } from 'lucide-react';
import './DicewarePasswordCreator.css';

const DicewarePasswordCreator = ({ onPasswordCreated }) => {
  const [diceGrid, setDiceGrid] = useState(Array(5).fill().map(() => Array(5).fill('')));
  const [generatedWords, setGeneratedWords] = useState([]);
  const [userPassphrase, setUserPassphrase] = useState('');
  const [effWordList, setEffWordList] = useState({});
  const [isLoadingWordlist, setIsLoadingWordlist] = useState(true);
  const [showPdfOptions, setShowPdfOptions] = useState(false);

  // Load EFF wordlist 
  useEffect(() => {
    const loadWordList = async () => {
      try {
        setIsLoadingWordlist(true);
        
        let fileContent;
        
        if (window.electronAPI && window.electronAPI.readFile) {
          fileContent = await window.electronAPI.readFile('eff_large_wordlist.txt');
        } else {
          const response = await fetch('/eff_large_wordlist.txt');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          fileContent = await response.text();
        }
        
        const wordDict = {};
        const lines = fileContent.trim().split('\n');
        
        lines.forEach(line => {
          const [diceCode, word] = line.trim().split('\t');
          if (diceCode && word) {
            wordDict[diceCode] = word;
          }
        });
        
        setEffWordList(wordDict);
        setIsLoadingWordlist(false);
        console.log(`Loaded ${Object.keys(wordDict).length} words from EFF wordlist`);
      } catch (error) {
        console.error('Error loading EFF wordlist:', error);
        setIsLoadingWordlist(false);
        setEffWordList({
          '11111': 'abacus', '22222': 'composite', '33333': 'fasting', 
          '44444': 'overtone', '55555': 'wobbly', '66666': 'sludge',
          '35362': 'puzzle', '12345': 'example', '54321': 'reverse',
          '13579': 'pattern', '24681': 'sequence'
        });
      }
    };

    loadWordList();
  }, []);

  const handleCellChange = (row, col, value) => {
    if (value === '' || (value >= '1' && value <= '6' && value.length === 1)) {
      const newGrid = diceGrid.map((gridRow, rowIdx) => 
        gridRow.map((cell, colIdx) => {
          if (rowIdx === row && colIdx === col) {
            return value;
          }
          return cell;
        })
      );
      setDiceGrid(newGrid);
    }
  };

  const generateWordForRow = (rowIndex) => {
    const rowData = diceGrid[rowIndex];
    
    if (!rowData.every(cell => cell !== '')) {
      alert(`Please fill all dice values for row ${rowIndex + 1} before generating the word.`);
      return;
    }
    
    const diceString = rowData.join('');
    const word = effWordList[diceString];
    
    if (word) {
      const newWords = [...generatedWords];
      newWords[rowIndex] = word;
      setGeneratedWords(newWords);
    } else {
      console.warn(`Word not found for dice combination: ${diceString}`);
      const newWords = [...generatedWords];
      newWords[rowIndex] = `[${diceString}] - word not found`;
      setGeneratedWords(newWords);
    }
  };

  const generatePDF = () => {
    const currentDate = new Date().toLocaleDateString();
    const currentTime = new Date().toLocaleTimeString();
    
    const pdfContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>CloudCoin Diceware Passphrase Backup</title>
        <style>
          body { 
            font-family: 'Inter', Arial, sans-serif; 
            margin: 40px; 
            line-height: 1.6;
            color: #333;
          }
          .header { 
            text-align: center; 
            border-bottom: 2px solid #a78bfa; 
            padding-bottom: 20px; 
            margin-bottom: 30px;
          }
          .section { 
            margin-bottom: 25px; 
            padding: 15px;
            border-left: 4px solid #a78bfa;
            background-color: #f8f9ff;
          }
          .dice-grid {
            font-family: 'Courier New', monospace;
            background-color: #fff;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .warning {
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
          }
          .passphrase {
            font-size: 18px;
            font-weight: bold;
            color: #a78bfa;
            background-color: #fff;
            padding: 15px;
            border: 2px solid #a78bfa;
            border-radius: 5px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>CloudCoin Diceware Passphrase Backup</h1>
          <p>Generated on: ${currentDate} at ${currentTime}</p>
        </div>

        <div class="section">
          <h3>Dice Roll Results</h3>
          <div class="dice-grid">
            ${diceGrid.map((row, idx) => 
              `Row ${idx + 1}: ${row.join(' ')} → ${generatedWords[idx] || 'Not generated'}`
            ).join('<br>')}
          </div>
        </div>

        <div class="section">
          <h3>Generated Words</h3>
          <p><strong>${generatedWords.filter(word => word && !word.includes('not found')).join(', ')}</strong></p>
        </div>

        <div class="section">
          <h3>Your Secure Passphrase</h3>
          <div class="passphrase">${userPassphrase}</div>
        </div>

        <div class="warning">
          <h4>CRITICAL SECURITY INFORMATION</h4>
          <ul>
            <li><strong>Store this document securely</strong> - Anyone with access to this passphrase can access your CloudCoins</li>
            <li><strong>Make multiple backups</strong> - Store copies in different secure locations</li>
            <li><strong>Never share digitally</strong> - Avoid storing in email, cloud storage, or messaging apps unless encrypted</li>
            <li><strong>Consider physical storage</strong> - Print and store in a safe, safety deposit box, or fireproof safe</li>
            <li><strong>Recovery is impossible</strong> - If lost, your CloudCoins cannot be recovered</li>
          </ul>
        </div>

        <div style="margin-top: 40px; text-align: center; color: #666; font-size: 12px;">
          <p>This backup was generated using Diceware methodology for maximum security.</p>
          <p>Keep this document private and secure.</p>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([pdfContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CloudCoin-Passphrase-Backup-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const printPassphrase = () => {
    const currentDate = new Date().toLocaleDateString();
    const currentTime = new Date().toLocaleTimeString();
    
    const printContent = `
      <div style="font-family: 'Inter', Arial, sans-serif; padding: 20px;">
        <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px;">
          <h1>CloudCoin Passphrase Backup</h1>
          <p>Generated: ${currentDate} ${currentTime}</p>
        </div>
        
        <div style="margin-bottom: 25px;">
          <h3>Dice Rolls:</h3>
          ${diceGrid.map((row, idx) => 
            `<div>Row ${idx + 1}: ${row.join(' ')} → ${generatedWords[idx] || 'Not generated'}</div>`
          ).join('')}
        </div>

        <div style="margin-bottom: 25px;">
          <h3>Generated Words:</h3>
          <p style="font-weight: bold;">${generatedWords.filter(word => word && !word.includes('not found')).join(', ')}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <h3>Your Passphrase:</h3>
          <div style="font-size: 18px; font-weight: bold; padding: 15px; border: 2px solid #333; background-color: #f9f9f9;">
            ${userPassphrase}
          </div>
        </div>

        <div style="background-color: #f0f0f0; padding: 15px; border: 1px solid #ccc; margin-top: 20px;">
          <h4>SECURITY WARNING</h4>
          <ul>
            <li>Store this document in a secure location</li>
            <li>Make multiple copies and store separately</li>
            <li>Never share or store digitally without encryption</li>
            <li>If lost, your CloudCoins cannot be recovered</li>
          </ul>
        </div>
      </div>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  const openCloudStorageInfo = () => {
    alert(`Cloud Storage Security Tips:

1. Create a password-protected ZIP file containing your backup
2. Use a different password for the ZIP than your passphrase
3. Upload to your preferred cloud service:
   - Google Drive
   - Dropbox
   - OneDrive
   - iCloud
   
4. For extra security, consider:
   - SpiderOak (zero-knowledge encryption)
   - Tresorit (encrypted cloud storage)
   - Cryptomator (client-side encryption)

NEVER store your passphrase in plain text in cloud storage!`);
  };

  const handleCreatePassphrase = () => {
    if (userPassphrase.length >= 16 && onPasswordCreated) {
      setShowPdfOptions(true);
    }
  };

  const proceedWithoutBackup = () => {
    if (onPasswordCreated) {
      onPasswordCreated(userPassphrase);
    }
  };

  const isRowComplete = (rowIndex) => {
    return diceGrid[rowIndex].every(cell => cell !== '');
  };

  const allRowsComplete = () => {
    return diceGrid.every(row => row.every(cell => cell !== ''));
  };

  const autoGenerateAll = () => {
    const newGrid = Array(5).fill().map(() => 
      Array(5).fill().map(() => Math.floor(Math.random() * 6) + 1).map(String)
    );
    
    setDiceGrid(newGrid);
    
    const newWords = [];
    newGrid.forEach((row) => {
      const diceString = row.join('');
      const word = effWordList[diceString];
      
      if (word) {
        newWords.push(word);
      } else {
        console.warn(`Word not found for dice combination: ${diceString}`);
        newWords.push(`[${diceString}] - word not found`);
      }
    });
    
    setGeneratedWords(newWords);
  };

  const clearGrid = () => {
    setDiceGrid(Array(5).fill().map(() => Array(5).fill('')));
    setGeneratedWords([]);
    setUserPassphrase('');
    setShowPdfOptions(false);
  };

  if (isLoadingWordlist) {
    return (
      <main className="diceware-password-creator">
        <section className="diceware-password-creator__card" aria-busy="true">
          <div className="diceware-password-creator__loading" role="status">
            <h3>Loading EFF Wordlist...</h3>
            <p>Please wait while we load the diceware dictionary.</p>
          </div>
        </section>
      </main>
    );
  }

  if (showPdfOptions) {
    return (
      <main className="diceware-password-creator">
        <section className="diceware-password-creator__card">
          <section className="diceware-password-creator__backup-flow">
            <header className="diceware-password-creator__backup-header">
              <h3>Passphrase Created Successfully!</h3>
              <p>Your secure passphrase is ready. We strongly recommend creating a backup before proceeding.</p>
            </header>

            <section className="diceware-password-creator__passphrase-display">
              <h4>Your Passphrase:</h4>
              <div className="diceware-password-creator__passphrase-text">{userPassphrase}</div>
            </section>

            <section className="diceware-password-creator__backup-section">
              <h4>Backup Options (Highly Recommended)</h4>
              <p>
                Create a backup of your passphrase before proceeding. If you lose your passphrase, your CloudCoins cannot be recovered.
              </p>
              
              <div className="diceware-password-creator__backup-buttons">
                <button
                  type="button"
                  onClick={generatePDF}
                  className="diceware-password-creator__button diceware-password-creator__button--backup"
                >
                  <Download size={18} />
                  <span>Download HTML Backup</span>
                </button>
                
                <button
                  type="button"
                  onClick={printPassphrase}
                  className="diceware-password-creator__button diceware-password-creator__button--backup diceware-password-creator__button--backup-secondary"
                >
                  <Printer size={18} />
                  <span>Print Backup</span>
                </button>

                <button
                  type="button"
                  onClick={openCloudStorageInfo}
                  className="diceware-password-creator__button diceware-password-creator__button--backup diceware-password-creator__button--backup-info"
                >
                  <Cloud size={18} />
                  <span>Cloud Storage Tips</span>
                </button>
              </div>
              
              <p className="diceware-password-creator__backup-tip">
                <strong>Tip:</strong> Store physical copies in multiple secure locations (safe, safety deposit box, etc.)
              </p>
            </section>

            <footer className="diceware-password-creator__footer">
              <div className="diceware-password-creator__action-buttons">
                <button
                  type="button"
                  onClick={() => setShowPdfOptions(false)}
                  className="diceware-password-creator__button diceware-password-creator__button--back"
                >
                  <ArrowLeft size={18} className="diceware-password-creator__button-icon" />
                  Back to Edit
                </button>
                
                <button
                  type="button"
                  onClick={proceedWithoutBackup}
                  className="diceware-password-creator__button diceware-password-creator__button--continue"
                >
                  Continue with This Passphrase
                </button>
              </div>
              
              <p className="diceware-password-creator__final-note">
                Make sure you&apos;ve saved a backup before continuing.
              </p>
            </footer>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="diceware-password-creator">
      <section className="diceware-password-creator__card">
        <header className="diceware-password-creator__header">
          <h3>Create Your Secure Passphrase</h3>
          <p>Use a physical die to roll 25 times. Enter each result in the grid below, then generate your words.</p>
        </header>

        <section className="diceware-password-creator__instructions">
          <h4>
            <Dices size={20} />
            How to Use Physical Dice
          </h4>
          <ol>
            <li>Get a physical 6-sided die</li>
            <li>Roll the die and enter the result (1-6) in the first empty cell</li>
            <li>Continue rolling and filling cells from left to right, top to bottom</li>
            <li>When a row is complete (5 dice values), click &quot;Generate Word&quot; for that row</li>
            <li>Repeat until all 5 rows are complete</li>
            <li>Create your passphrase using the generated words</li>
          </ol>
        </section>

        <section className="diceware-password-creator__dice-section">
          <header className="diceware-password-creator__section-header">
            <h4>Dice Grid (5 rows × 5 columns):</h4>
            <div className="diceware-password-creator__button-group">
              <button
                type="button"
                onClick={autoGenerateAll}
                className="diceware-password-creator__button diceware-password-creator__button--auto-generate"
              >
                <Dices size={18} />
                Auto Generate All
              </button>
              <button
                type="button"
                onClick={clearGrid}
                className="diceware-password-creator__button diceware-password-creator__button--clear"
              >
                Clear All
              </button>
            </div>
          </header>
          
          {diceGrid.map((row, rowIndex) => (
            <div key={rowIndex} className="diceware-password-creator__row">
              <div className="diceware-password-creator__row-inputs">
                <span className="diceware-password-creator__row-label">Row {rowIndex + 1}:</span>
                {row.map((cell, colIndex) => (
                  <input
                    key={`cell-${rowIndex}-${colIndex}`}
                    type="text"
                    inputMode="numeric"
                    aria-label={`Row ${rowIndex + 1}, die ${colIndex + 1}`}
                    value={cell}
                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                    maxLength="1"
                    className={`diceware-password-creator__dice-input${cell ? ' diceware-password-creator__dice-input--filled' : ''}`}
                    placeholder="?"
                  />
                ))}
              </div>
              
              <button
                type="button"
                onClick={() => generateWordForRow(rowIndex)}
                disabled={!isRowComplete(rowIndex)}
                className="diceware-password-creator__button diceware-password-creator__button--generate-word"
              >
                Generate Word
              </button>
              
              {generatedWords[rowIndex] && (
                <div className={`diceware-password-creator__generated-word${generatedWords[rowIndex].includes('not found') ? ' diceware-password-creator__generated-word--error' : ''}`}>
                  → {generatedWords[rowIndex]}
                </div>
              )}
            </div>
          ))}
        </section>

        {generatedWords.filter(Boolean).length > 0 && (
          <section className="diceware-password-creator__words-display">
            <h4>Your Words:</h4>
           <div className="diceware-password-creator__words-list">
              {generatedWords.filter(word => word && !word.includes('not found')).join(', ')}
            </div>
          </section>
        )}

        {allRowsComplete() && generatedWords.filter(word => word && !word.includes('not found')).length === 5 && (
          <section className="diceware-password-creator__passphrase-card">
            <h4>Create Your Passphrase</h4>
            <p>
              Create a sentence using at least 2 of your words. Minimum 16 characters. Include punctuation if desired.
              Case doesn&apos;t matter, but don&apos;t end with spaces.
            </p>
            <p>
              Example: &quot;I am fasting because the food here is sludge.&quot;
            </p>
            
            <textarea
              value={userPassphrase}
              onChange={(e) => setUserPassphrase(e.target.value)}
              placeholder="Enter your passphrase using your words..."
              className="diceware-password-creator__textarea"
            />
            
            <div className={`diceware-password-creator__char-count${userPassphrase.length >= 16 ? ' diceware-password-creator__char-count--valid' : ''}`}>
              Length: {userPassphrase.length} characters 
              {userPassphrase.length < 16 && ' (need at least 16)'}
            </div>
            
            {userPassphrase.length >= 16 && (
              <button
                type="button"
                onClick={handleCreatePassphrase}
                className="diceware-password-creator__button diceware-password-creator__button--use-passphrase"
              >
                Use This Passphrase
              </button>
            )}
          </section>
        )}

        <aside className="diceware-password-creator__warning">
          <p>
            <strong>⚠ Important:</strong> If you lose your passphrase, you will lose your coins. Lost coins cannot be recovered.
          </p>
        </aside>
      </section>
    </main>
  );
};

export default DicewarePasswordCreator;
