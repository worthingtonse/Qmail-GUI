import React, { useState, useEffect } from 'react';
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
      <div className="diceware-screen">
        <div className="diceware-main-container">
          <div className="diceware-loading">
            <h3>Loading EFF Wordlist...</h3>
            <p>Please wait while we load the diceware dictionary.</p>
          </div>
        </div>
      </div>
    );
  }

  if (showPdfOptions) {
    return (
      <div className="diceware-screen">
        <div className="diceware-main-container">
          <div className="diceware-pdf-screen">
            <div className="diceware-pdf-header">
              <h3>Passphrase Created Successfully!</h3>
              <p>Your secure passphrase is ready. We strongly recommend creating a backup before proceeding.</p>
            </div>

            <div className="diceware-passphrase-display">
              <h4>Your Passphrase:</h4>
              <div className="diceware-passphrase-text">{userPassphrase}</div>
            </div>

            <div className="diceware-backup-section">
              <h4>Backup Options (Highly Recommended)</h4>
              <p>
                Create a backup of your passphrase before proceeding. If you lose your passphrase, your CloudCoins cannot be recovered.
              </p>
              
              <div className="diceware-backup-buttons">
                <button onClick={generatePDF} className="btn-backup">
                  <Download size={18} />
                  <span>Download HTML Backup</span>
                </button>
                
                <button onClick={printPassphrase} className="btn-backup secondary">
                  <Printer size={18} />
                  <span>Print Backup</span>
                </button>

                <button onClick={openCloudStorageInfo} className="btn-backup info">
                  <Cloud size={18} />
                  <span>Cloud Storage Tips</span>
                </button>
              </div>
              
              <p className="diceware-backup-tip">
                <strong>Tip:</strong> Store physical copies in multiple secure locations (safe, safety deposit box, etc.)
              </p>
            </div>

            <div className="diceware-final-actions">
              <div className="diceware-action-buttons">
                <button onClick={() => setShowPdfOptions(false)} className="btn-back">
                  <ArrowLeft size={18} style={{ marginRight: '8px' }} />
                  Back to Edit
                </button>
                
                <button onClick={proceedWithoutBackup} className="btn-continue">
                  Continue with This Passphrase
                </button>
              </div>
              
              <p className="diceware-final-note">
                Make sure you've saved a backup before continuing.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="diceware-screen">
      <div className="diceware-main-container">
        <div className="diceware-header">
          <h3>Create Your Secure Passphrase</h3>
          <p>Use a physical die to roll 25 times. Enter each result in the grid below, then generate your words.</p>
        </div>

        <div className="diceware-instructions">
          <h4>
            <Dices size={20} />
            How to Use Physical Dice
          </h4>
          <ol>
            <li>Get a physical 6-sided die</li>
            <li>Roll the die and enter the result (1-6) in the first empty cell</li>
            <li>Continue rolling and filling cells from left to right, top to bottom</li>
            <li>When a row is complete (5 dice values), click "Generate Word" for that row</li>
            <li>Repeat until all 5 rows are complete</li>
            <li>Create your passphrase using the generated words</li>
          </ol>
        </div>

        <div className="diceware-dice-section">
          <div className="diceware-section-header">
            <h4>Dice Grid (5 rows × 5 columns):</h4>
            <div className="diceware-button-group">
              <button onClick={autoGenerateAll} className="btn-auto-generate">
                <Dices size={18} />
                Auto Generate All
              </button>
              <button onClick={clearGrid} className="btn-clear">
                Clear All
              </button>
            </div>
          </div>
          
          {diceGrid.map((row, rowIndex) => (
            <div key={rowIndex} className="diceware-row">
              <div className="diceware-row-inputs">
                <span className="diceware-row-label">Row {rowIndex + 1}:</span>
                {row.map((cell, colIndex) => (
                  <input
                    key={`cell-${rowIndex}-${colIndex}`}
                    type="text"
                    value={cell}
                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                    maxLength="1"
                    className={`diceware-dice-input ${cell ? 'filled' : ''}`}
                    placeholder="?"
                  />
                ))}
              </div>
              
              <button
                onClick={() => generateWordForRow(rowIndex)}
                disabled={!isRowComplete(rowIndex)}
                className="btn-generate-word"
              >
                Generate Word
              </button>
              
              {generatedWords[rowIndex] && (
                <div className={`diceware-generated-word ${generatedWords[rowIndex].includes('not found') ? 'error' : ''}`}>
                  → {generatedWords[rowIndex]}
                </div>
              )}
            </div>
          ))}
        </div>

        {generatedWords.filter(Boolean).length > 0 && (
          <div className="diceware-words-display">
            <h4>Your Words:</h4>
            <div className="diceware-words-list">
              {generatedWords.filter(word => word && !word.includes('not found')).join(', ')}
            </div>
          </div>
        )}

        {allRowsComplete() && generatedWords.filter(word => word && !word.includes('not found')).length === 5 && (
          <div className="diceware-passphrase-card">
            <h4>Create Your Passphrase</h4>
            <p>
              Create a sentence using at least 2 of your words. Minimum 16 characters. Include punctuation if desired.
              Case doesn't matter, but don't end with spaces.
            </p>
            <p>
              Example: "I am fasting because the food here is sludge."
            </p>
            
            <textarea
              value={userPassphrase}
              onChange={(e) => setUserPassphrase(e.target.value)}
              placeholder="Enter your passphrase using your words..."
              className="diceware-textarea"
            />
            
            <div className={`diceware-char-count ${userPassphrase.length >= 16 ? 'valid' : ''}`}>
              Length: {userPassphrase.length} characters 
              {userPassphrase.length < 16 && ' (need at least 16)'}
            </div>
            
            {userPassphrase.length >= 16 && (
              <button onClick={handleCreatePassphrase} className="btn-use-passphrase">
                Use This Passphrase
              </button>
            )}
          </div>
        )}

        <div className="diceware-warning">
          <p>
            <strong>⚠ Important:</strong> If you lose your passphrase, you will lose your coins. Lost coins cannot be recovered.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DicewarePasswordCreator;