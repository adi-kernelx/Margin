
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import { useAuthStore } from '@/lib/auth-store';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, isGuest, loading } = useAuthStore();
    const location = useLocation();

    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!user && !isGuest) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuthStore();

    if (loading) return null; // Spinner handled in ProtectedRoute or global? 
    // Ideally we show nothing or spinner. 

    if (user) {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}

import SharedLinkHandler from '@/pages/SharedLinkHandler';

function App() {
    const { initialize } = useAuthStore();

    useEffect(() => {
        const unsubscribe = initialize();
        return () => unsubscribe();
    }, [initialize]);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/s/:shareId" element={<SharedLinkHandler />} />
                <Route path="/login" element={
                    <PublicRoute>
                        <Login />
                    </PublicRoute>
                } />
                <Route path="/signup" element={
                    <PublicRoute>
                        <Signup />
                    </PublicRoute>
                } />
                <Route path="/" element={
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                } />
            </Routes>
        </BrowserRouter>
    );
}

export default App;

