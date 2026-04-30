import SecondBrainUI from './SecondBrainUI';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>SecondBrain</h1>
        <p>AI-powered document intelligence</p>
      </header>
      
      <main className="app-main">
        <SecondBrainUI />
      </main>
      
      <footer className="app-footer">
        <p>SecondBrain • Document Analysis System</p>
      </footer>
    </div>
  );
}