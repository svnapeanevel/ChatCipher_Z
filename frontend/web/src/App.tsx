import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ChatContact {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  unread: number;
  isOnline: boolean;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface ChatMessage {
  id: string;
  contactId: string;
  content: string;
  timestamp: number;
  isEncrypted: boolean;
  isOwn: boolean;
  status: 'sent' | 'delivered' | 'read';
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContactData, setNewContactData] = useState({ name: "", message: "" });
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadContacts();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (action: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${action}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadContacts = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const contactsList: ChatContact[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          contactsList.push({
            id: businessId,
            name: businessData.name,
            lastMessage: businessData.description,
            timestamp: Number(businessData.timestamp),
            unread: Math.floor(Math.random() * 5),
            isOnline: Math.random() > 0.5,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading contact data:', e);
        }
      }
      
      setContacts(contactsList);
      addToHistory(`Loaded ${contactsList.length} contacts`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load contacts" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createContact = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContact(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating contact with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const messageValue = parseInt(newContactData.message) || 0;
      const businessId = `contact-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, messageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContactData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 100),
        Math.floor(Math.random() * 100),
        "Initial encrypted message"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contact created successfully!" });
      addToHistory(`Created new contact: ${newContactData.name}`);
      
      await loadContacts();
      setShowNewContactModal(false);
      setNewContactData({ name: "", message: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingContact(false); 
    }
  };

  const sendMessage = async () => {
    if (!isConnected || !address || !selectedContact || !newMessage.trim()) return;
    
    setSendingMessage(true);
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const messageValue = parseInt(newMessage) || 0;
      const businessId = `message-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, messageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        selectedContact.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Date.now(),
        messageValue,
        `Message to ${selectedContact.name}`
      );
      
      await tx.wait();
      
      const newMsg: ChatMessage = {
        id: businessId,
        contactId: selectedContact.id,
        content: newMessage,
        timestamp: Date.now(),
        isEncrypted: true,
        isOwn: true,
        status: 'sent'
      };
      
      setMessages(prev => [...prev, newMsg]);
      setNewMessage("");
      addToHistory(`Sent encrypted message to ${selectedContact.name}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Message sent with FHE encryption!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to send message" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setSendingMessage(false);
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadContacts();
      
      addToHistory(`Decrypted data for ${businessId}`);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        await loadContacts();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        addToHistory("Checked FHE system availability");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const contactMessages = messages.filter(msg => 
    selectedContact && msg.contactId === selectedContact.id
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ChatCipher 🔐</h1>
            <span>FHE Secure Messaging</span>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Start Secure Chatting</h2>
            <p>Experience fully homomorphic encryption for private messaging</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure chat...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>ChatCipher 🔐</h1>
          <span>FHE Encrypted Messaging</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check FHE Status
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-layout">
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
            <button 
              onClick={() => setShowNewContactModal(true)}
              className="new-contact-btn"
            >
              + New Contact
            </button>
          </div>

          <div className="contacts-list">
            {filteredContacts.map(contact => (
              <div
                key={contact.id}
                className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                onClick={() => setSelectedContact(contact)}
              >
                <div className="contact-avatar">
                  <div className="avatar-img">{contact.name.charAt(0)}</div>
                  <div className={`online-status ${contact.isOnline ? 'online' : 'offline'}`}></div>
                </div>
                <div className="contact-info">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-lastmsg">{contact.lastMessage}</div>
                </div>
                <div className="contact-meta">
                  <div className="contact-time">
                    {new Date(contact.timestamp * 1000).toLocaleTimeString()}
                  </div>
                  {contact.unread > 0 && (
                    <div className="unread-badge">{contact.unread}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="stats-panel">
              <h4>Chat Stats</h4>
              <div className="stat-item">
                <span>Contacts:</span>
                <span>{contacts.length}</span>
              </div>
              <div className="stat-item">
                <span>Online:</span>
                <span>{contacts.filter(c => c.isOnline).length}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="chat-area">
          {selectedContact ? (
            <>
              <div className="chat-header">
                <div className="chat-partner">
                  <div className="partner-avatar">
                    {selectedContact.name.charAt(0)}
                    <div className={`partner-status ${selectedContact.isOnline ? 'online' : 'offline'}`}></div>
                  </div>
                  <div className="partner-info">
                    <div className="partner-name">{selectedContact.name}</div>
                    <div className="partner-status-text">
                      {selectedContact.isOnline ? 'Online' : 'Offline'}
                    </div>
                  </div>
                </div>
                <div className="chat-actions">
                  <button onClick={() => decryptData(selectedContact.id)} className="decrypt-btn">
                    🔓 Verify Decryption
                  </button>
                </div>
              </div>

              <div className="messages-container">
                {contactMessages.map(message => (
                  <div key={message.id} className={`message ${message.isOwn ? 'own' : 'other'}`}>
                    <div className="message-bubble">
                      <div className="message-content">
                        {message.isEncrypted && <span className="encrypted-icon">🔒</span>}
                        {message.content}
                      </div>
                      <div className="message-time">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="message-input-area">
                <input
                  type="number"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Enter numeric message (FHE encrypted integer)..."
                  className="message-input"
                />
                <button 
                  onClick={sendMessage}
                  disabled={sendingMessage || !newMessage.trim()}
                  className="send-btn"
                >
                  {sendingMessage ? '🔒 Encrypting...' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <div className="no-chat-selected">
              <div className="welcome-message">
                <h2>Welcome to ChatCipher</h2>
                <p>Select a contact to start encrypted messaging</p>
                <div className="fhe-features">
                  <div className="feature">
                    <span className="feature-icon">🔐</span>
                    <span>Fully Homomorphic Encryption</span>
                  </div>
                  <div className="feature">
                    <span className="feature-icon">⚡</span>
                    <span>Real-time Encrypted Messaging</span>
                  </div>
                  <div className="feature">
                    <span className="feature-icon">🛡️</span>
                    <span>Server-Side Spam Filtering</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="history-panel">
          <h3>Operation History</h3>
          <div className="history-list">
            {operationHistory.map((entry, index) => (
              <div key={index} className="history-entry">
                {entry}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNewContactModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Add New Contact</h2>
              <button onClick={() => setShowNewContactModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Contact Name</label>
                <input
                  type="text"
                  value={newContactData.name}
                  onChange={(e) => setNewContactData({...newContactData, name: e.target.value})}
                  placeholder="Enter contact name..."
                />
              </div>
              <div className="form-group">
                <label>Initial Message (Numeric)</label>
                <input
                  type="number"
                  value={newContactData.message}
                  onChange={(e) => setNewContactData({...newContactData, message: e.target.value})}
                  placeholder="Enter numeric message..."
                />
                <div className="input-hint">FHE encrypted integer only</div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowNewContactModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createContact}
                disabled={creatingContact || !newContactData.name || !newContactData.message}
                className="confirm-btn"
              >
                {creatingContact ? 'Creating...' : 'Create Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === 'success' ? '✓' : 
               transactionStatus.status === 'error' ? '✕' : '⏳'}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


