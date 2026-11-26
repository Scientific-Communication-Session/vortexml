import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider } from './context/AuthContext';

// Code-split each page into its own chunk so the initial load doesn't ship the
// whole app (chart.js, KaTeX, react-markdown, etc.) up front. The Suspense
// boundary lives in Layout, around the routed <Outlet />.
const Home = lazy(() => import('./pages/Home'));
const Demo = lazy(() => import('./pages/Demo'));
const Tutorial = lazy(() => import('./pages/Tutorial'));
const Dataset = lazy(() => import('./pages/Dataset'));
const Architect = lazy(() => import('./pages/Architect'));
const Training = lazy(() => import('./pages/Training'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Playground = lazy(() => import('./pages/Playground'));
const Rag = lazy(() => import('./pages/Rag'));
const Chat = lazy(() => import('./pages/Chat'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const Learn = lazy(() => import('./pages/Learn'));
const Signin = lazy(() => import('./pages/Signin'));
const Signup = lazy(() => import('./pages/Signup'));
const Survey = lazy(() => import('./pages/Survey'));
const Profile = lazy(() => import('./pages/Profile'));
const About = lazy(() => import('./pages/legal/About'));
const Terms = lazy(() => import('./pages/legal/Terms'));
const Privacy = lazy(() => import('./pages/legal/Privacy'));
const Cookies = lazy(() => import('./pages/legal/Cookies'));

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="signin" element={<Signin />} />
          <Route path="signup" element={<Signup />} />
          <Route path="survey" element={<Survey />} />
          <Route path="profile" element={<Profile />} />
          <Route path="about" element={<About />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="cookies" element={<Cookies />} />
          <Route path="demo" element={<Demo />} />
          <Route path="tutorial" element={<Tutorial />} />
          <Route path="learn" element={<Learn />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:id" element={<CourseDetail />} />
          <Route path="dataset" element={<Dataset />} />
          <Route path="architect" element={<Architect />} />
          <Route path="training" element={<Training />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="predict" element={<Playground />} />
          <Route path="assistant" element={<Rag />} />
          <Route path="chat" element={<Chat />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
};

export default App;
