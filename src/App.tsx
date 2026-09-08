import Dashboard from '@/pages/Dashboard';

// Single-user, local-only: there is no account to sign into and no route to
// guard, so the app opens straight into the library. Routing can come back if
// and when there is a second screen that needs a URL.
function App() {
    return <Dashboard />;
}

export default App;
