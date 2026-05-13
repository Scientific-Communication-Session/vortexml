import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dataset from './pages/Dataset';
import Architect from './pages/Architect';
import Training from './pages/Training';
import Courses from './pages/Courses';
import CourseDetail from './pages/CourseDetail';
import Learn from './pages/Learn';
import Signin from './pages/Signin';
import Signup from './pages/Signup';
import Survey from './pages/Survey';
import Profile from './pages/Profile';
import { AuthProvider } from './context/AuthContext';

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
          <Route path="learn" element={<Learn />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:id" element={<CourseDetail />} />
          <Route path="dataset" element={<Dataset />} />
          <Route path="architect" element={<Architect />} />
          <Route path="training" element={<Training />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
};

export default App;
