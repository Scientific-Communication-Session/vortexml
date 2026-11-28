import React, { useEffect, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Footer from './Footer';
import { ChatProvider } from './chatbot/ChatContext';
import ChatDrawer from './chatbot/ChatDrawer';
import ChatButton from './chatbot/ChatButton';
import { TrainingSessionProvider } from '../context/TrainingSessionContext';
import SessionOverlays from './session/SessionOverlays';
import NavBar from './nav/NavBar';
import { usePageMeta } from '../pageMeta';


const Layout: React.FC = () => {
    const location = useLocation();

    usePageMeta(location.pathname);

    const isHome = location.pathname === '/';
    const isAuth = location.pathname === '/signin' || location.pathname === '/signup';
    const isFullBleed = isHome || isAuth;

    // Scroll to top on route change, or to the #anchor the link named. The
    // page is lazy, so the target may only appear a moment later.
    useEffect(() => {
        const id = decodeURIComponent(location.hash.slice(1));
        if (!id) {
            window.scrollTo(0, 0);
            return;
        }
        let tries = 0;
        let timer = 0;
        const seek = () => {
            const target = document.getElementById(id);
            if (target) target.scrollIntoView();
            else if (++tries < 20) timer = window.setTimeout(seek, 100);
        };
        seek();
        return () => window.clearTimeout(timer);
    }, [location.pathname, location.hash]);


    return (
        // Training runs outlive the page that started them, so their session
        // sits above the routed pages (and feeds the navbar pill).
        <TrainingSessionProvider>
        <div className="flex flex-col min-h-screen">
            {/* First stop for keyboards, screen readers and agents */}
            <a href="#main" className="skip-link">Skip to content</a>

            <NavBar />

            <ChatProvider>
                <main id="main" className={isFullBleed ? 'flex-grow relative' : 'main-content flex-grow'}>
                    {/* Pages are code-split (React.lazy); keep the chrome visible
                        while a route's chunk loads. */}
                    <Suspense fallback={
                        <div className="flex items-center justify-center min-h-[60vh] text-text-secondary text-sm">
                            Loading…
                        </div>
                    }>
                        <Outlet />
                    </Suspense>
                </main>
                <ChatDrawer />
                <ChatButton />
            </ChatProvider>
            <Footer />
            <SessionOverlays />
        </div>
        </TrainingSessionProvider>
    );
};

export default Layout;
