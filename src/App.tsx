import { lazy, Suspense } from 'react';
import Dashboard from '@/pages/Dashboard';

// Dev-only design gallery. `?gallery` renders it instead of the app; the guard
// on `import.meta.env.DEV` also strips the import in production so the gallery
// is not bundled with the shipped app.
const DesignGallery = import.meta.env.DEV
    ? lazy(() => import('@/pages/DesignGallery'))
    : null;

function App() {
    if (import.meta.env.DEV && DesignGallery && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('gallery')) {
        return (
            <Suspense fallback={null}>
                <DesignGallery />
            </Suspense>
        );
    }
    return <Dashboard />;
}

export default App;
