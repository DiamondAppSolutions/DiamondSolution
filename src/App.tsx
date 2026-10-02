import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute, AdminRoute } from "@/components/ProtectedRoute";
import Splash from "@/pages/Splash";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import CourseList from "@/pages/CourseList";
import CourseDetail from "@/pages/CourseDetail";
import StudyPage from "@/pages/StudyPage";
import ActivityLog from "@/pages/ActivityLog";
import Leaderboard from "@/pages/Leaderboard";
import Affiliate from "@/pages/Affiliate";
import AdminDepartments from "@/pages/admin/AdminDepartments";
import AdminCourses from "@/pages/admin/AdminCourses";
import AdminQuestions from "@/pages/admin/AdminQuestions";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminWithdrawals from "@/pages/admin/AdminWithdrawals";
import AdminAuditLog from "@/pages/admin/AdminAuditLog";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/courses" element={<CourseList />} />
          <Route path="/courses/:id" element={<CourseDetail />} />
          <Route path="/courses/:id/study" element={<StudyPage />} />
          <Route path="/activity-log" element={<ActivityLog />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/affiliate" element={<Affiliate />} />
        </Route>

        <Route element={<AdminRoute />}>
          <Route path="/admin/departments" element={<AdminDepartments />} />
          <Route path="/admin/courses" element={<AdminCourses />} />
          <Route
            path="/admin/courses/:courseId/questions"
            element={<AdminQuestions />}
          />
          <Route path="/admin/payments" element={<AdminPayments />} />
          <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
          <Route path="/admin/audit-log" element={<AdminAuditLog />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
