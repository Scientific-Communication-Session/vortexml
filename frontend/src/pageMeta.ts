import { useEffect } from 'react';
import { SITE } from './site';

// Title and description per route, for the browser tab, bookmarks, search
// engines that render JavaScript, and agents reading the page. (Link-preview
// crawlers don't run JavaScript: they use the static tags in index.html.)
const DEFAULT = {
    title: 'VortexML — Train neural networks in your browser, with an AI tutor',
    description: 'Upload a table, let an AI co-pilot design the network, watch it train live, and ask the model '
        + 'questions. Free, no code, no installation.',
};

const PAGES: Record<string, { title: string; description: string }> = {
    '/demo': {
        title: 'Live demo — train a real model in one click',
        description: 'Pick a real dataset and watch a neural network train on it live, then try the model on real rows. No account needed.',
    },
    '/tutorial': {
        title: 'Tutorial — your first model in ten minutes',
        description: 'A step-by-step guide with recordings: upload a dataset, let the AI design the network, train it and ask it questions.',
    },
    '/dataset': {
        title: 'Dataset — upload and choose what to predict',
        description: 'Upload a CSV, Excel, JSON or Parquet file, preview it, and mark the feature columns and the target.',
    },
    '/architect': {
        title: 'Architect — design the network',
        description: 'Choose one of ten neural network types and its settings, or let the AI co-pilot configure it from a plain-language description.',
    },
    '/training': {
        title: 'Training — live loss and accuracy',
        description: 'Start or queue a training run, watch it live, and get an AI explanation of the result. Runs continue when the tab is closed.',
    },
    '/predict': {
        title: 'Predict — ask your trained model',
        description: 'Enter new values and get a prediction, with confidence, from a model you trained.',
    },
    '/assistant': {
        title: 'Assistant — ask your documents',
        description: 'Upload documents into a knowledge base and ask questions; answers cite the passages they came from.',
    },
    '/chat': {
        title: 'Chat — talk to a language model',
        description: 'A saved, streaming conversation with a language model, optionally grounded in your documents.',
    },
    '/leaderboard': {
        title: 'Leaderboard — compare your training runs',
        description: 'Rank your saved models and overlay their validation loss and accuracy curves.',
    },
    '/learn': {
        title: 'Learn — a machine learning roadmap',
        description: 'Eight milestones from mathematics to deployment, and written courses on neural network architectures.',
    },
    '/courses': {
        title: 'Courses — neural network architectures explained',
        description: 'Written lessons on MLPs, convolutional and recurrent networks, autoencoders, ResNets, Transformers and more.',
    },
    '/profile': { title: 'Your profile', description: 'Your saved projects, linked devices and experience mode.' },
    '/signin': { title: 'Sign in', description: 'Sign in to your VortexML account.' },
    '/signup': {
        title: 'Create a free account',
        description: 'A free account adds saved models, predictions, the AI tutor and co-pilot, and background training you can follow from any browser.',
    },
    '/survey': { title: 'A few questions', description: 'Three questions that tailor VortexML to your experience.' },
    '/about': {
        title: 'About VortexML',
        description: 'What VortexML is, who makes it, the award it won, and how to get in touch.',
    },
    '/terms': { title: 'Terms of Service', description: 'The rules for using VortexML.' },
    '/privacy': {
        title: 'Privacy Policy',
        description: 'What data VortexML collects, why, who it is shared with, how long it is kept, and your rights.',
    },
    '/cookies': {
        title: 'Cookie Policy',
        description: 'The one essential cookie VortexML sets, and what it stores in your browser.',
    },
};

const setMeta = (selector: string, attr: string, value: string) => {
    document.head.querySelector(selector)?.setAttribute(attr, value);
};

/** Keep the document title, description and canonical URL in step with the route. */
export function usePageMeta(pathname: string) {
    useEffect(() => {
        const path = pathname.replace(/\/+$/, '') || '/';
        const page = PAGES[path] ?? (path.startsWith('/courses/') ? PAGES['/courses'] : undefined);
        const title = page ? `${page.title} · ${SITE.name}` : DEFAULT.title;
        const description = page?.description ?? DEFAULT.description;
        const url = `${SITE.url}${path === '/' ? '/' : path}`;

        document.title = title;
        setMeta('meta[name="description"]', 'content', description);
        setMeta('link[rel="canonical"]', 'href', url);
        setMeta('meta[property="og:url"]', 'content', url);
        setMeta('meta[property="og:title"]', 'content', page ? title : 'VortexML — Intelligence, Simplified');
        setMeta('meta[property="og:description"]', 'content', description);
    }, [pathname]);
}
