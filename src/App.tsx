import "./App.css";
import Sidebar from "./components/Sidebar/Sidebar";

function App() {
  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <h1>My Collection</h1>
        <p>Your physical music collection will appear here.</p>
      </main>
    </div>
  );
}

export default App;