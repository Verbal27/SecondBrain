import React, { useState, useRef, useEffect } from 'react';
import './SecondBrainUI.css';

// Vite uses import.meta.env for environment variables instead of process.env
const API_BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8000';

export default function SecondBrainUI() {
  const [activeTab, setActiveTab] = useState('chat');
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m your SecondBrain assistant. Upload documents and ask me anything about them.',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState('default');
  const [collections, setCollections] = useState(['default']);
  const [newCollectionInput, setNewCollectionInput] = useState('');
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const messagesEnd = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch dynamic collections on mount
  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/collections`);
        if (response.ok) {
          const data = await response.json();
          setCollections(data.collections || ['default']);
        }
      } catch (error) {
        console.error('Failed to fetch collections:', error);
      }
    };
    fetchCollections();
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    handleFiles(files);
  };

  const handleFileInputChange = (e) => {
    handleFiles(e.target.files);
  };

  const handleFiles = (files) => {
    Array.from(files).forEach(async (file) => {
      if (!file.name.endsWith('.pdf') && !file.name.endsWith('.txt')) {
        alert('Only PDF and TXT files are supported');
        return;
      }

      const docId = Math.random().toString(36).substr(2, 9);
      setDocuments(prev => [...prev, {
        id: docId,
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2),
        status: 'UPLOADING',
        progress: 0,
        taskId: null
      }]);

      try {
        // Upload file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('collection_id', selectedCollection);

        const uploadResponse = await fetch(`${API_BASE_URL}/ingest`, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          throw new Error('Upload failed');
        }

        const uploadData = await uploadResponse.json();
        const taskId = uploadData.task_id;

        // Update document with task ID and change status to processing
        setDocuments(prev =>
          prev.map(doc =>
            doc.id === docId
              ? { ...doc, taskId, status: 'PROCESSING', progress: 100 }
              : doc
          )
        );

        // Poll for completion
        const maxAttempts = 60;
        let attempts = 0;

        const pollStatus = async () => {
          try {
            const statusResponse = await fetch(
              `${API_BASE_URL}/ingest/status/${taskId}`
            );
            const statusData = await statusResponse.json();

            setDocuments(prev =>
              prev.map(doc =>
                doc.id === docId ? { ...doc, status: statusData.status } : doc
              )
            );

            if (statusData.status === 'COMPLETED' || statusData.status === 'FAILED') {
              return;
            }

            if (attempts < maxAttempts) {
              attempts++;
              setTimeout(pollStatus, 1000);
            }
          } catch (error) {
            console.error('Status check error:', error);
            setDocuments(prev =>
              prev.map(doc =>
                doc.id === docId ? { ...doc, status: 'ERROR' } : doc
              )
            );
          }
        };

        pollStatus();
      } catch (error) {
        console.error('Upload error:', error);
        setDocuments(prev =>
          prev.map(doc =>
            doc.id === docId ? { ...doc, status: 'ERROR' } : doc
          )
        );
      }
    });
  };

  const handleAddCollection = () => {
    const newCol = newCollectionInput.trim().toLowerCase();
    if (newCol && !collections.includes(newCol)) {
      setCollections(prev => [...prev, newCol]);
      setSelectedCollection(newCol);
      setNewCollectionInput('');
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    setIsLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/chat/${sessionId}?query=${encodeURIComponent(userMessage)}&collection_id=${encodeURIComponent(selectedCollection)}`,
        {
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error('Chat request failed');
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      // Add empty assistant message
      const messageIndex = messages.length;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;

        // Update the last message with accumulated text
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1].content = fullText;
          return updated;
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request. Please try again.',
        timestamp: new Date(),
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status.toUpperCase()) {
      case 'UPLOADING':
        return '⬆';
      case 'PROCESSING':
        return '⚙';
      case 'COMPLETED':
        return '✓';
      case 'FAILED':
      case 'ERROR':
        return '✕';
      default:
        return '○';
    }
  };

  const getStatusColor = (status) => {
    switch (status.toUpperCase()) {
      case 'UPLOADING':
        return '#378ADD';
      case 'PROCESSING':
        return '#BA7517';
      case 'COMPLETED':
        return '#639922';
      case 'FAILED':
      case 'ERROR':
        return '#E24B4A';
      default:
        return '#888780';
    }
  };

  const getStatusLabel = (status) => {
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  };

  const completedDocs = documents.filter(d =>
    d.status.toUpperCase() === 'COMPLETED'
  ).length;

  return (
    <div className="secondbrain-container">
      {/* Sidebar */}
      <div className="secondbrain-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">SecondBrain</div>
          <div className="sidebar-subtitle">
            <span className="status-dot">●</span>
            {completedDocs} document{completedDocs !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="sidebar-collections">
          <div className="collections-label">Collections</div>
          {collections.map(col => (
            <button
              key={col}
              onClick={() => setSelectedCollection(col)}
              className={`collection-btn ${selectedCollection === col ? 'active' : ''}`}
            >
              {col.charAt(0).toUpperCase() + col.slice(1)}
            </button>
          ))}
          
          <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
            <input
              type="text"
              value={newCollectionInput}
              onChange={(e) => setNewCollectionInput(e.target.value)}
              placeholder="New collection..."
              onKeyPress={(e) => e.key === 'Enter' && handleAddCollection()}
              style={{ flex: 1, padding: '5px', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)', background: 'transparent', color: 'inherit' }}
            />
            <button 
              onClick={handleAddCollection}
              style={{ 
                padding: '5px 10px', 
                borderRadius: '4px', 
                border: 'none', 
                backgroundColor: 'var(--primary-color, #378ADD)', 
                color: 'white', 
                cursor: 'pointer' 
              }}
            >+</button>
          </div>
        </div>

        <div className="sidebar-footer">
          <button
            onClick={() => setActiveTab('upload')}
            className="upload-btn"
          >
            + Upload
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="secondbrain-main">
        {/* Tab Header */}
        <div className="tab-header">
          <button
            onClick={() => setActiveTab('chat')}
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          >
            Documents ({documents.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="content-area">
          {activeTab === 'chat' ? (
            <>
              {/* Messages */}
              <div className="messages-container">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`message ${msg.role}`}
                  >
                    <div className={`message-bubble ${msg.isError ? 'error' : ''}`}>
                      <p>{msg.content}</p>
                      {msg.timestamp && (
                        <span className="message-time">
                          {msg.timestamp.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="message assistant">
                    <div className="message-bubble">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEnd} />
              </div>

              {/* Input */}
              <div className="input-container">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                  placeholder="Ask about your documents..."
                  disabled={isLoading}
                  className="message-input"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !input.trim()}
                  className="send-btn"
                >
                  {isLoading ? '⟳' : 'Send'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Upload Area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`upload-area ${isDragging ? 'dragging' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />

                {documents.length === 0 ? (
                  <>
                    <div className="upload-icon">📄</div>
                    <div className="upload-title">
                      Drag files here or click to upload
                    </div>
                    <div className="upload-subtitle">
                      Supports PDF and TXT files
                    </div>
                  </>
                ) : (
                  <div className="documents-list">
                    {documents.map(doc => (
                      <div key={doc.id} className="document-item">
                        <div className="doc-info">
                          <div className="doc-name">{doc.name}</div>
                          <div className="doc-size">{doc.size} MB</div>
                        </div>
                        <div
                          className="doc-status"
                          style={{ color: getStatusColor(doc.status) }}
                        >
                          {getStatusIcon(doc.status)} {getStatusLabel(doc.status)}
                        </div>
                        {(doc.status.toUpperCase() === 'UPLOADING' || doc.status.toUpperCase() === 'PROCESSING') && (
                          <div className="progress-bar">
                            <div
                              className="progress-fill"
                              style={{ width: doc.progress + '%' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
