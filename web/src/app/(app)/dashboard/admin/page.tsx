"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "../_components/NotificationBell";

type Tab = "dashboard" | "users" | "exercises" | "assignments";

interface User {
  id: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  role: "patient" | "therapist";
  therapistId?: string;
  dateOfBirth?: string;
  age?: number;
  gender?: string;
  // Therapist-specific fields
  therapistIDNum?: string;
  specialty?: string;
  isArchived?: boolean;
  archivedAt?: string;
}

interface Exercise {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);

  // User form state
  const [selectedRole, setSelectedRole] = useState<"patient" | "therapist" | null>(null);
  const [newUser, setNewUser] = useState<Partial<User>>({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    role: "patient",
    dateOfBirth: "",
    age: undefined,
    gender: "",
    therapistIDNum: "",
    specialty: ""
  });
  const [emailError, setEmailError] = useState<string | null>(null);
  const [editEmailError, setEditEmailError] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showStatusModal,  setShowStatusModal]  = useState(false);
  const [statusModalMsg,   setStatusModalMsg]   = useState("");
  const [statusModalType,  setStatusModalType]  = useState<"success" | "error">("success");
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isFinalArchiveOpen, setIsFinalArchiveOpen] = useState(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isFinalDeleteOpen, setIsFinalDeleteOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetUserName, setTargetUserName] = useState<string | null>(null);
  const [showAddPreview, setShowAddPreview] = useState(false);
  const [showEditPreview, setShowEditPreview] = useState(false);

  // Assignment state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string | null>(null);

  // Assignment history (session-only)
  const [assignHistory, setAssignHistory] = useState<{
    id: number;
    action: "assigned" | "unassigned";
    patientName: string;
    therapistName: string;
    timestamp: Date;
  }[]>([]);
  const addHistory = (action: "assigned" | "unassigned", patientName: string, therapistName: string) => {
    setAssignHistory((prev) => [
      { id: Date.now(), action, patientName, therapistName, timestamp: new Date() },
      ...prev,
    ]);
  };

  // Exercise form state
  const [newExercise, setNewExercise] = useState<{
    name: string;
    description: string;
  }>({
    name: "",
    description: "",
  });
  const [showExerciseForm, setShowExerciseForm] = useState(false);

  // Exercise states matching therapist exercises list
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [viewingExercise, setViewingExercise] = useState<Exercise | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string | null>(null);

  // Load users and exercises from PostgreSQL on mount
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users ?? []))
      .catch((err) => console.error("Failed to load users:", err));

    fetch("/api/exercises")
      .then((r) => r.json())
      .then((data) => setExercises(data.exercises ?? []))
      .catch((err) => console.error("Failed to load exercises:", err));
  }, []);

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.firstName || !newUser.lastName || !newUser.role) return;

    if (newUser.role === "patient") {
      if (!newUser.email || !newUser.dateOfBirth || !newUser.age || !newUser.gender || emailError) return;
    } else if (newUser.role === "therapist") {
      if (!newUser.email || !newUser.dateOfBirth || !newUser.age || !newUser.gender || !newUser.specialty) return;
    }

    setShowAddPreview(true);
  };

  const handleConfirmAdd = async () => {
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers([...users, data.user]);
        const fullName = [newUser.firstName, newUser.middleName, newUser.lastName].filter(Boolean).join(" ");
        setStatusModalType("success");
        setStatusModalMsg(
          newUser.email
            ? `${fullName} successfully added. An activation email with login credentials has been sent to ${newUser.email}.`
            : `${fullName} successfully added.`
        );
        setShowStatusModal(true);
      } else {
        setStatusModalType("error");
        setStatusModalMsg(data?.error || "Unable to add user. Please try again.");
        setShowStatusModal(true);
      }
    } catch (err) {
      console.error("Failed to add user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to add user. Please try again.");
      setShowStatusModal(true);
    }

    setShowAddPreview(false);
    setNewUser({ firstName: "", middleName: "", lastName: "", email: "", role: "patient", dateOfBirth: "", age: undefined, gender: "", therapistIDNum: "", specialty: "" });
    setEmailError(null);
    setSelectedRole(null);
    setShowUserForm(false);
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleArchiveUser = (u: User) => {
    setTargetUserId(u.id);
    setTargetUserName(u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "this user");
    setIsArchiveModalOpen(true);
  };

  const closeArchiveModal = () => {
    setIsArchiveModalOpen(false);
    setTargetUserId(null);
    setTargetUserName(null);
  };

  const confirmArchiveUser = () => {
    if (!targetUserId) return;
    setIsArchiveModalOpen(false);
    setIsFinalArchiveOpen(true);
  };

  const handleFinalArchive = async () => {
    if (!targetUserId) return;
    try {
      const res = await fetch(`/api/users/${targetUserId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to archive user.");
      const archivedEmail = users.find((u) => u.id === targetUserId)?.email;
      setUsers(users.map((u) =>
        u.id === targetUserId ? { ...u, isArchived: true, archivedAt: new Date().toISOString() } : u
      ));
      setStatusModalType("success");
      setStatusModalMsg(
        archivedEmail
          ? `${targetUserName} has been archived. An email notification has been sent to ${archivedEmail}.`
          : `${targetUserName} has been archived.`
      );
      setShowStatusModal(true);
    } catch (err) {
      console.error("Failed to archive user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to archive user. Please try again.");
      setShowStatusModal(true);
    } finally {
      setIsFinalArchiveOpen(false);
      setTargetUserId(null);
      setTargetUserName(null);
    }
  };

  const handleDeleteUser = (u: User) => {
    setTargetUserId(u.id);
    setTargetUserName(u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "this user");
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteUser = () => {
    if (!targetUserId) return;
    setIsDeleteModalOpen(false);
    setIsFinalDeleteOpen(true);
  };

  const handleFinalDelete = async () => {
    if (!targetUserId) return;
    try {
      const res = await fetch(`/api/users/${targetUserId}?permanent=true`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user.");
      const deletedUser = users.find((u) => u.id === targetUserId);
      const deletedEmail = deletedUser?.email;
      
      setUsers(users.filter((u) => u.id !== targetUserId));
      setStatusModalType("success");
      setStatusModalMsg(
        deletedEmail
          ? `${targetUserName} has been permanently deleted. An email notification has been sent to ${deletedEmail}.`
          : `${targetUserName} has been permanently deleted.`
      );
      setShowStatusModal(true);
    } catch (err) {
      console.error("Failed to delete user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to delete user. Please try again.");
      setShowStatusModal(true);
    } finally {
      setIsFinalDeleteOpen(false);
      setTargetUserId(null);
      setTargetUserName(null);
    }
  };

  const handleRestoreUser = (u: User) => {
    setTargetUserId(u.id);
    setTargetUserName(u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "this user");
    setIsRestoreModalOpen(true);
  };

  const handleConfirmRestore = async () => {
    if (!targetUserId) return;
    try {
      const res = await fetch(`/api/users/${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) throw new Error("Failed to restore user.");
      const restoredEmail = users.find((u) => u.id === targetUserId)?.email;
      setUsers(users.map((u) =>
        u.id === targetUserId ? { ...u, isArchived: false, archivedAt: undefined } : u
      ));
      setStatusModalType("success");
      setStatusModalMsg(
        restoredEmail
          ? `${targetUserName} has been restored and can now access the system. An email notification has been sent to ${restoredEmail}.`
          : `${targetUserName} has been restored.`
      );
      setShowStatusModal(true);
    } catch (err) {
      console.error("Failed to restore user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to restore user. Please try again.");
      setShowStatusModal(true);
    } finally {
      setIsRestoreModalOpen(false);
      setTargetUserId(null);
      setTargetUserName(null);
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser({ ...user });
    setEditingUserId(user.id);
    setShowUserForm(false);
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || (!editingUser.name && !editingUser.firstName)) return;
    if (editEmailError) return;
    setShowEditPreview(true);
  };

  const handleConfirmEdit = async () => {
    if (!editingUser) return;
    try {
      const res = await fetch(`/api/users/${editingUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingUser),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(users.map((u) => (u.id === editingUserId ? data.user : u)));
        const fullName = [editingUser.firstName, editingUser.middleName, editingUser.lastName].filter(Boolean).join(" ");
        const originalEmail = users.find((u) => u.id === editingUserId)?.email;
        const emailChanged = editingUser.email && originalEmail && editingUser.email !== originalEmail;
        setStatusModalType("success");
        setStatusModalMsg(
          emailChanged
            ? `${fullName} successfully updated. Email notifications have been sent to ${originalEmail} and ${editingUser.email} about the email address change.`
            : `${fullName} successfully updated.`
        );
        setShowStatusModal(true);
      } else {
        setStatusModalType("error");
        setStatusModalMsg(data?.error || "Unable to update user. Please try again.");
        setShowStatusModal(true);
      }
    } catch (err) {
      console.error("Failed to update user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to update user. Please try again.");
      setShowStatusModal(true);
    }
    setShowEditPreview(false);
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditingUser(null);
    setEditEmailError(null);
  };

  const handleAssignPatient = async () => {
    if (!selectedPatientId || !selectedTherapistId) return;

    const patientName = patients.find((p) => p.id === selectedPatientId)?.name ?? selectedPatientId;
    const therapistName = therapists.find((t) => t.id === selectedTherapistId)?.name ?? selectedTherapistId;

    try {
      const res = await fetch(`/api/users/${selectedPatientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ therapistId: selectedTherapistId }),
      });
      if (res.ok) {
        setUsers(users.map((u) =>
          u.id === selectedPatientId ? { ...u, therapistId: selectedTherapistId } : u
        ));
        addHistory("assigned", patientName, therapistName);
      }
    } catch (err) {
      console.error("Failed to assign patient:", err);
    }

    setSelectedPatientId(null);
    setSelectedTherapistId(null);
  };

  const handleUnassignPatient = async (patientId: string) => {
    const patient = users.find((u) => u.id === patientId);
    const patientName = patient?.name ?? patientId;
    const therapistName = patient?.therapistId
      ? (therapists.find((t) => t.id === patient.therapistId)?.name ?? patient.therapistId)
      : "Unknown";

    try {
      const res = await fetch(`/api/users/${patientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ therapistId: null }),
      });
      if (res.ok) {
        setUsers(users.map((u) =>
          u.id === patientId ? { ...u, therapistId: undefined } : u
        ));
        addHistory("unassigned", patientName, therapistName);
      }
    } catch (err) {
      console.error("Failed to unassign patient:", err);
    }
  };

  const handleAddExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExercise.name || !newExercise.description) return;

    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newExercise, isCustom: true }),
      });
      const data = await res.json();
      if (res.ok) setExercises([...exercises, data.exercise]);
    } catch (err) {
      console.error("Failed to add exercise:", err);
    }

    setNewExercise({ name: "", description: "" });
    setShowExerciseForm(false);
  };

  const startEdit = (ex: Exercise) => {
    setEditingId(ex.id);
    setEditDesc(ex.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDesc("");
  };

  const saveExercise = async (id: string) => {
    if (!editDesc.trim()) return;
    const original = exercises.find((e) => e.id === id);
    if (!original) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/exercises/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: original.name, description: editDesc.trim() }),
      });
      if (res.ok) {
        const { exercise } = await res.json();
        setExercises((prev) => prev.map((e) => (e.id === id ? { ...e, ...exercise } : e)));
        cancelEdit();
      }
    } catch (err) {
      console.error("Error saving exercise:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (id: string, name: string) => {
    setDeleteTargetId(id);
    setDeleteTargetName(name);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteExercise = async () => {
    if (!deleteTargetId) return;
    try {
      const res = await fetch(`/api/exercises/${deleteTargetId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setExercises((prev) => prev.filter((e) => e.id !== deleteTargetId));
        setShowDeleteConfirm(false);
      } else {
        console.error("Failed to delete exercise");
      }
    } catch (err) {
      console.error("Error deleting exercise:", err);
    } finally {
      setDeleteTargetId(null);
      setDeleteTargetName(null);
    }
  };

  const computeAgePhilippines = (dob: string): number => {
    if (!dob) return 0;
    const phToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const [ty, tm, td] = phToday.split("-").map(Number);
    const [by, bm, bd] = dob.split("-").map(Number);
    let age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age--;
    return Math.max(0, age);
  };

  // Helper functions
  const activeUsers   = users.filter((u) => !u.isArchived);
  const archivedUsers = users.filter((u) => u.isArchived);
  const patients    = activeUsers.filter((u) => u.role === "patient");
  const therapists  = activeUsers.filter((u) => u.role === "therapist");
  const unassignedPatients = patients.filter((p) => !p.therapistId);
  const assignedPatients   = patients.filter((p) => p.therapistId);

  const getTherapistName = (therapistId: string) => {
    return therapists.find((t) => t.id === therapistId)?.name || "Unknown";
  };

  const filteredExercises = exercises.filter((e) =>
    e.name.toLowerCase().includes(exerciseQuery.toLowerCase()) ||
    e.description.toLowerCase().includes(exerciseQuery.toLowerCase())
  );

  const systemExercises = filteredExercises.filter((e) => !e.is_custom);
  const customExercises = filteredExercises.filter((e) => e.is_custom);

  return (
    <div className="min-h-screen flex bg-green-50">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-green-900 text-white p-6 flex flex-col transform transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:static md:translate-x-0 md:flex md:flex-col md:flex-shrink-0`}>
        <div className="mb-8">
          <div className="text-lg font-semibold text-white">{user?.name}</div>
        </div>

        <nav>
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => { setActiveTab("dashboard"); setSidebarOpen(false); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                  activeTab === "dashboard"
                    ? "bg-green-700 text-white font-medium"
                    : "text-green-200 hover:bg-green-800"
                }`}
              >
                <AdminHomeIcon />
                Dashboard
              </button>
            </li>
            <li>
              <button
                onClick={() => { setActiveTab("users"); setSidebarOpen(false); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                  activeTab === "users"
                    ? "bg-green-700 text-white font-medium"
                    : "text-green-200 hover:bg-green-800"
                }`}
              >
                <AdminUsersIcon />
                Manage Users
              </button>
            </li>
            <li>
              <button
                onClick={() => { setActiveTab("exercises"); setSidebarOpen(false); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                  activeTab === "exercises"
                    ? "bg-green-700 text-white font-medium"
                    : "text-green-200 hover:bg-green-800"
                }`}
              >
                <AdminDumbbellIcon />
                Manage Exercises
              </button>
            </li>
            <li>
              <button
                onClick={() => { setActiveTab("assignments"); setSidebarOpen(false); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded text-sm transition ${
                  activeTab === "assignments"
                    ? "bg-green-700 text-white font-medium"
                    : "text-green-200 hover:bg-green-800"
                }`}
              >
                <AdminAssignIcon />
                Assign Patients
              </button>
            </li>
            <li>
              <Link
                href="/camera"
                className="flex items-center gap-2 px-3 py-2 rounded text-sm text-green-200 hover:bg-green-800"
                onClick={() => setSidebarOpen(false)}
              >
                <AdminCameraIcon />
                Camera
              </Link>
            </li>
          </ul>
        </nav>

        <div className="mt-auto pt-6 mb-4">
          <button
            onClick={async () => { await logout(); router.push("/"); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition"
          >
            <AdminLogoutIcon />
            Log Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 overflow-y-auto min-w-0">
        <div className="flex justify-between items-center mb-6">
          <button
            className="md:hidden flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition"
            onClick={() => setSidebarOpen(true)}
          >
            ☰ Menu
          </button>
          <div className="md:hidden flex-1" />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 mt-1">Welcome, {user?.name}.</p>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-bold text-gray-900">Manage Users</h2>
              <button
                onClick={() => {
                  if (editingUserId) {
                    handleCancelEdit();
                  } else {
                    setShowUserForm(!showUserForm);
                    if (showUserForm) {
                      setSelectedRole(null);
                      setNewUser({
                        firstName: "",
                        middleName: "",
                        lastName: "",
                        email: "",
                        role: "patient",
                        dateOfBirth: "",
                        age: undefined,
                        gender: "",
                        therapistIDNum: "",
                        specialty: ""
                      });
                      setEmailError(null);
                    }
                  }
                }}
                className={`px-4 py-2 rounded transition text-white ${
                  editingUserId
                    ? "bg-green-800 hover:bg-green-900"
                    : "bg-green-700 hover:bg-green-800"
                }`}
              >
                {editingUserId ? "Cancel Edit" : showUserForm ? "Cancel" : "+ Add User"}
              </button>
            </div>

            {showUserForm && !editingUserId && (
              <div className="bg-white p-6 rounded shadow mb-6 text-black">
                <h3 className="text-xl font-semibold mb-4 text-black">Add New User</h3>
                <form onSubmit={handleAddUser} className="space-y-4">
                  {!selectedRole ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3">
                          Select User Role
                        </label>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRole("patient");
                              setNewUser({ ...newUser, role: "patient" });
                            }}
                            className="w-full p-4 border-2 border-gray-300 rounded hover:border-green-500 hover:bg-green-50 transition text-left font-medium text-black flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                            Patient
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRole("therapist");
                              setNewUser({ ...newUser, role: "therapist" });
                            }}
                            className="w-full p-4 border-2 border-gray-300 rounded hover:border-green-500 hover:bg-green-50 transition text-left font-medium text-black flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM10 4h4v2h-4V4zm6 11h-3v3h-2v-3H8v-2h3v-3h2v3h3v2z"/></svg>
                            Therapist
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4 pb-4 border-b">
                        <h4 className="text-lg font-semibold flex items-center gap-2">
                          {selectedRole === "patient" ? (
                            <><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Patient Information</>
                          ) : (
                            <><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM10 4h4v2h-4V4zm6 11h-3v3h-2v-3H8v-2h3v-3h2v3h3v2z"/></svg> Therapist Information</>
                          )}
                        </h4>
                        <button
                          type="button"
                          onClick={() => setSelectedRole(null)}
                          className="text-sm text-green-700 hover:text-green-900"
                        >
                          Change Role
                        </button>
                      </div>

                      {/* Common Fields */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            First Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={newUser.firstName || ""}
                            onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Middle Name
                          </label>
                          <input
                            type="text"
                            value={newUser.middleName || ""}
                            onChange={(e) => setNewUser({ ...newUser, middleName: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Last Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={newUser.lastName || ""}
                            onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Date of Birth <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={newUser.dateOfBirth || ""}
                            onChange={(e) => {
                              const dob = e.target.value;
                              setNewUser({ ...newUser, dateOfBirth: dob, age: dob ? computeAgePhilippines(dob) : undefined });
                            }}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            max={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}
                            min="1900-01-01"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Age <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            value={newUser.age ?? ""}
                            readOnly
                            className="w-full border border-gray-300 rounded px-3 py-2 bg-gray-50 cursor-not-allowed"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={newUser.gender || ""}
                          onChange={(e) => setNewUser({ ...newUser, gender: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          required
                        >
                          <option value="">-- Select Gender --</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>

                      {/* Patient-specific Fields */}
                      {selectedRole === "patient" && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="email"
                              value={newUser.email || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setNewUser({ ...newUser, email: val });
                                const duplicate = users.some(u => u.email === val);
                                setEmailError(duplicate ? "This email address is already registered to an account." : null);
                              }}
                              className={`w-full border rounded px-3 py-2 ${emailError ? "border-red-500" : "border-gray-300"}`}
                              required
                            />
                            {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
                          </div>
                        </>
                      )}

                      {/* Therapist-specific Fields */}
                      {selectedRole === "therapist" && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="email"
                              value={newUser.email || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setNewUser({ ...newUser, email: val });
                                const duplicate = users.some(u => u.email === val);
                                setEmailError(duplicate ? "This email address is already registered to an account." : null);
                              }}
                              className={`w-full border rounded px-3 py-2 ${emailError ? "border-red-500" : "border-gray-300"}`}
                              required
                            />
                            {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Specialty <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={newUser.specialty || ""}
                              onChange={(e) => setNewUser({ ...newUser, specialty: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              required
                            />
                          </div>
                        </>
                      )}

                      <button
                        type="submit"
                        disabled={!!emailError}
                        className={`w-full px-4 py-2 text-white rounded transition ${emailError ? "bg-gray-400 cursor-not-allowed" : "bg-green-700 hover:bg-green-800"}`}
                      >
                        Add User
                      </button>
                    </>
                  )}
                </form>
              </div>
            )}

            {/* Edit User Form */}
            {editingUserId && editingUser && (
              <div className="bg-white p-6 rounded shadow mb-6 border-l-4 border-yellow-500 text-black">
                <h3 className="text-xl font-semibold mb-4">Edit User Details</h3>
                <form onSubmit={handleSaveEditUser} className="space-y-4">
                  <h4 className="text-lg font-semibold flex items-center gap-2">
                    {editingUser.role === "patient" ? (
                      <><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> Patient Information</>
                    ) : (
                      <><svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM10 4h4v2h-4V4zm6 11h-3v3h-2v-3H8v-2h3v-3h2v3h3v2z"/></svg> Therapist Information</>
                    )}
                  </h4>

                  {/* Common Fields */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        First Name
                      </label>
                      <input
                        type="text"
                        value={editingUser.firstName || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, firstName: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Middle Name
                      </label>
                      <input
                        type="text"
                        value={editingUser.middleName || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, middleName: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={editingUser.lastName || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, lastName: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date of Birth
                      </label>
                      <input
                        type="date"
                        value={editingUser.dateOfBirth || ""}
                        onChange={(e) => {
                          const dob = e.target.value;
                          setEditingUser({ ...editingUser, dateOfBirth: dob, age: dob ? computeAgePhilippines(dob) : undefined });
                        }}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        max={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}
                        min="1900-01-01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Age
                      </label>
                      <input
                        type="number"
                        value={editingUser.age ?? ""}
                        readOnly
                        className="w-full border border-gray-300 rounded px-3 py-2 bg-gray-50 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Gender
                    </label>
                    <select
                      value={editingUser.gender || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, gender: e.target.value })
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2"
                    >
                      <option value="">-- Select Gender --</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>

                  {/* Patient-specific Fields */}
                  {editingUser.role === "patient" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={editingUser.email || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingUser({ ...editingUser, email: val });
                            const duplicate = users.some(u => u.email === val && u.id !== editingUserId);
                            setEditEmailError(duplicate ? "This email address is already registered to an account." : null);
                          }}
                          className={`w-full border rounded px-3 py-2 ${editEmailError ? "border-red-500" : "border-gray-300"}`}
                        />
                        {editEmailError && <p className="mt-1 text-xs text-red-600">{editEmailError}</p>}
                      </div>
                    </>
                  )}

                  {/* Therapist-specific Fields */}
                  {editingUser.role === "therapist" && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={editingUser.email || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingUser({ ...editingUser, email: val });
                            const duplicate = users.some(u => u.email === val && u.id !== editingUserId);
                            setEditEmailError(duplicate ? "This email address is already registered to an account." : null);
                          }}
                          className={`w-full border rounded px-3 py-2 ${editEmailError ? "border-red-500" : "border-gray-300"}`}
                        />
                        {editEmailError && <p className="mt-1 text-xs text-red-600">{editEmailError}</p>}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Specialty
                        </label>
                        <input
                          type="text"
                          value={editingUser.specialty || ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, specialty: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={!!editEmailError}
                      className={`flex-1 px-4 py-2 text-white rounded transition ${editEmailError ? "bg-gray-400 cursor-not-allowed" : "bg-green-700 hover:bg-green-800"}`}
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="flex-1 px-4 py-2 bg-gray-400 hover:bg-gray-500 text-white rounded transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {showAddPreview && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowAddPreview(false)} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Confirm New User</h3>
                  <p className="text-sm text-gray-500 mb-4">Please review the details below before adding the user.</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Role</span>
                      <span className="font-medium text-gray-900 capitalize">{newUser.role}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Full Name</span>
                      <span className="font-medium text-gray-900">{[newUser.firstName, newUser.middleName, newUser.lastName].filter(Boolean).join(" ")}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Email</span>
                      <span className="font-medium text-gray-900">{newUser.email}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Date of Birth</span>
                      <span className="font-medium text-gray-900">{newUser.dateOfBirth}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Age</span>
                      <span className="font-medium text-gray-900">{newUser.age}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-32 shrink-0 text-gray-500">Gender</span>
                      <span className="font-medium text-gray-900 capitalize">{newUser.gender}</span>
                    </div>
                    {newUser.role === "therapist" && (
                      <div className="flex gap-2">
                        <span className="w-32 shrink-0 text-gray-500">Specialty</span>
                        <span className="font-medium text-gray-900">{newUser.specialty}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowAddPreview(false)}
                      className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                    >
                      Go Back
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAdd}
                      className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
                    >
                      Confirm &amp; Add User
                    </button>
                  </div>
                </div>
                </div>
              </>
            )}

            {showEditPreview && editingUser && (() => {
              const original = users.find(u => u.id === editingUserId);
              const fields: { label: string; oldVal: string | number | undefined; newVal: string | number | undefined }[] = [
                { label: "First Name", oldVal: original?.firstName, newVal: editingUser.firstName },
                { label: "Middle Name", oldVal: original?.middleName, newVal: editingUser.middleName },
                { label: "Last Name", oldVal: original?.lastName, newVal: editingUser.lastName },
                { label: "Email", oldVal: original?.email, newVal: editingUser.email },
                { label: "Date of Birth", oldVal: original?.dateOfBirth, newVal: editingUser.dateOfBirth },
                { label: "Age", oldVal: original?.age, newVal: editingUser.age },
                { label: "Gender", oldVal: original?.gender, newVal: editingUser.gender },
                ...(editingUser.role === "therapist" ? [
                  { label: "Specialty", oldVal: original?.specialty, newVal: editingUser.specialty },
                ] : []),
              ];
              return (
                <>
                  <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowEditPreview(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
                      <h3 className="text-xl font-semibold text-gray-900 mb-1">Confirm Edit</h3>
                      <p className="text-sm text-gray-500 mb-4">Review changes before saving. Highlighted rows have been modified.</p>
                      <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b pb-2 mb-1">
                        <span>Field</span>
                        <span>Before</span>
                        <span>After</span>
                      </div>
                      <div className="space-y-0.5">
                        {fields.map(({ label, oldVal, newVal }) => {
                          const changed = String(oldVal ?? "") !== String(newVal ?? "");
                          return (
                            <div key={label} className={`grid grid-cols-3 gap-2 text-sm py-2 px-2 rounded ${changed ? "bg-yellow-50" : ""}`}>
                              <span className="text-gray-500">{label}</span>
                              <span className={changed ? "line-through text-red-400" : "text-gray-700"}>{oldVal || "—"}</span>
                              <span className={changed ? "font-medium text-green-700" : "text-gray-700"}>{newVal || "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-6 flex gap-3">
                        <button
                          type="button"
                          onClick={() => setShowEditPreview(false)}
                          className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                        >
                          Go Back
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmEdit}
                          className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
                        >
                          Confirm &amp; Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Archive Confirmation Modal */}
            {isArchiveModalOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={closeArchiveModal} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-amber-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Archive User</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      Are you sure you want to archive <span className="font-semibold text-gray-900">{targetUserName}</span>? They will lose access to the system, but their records will remain intact and can be restored.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={closeArchiveModal}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmArchiveUser}
                        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition"
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Final Archive Confirmation */}
            {isFinalArchiveOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setIsFinalArchiveOpen(false); setTargetUserId(null); setTargetUserName(null); }} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-amber-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Confirm Archive</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      <span className="font-semibold text-gray-900">{targetUserName}</span> will be archived. Their data stays in the database and can be restored at any time.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsFinalArchiveOpen(false); setTargetUserId(null); setTargetUserName(null); }}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFinalArchive}
                        className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition"
                      >
                        Yes, Archive
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Restore Confirmation Modal */}
            {isRestoreModalOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setIsRestoreModalOpen(false); setTargetUserId(null); setTargetUserName(null); }} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Restore User</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      Restore <span className="font-semibold text-gray-900">{targetUserName}</span>? They will regain access to the system with all their previous records intact.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsRestoreModalOpen(false); setTargetUserId(null); setTargetUserName(null); }}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmRestore}
                        className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
                      >
                        Yes, Restore
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Delete Confirmation Modal (Step 1) */}
            {isDeleteModalOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setIsDeleteModalOpen(false); setTargetUserId(null); setTargetUserName(null); }} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Delete User Account</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      Are you sure you want to permanently delete <span className="font-semibold text-gray-900">{targetUserName}</span>? This will remove all their records from the database.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsDeleteModalOpen(false); setTargetUserId(null); setTargetUserName(null); }}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmDeleteUser}
                        className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Final Delete Confirmation (Step 2) */}
            {isFinalDeleteOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setIsFinalDeleteOpen(false); setTargetUserId(null); setTargetUserName(null); }} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">WARNING: Permanent Deletion</h2>
                    <p className="text-sm text-red-600 mb-5 font-semibold">
                      This action CANNOT be undone. All database records and session history for {targetUserName} will be lost forever.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsFinalDeleteOpen(false); setTargetUserId(null); setTargetUserName(null); }}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFinalDelete}
                        className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-medium rounded-lg transition"
                      >
                        Permanently Delete
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Users List — Active */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span>
                Active Users
                <span className="ml-1 text-sm font-normal text-gray-500">({activeUsers.length})</span>
              </h3>
              <div className="bg-white rounded shadow overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Role</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeUsers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">No active users.</td>
                      </tr>
                    ) : (
                      activeUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900">{u.name}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{u.email}</td>
                          <td className="px-6 py-4 text-sm">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${u.role === "therapist" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleEditUser(u)}
                                className="text-green-700 hover:text-green-900 font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleArchiveUser(u)}
                                className="text-amber-600 hover:text-amber-800 font-medium"
                              >
                                Archive
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Users List — Archived */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                Archived Users
                <span className="ml-1 text-sm font-normal text-gray-500">({archivedUsers.length})</span>
              </h3>
              <div className="bg-white rounded shadow overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Role</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Archived On</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {archivedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">No archived users.</td>
                      </tr>
                    ) : (
                      archivedUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-amber-50 opacity-80">
                          <td className="px-6 py-4 text-sm text-gray-700">{u.name}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">{u.email}</td>
                          <td className="px-6 py-4 text-sm">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${u.role === "therapist" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"} opacity-70`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {u.archivedAt ? new Date(u.archivedAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleRestoreUser(u)}
                                className="text-green-700 hover:text-green-900 font-medium"
                              >
                                Restore
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u)}
                                className="text-red-600 hover:text-red-800 font-medium"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


        {/* Exercises Tab */}
        {activeTab === "exercises" && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-bold text-gray-900">Manage Exercises</h2>
              <button
                onClick={() => setShowExerciseForm(!showExerciseForm)}
                className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded transition"
              >
                {showExerciseForm ? "Cancel" : "+ Add Exercise"}
              </button>
            </div>

            {showExerciseForm && (
              <div className="bg-white p-6 rounded shadow mb-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Add New Exercise</h3>
                <form onSubmit={handleAddExercise} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Exercise Name
                    </label>
                    <input
                      type="text"
                      value={newExercise.name}
                      onChange={(e) =>
                        setNewExercise({ ...newExercise, name: e.target.value })
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2 bg-white text-black"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={newExercise.description}
                      onChange={(e) =>
                        setNewExercise({ ...newExercise, description: e.target.value })
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2 bg-white text-black"
                      rows={3}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded transition"
                  >
                    Add Exercise
                  </button>
                </form>
              </div>
            )}

            {/* Search bar */}
            <div className="mb-6">
              <div className="relative w-full max-w-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  value={exerciseQuery}
                  onChange={(e) => setExerciseQuery(e.target.value)}
                  placeholder="Search exercises"
                  className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition bg-white text-black"
                />
              </div>
            </div>

            {/* Exercises List */}
            <div className="grid gap-6">
              {exercises.length === 0 ? (
                <div className="text-gray-500">No exercises found.</div>
              ) : (
                <>
                  {systemExercises.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                        System Exercises ({systemExercises.length})
                      </h3>
                      <div className="grid gap-4">
                        {systemExercises.map((ex) => (
                          <AdminExerciseRow
                            key={ex.id}
                            exercise={ex}
                            isEditing={editingId === ex.id}
                            editDesc={editDesc}
                            saving={saving}
                            onEdit={() => startEdit(ex)}
                            onCancel={cancelEdit}
                            onSave={() => saveExercise(ex.id)}
                            onEditDesc={setEditDesc}
                            onView={() => setViewingExercise(ex)}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {customExercises.length > 0 ? (
                    <section className="mt-4">
                      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                        Custom Exercises ({customExercises.length})
                      </h3>
                      <div className="grid gap-4">
                        {customExercises.map((ex) => (
                          <AdminExerciseRow
                            key={ex.id}
                            exercise={ex}
                            isEditing={editingId === ex.id}
                            editDesc={editDesc}
                            saving={saving}
                            onEdit={() => startEdit(ex)}
                            onCancel={cancelEdit}
                            onSave={() => saveExercise(ex.id)}
                            onEditDesc={setEditDesc}
                            onView={() => setViewingExercise(ex)}
                            onDelete={() => handleDeleteClick(ex.id, ex.name)}
                          />
                        ))}
                      </div>
                    </section>
                  ) : exerciseQuery === "" ? (
                    <section className="mt-4">
                      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                        Custom Exercises (0)
                      </h3>
                      <p className="text-gray-400 text-sm">No custom exercises yet.</p>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}

        {/* Assignments Tab */}
        {activeTab === "assignments" && (
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-6">Assign Patients to Therapists</h2>

            {therapists.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded text-yellow-800 mb-6">
                No therapists available. Please add therapists first.
              </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Unassigned Patients */}
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">Unassigned Patients ({unassignedPatients.length})</h3>
                <div className="bg-white rounded shadow p-6 space-y-3 max-h-96 overflow-y-auto">
                  {unassignedPatients.length === 0 ? (
                    <p className="text-gray-500">All patients are assigned to therapists.</p>
                  ) : (
                    unassignedPatients.map((patient) => (
                      <div
                        key={patient.id}
                        onClick={() => setSelectedPatientId(patient.id)}
                        className={`p-3 rounded cursor-pointer border-2 transition ${
                          selectedPatientId === patient.id
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <div className="font-medium text-gray-900">{patient.name}</div>
                        <div className="text-sm text-gray-500">{patient.email}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Therapist Selection and Assignment */}
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">Select Therapist</h3>
                <div className="bg-white rounded shadow p-6 space-y-4">
                  {selectedPatientId ? (
                    <>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="text-sm text-gray-600">Selected Patient:</div>
                        <div className="font-semibold text-gray-900">
                          {patients.find((p) => p.id === selectedPatientId)?.name}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3">
                          Assign to Therapist
                        </label>
                        <select
                          value={selectedTherapistId || ""}
                          onChange={(e) => setSelectedTherapistId(e.target.value || null)}
                          className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-black bg-white"
                        >
                          <option value="">-- Select a Therapist --</option>
                          {therapists.map((therapist) => (
                            <option key={therapist.id} value={therapist.id}>
                              {therapist.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleAssignPatient}
                          disabled={!selectedTherapistId}
                          className="w-full px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-gray-400 text-white rounded transition font-medium"
                        >
                          Assign Patient
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-500 text-center py-8">Select a patient to assign</p>
                  )}
                </div>
              </div>
            </div>

            {/* Assigned Patients */}
            <div className="mt-8">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                Currently Assigned Patients ({assignedPatients.length})
              </h3>
              <div className="bg-white rounded shadow overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Patient</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Assigned Therapist</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {assignedPatients.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                          No patients have been assigned yet.
                        </td>
                      </tr>
                    ) : (
                      assignedPatients.map((patient) => (
                        <tr key={patient.id}>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">{patient.name}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{patient.email}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {patient.therapistId ? getTherapistName(patient.therapistId) : "Unassigned"}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <button
                              onClick={() => handleUnassignPatient(patient.id)}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              Unassign
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assignment History */}
            <div className="mt-8">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                Assignment History ({assignHistory.length})
              </h3>
              <div className="bg-white rounded shadow overflow-x-auto">
                {assignHistory.length === 0 ? (
                  <p className="px-6 py-6 text-sm text-gray-500">No assignment actions yet this session.</p>
                ) : (
                  <table className="w-full min-w-[520px]">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Action</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Patient</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Therapist</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {assignHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-6 py-4 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              entry.action === "assigned"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {entry.action === "assigned" ? "Assigned" : "Unassigned"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">{entry.patientName}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{entry.therapistName}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {entry.timestamp.toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {entry.timestamp.toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Status Modal */}
      {showStatusModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowStatusModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className={`flex items-center justify-center w-12 h-12 rounded-full mx-auto mb-4 ${statusModalType === "success" ? "bg-green-100" : "bg-red-100"}`}>
                {statusModalType === "success" ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                )}
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">
                {statusModalType === "success" ? "Success" : "Something Went Wrong"}
              </h2>
              <p className="text-sm text-gray-500 mb-5">{statusModalMsg}</p>
              <button
                onClick={() => setShowStatusModal(false)}
                className={`px-6 py-2 text-white text-sm font-medium rounded-lg transition ${statusModalType === "success" ? "bg-green-700 hover:bg-green-800" : "bg-red-600 hover:bg-red-700"}`}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* View Exercise Details Modal */}
      {viewingExercise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setViewingExercise(null)}
          />

          {/* Modal Content */}
          <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-start mb-4 shrink-0">
              <h3 className="text-xl font-bold text-gray-900">{viewingExercise.name}</h3>
              <button
                onClick={() => setViewingExercise(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content area */}
            <div className="overflow-y-auto pr-1 flex-1 space-y-4">
              {/* Video Player */}
              <div className="w-full">
                <VideoPlayer src="/sample-video.mp4" />
              </div>

              {/* Description */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Description
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {viewingExercise.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Styled Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Delete Custom Exercise</h2>
              <p className="text-sm text-gray-500 mb-5">
                Are you sure you want to permanently delete <span className="font-semibold text-gray-900">{deleteTargetName}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteTargetId(null); setDeleteTargetName(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteExercise}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AdminExerciseRow({
  exercise, isEditing, editDesc, saving,
  onEdit, onCancel, onSave, onEditDesc, onView, onDelete,
}: {
  exercise: Exercise;
  isEditing: boolean;
  editDesc: string;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onEditDesc: (v: string) => void;
  onView: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="border border-gray-200 bg-white rounded-xl p-4 transition hover:shadow-sm">
      {isEditing ? (
        <div className="space-y-3">
          <div className="font-semibold text-gray-900 text-sm">{exercise.name}</div>
          <textarea
            value={editDesc}
            onChange={(e) => onEditDesc(e.target.value)}
            placeholder="Description"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition bg-white text-black"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-xs font-medium rounded-lg transition"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="font-semibold text-gray-900 text-sm">{exercise.name}</p>
            <p className="text-xs text-gray-500 mt-1">{exercise.description}</p>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            <button
              onClick={onView}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-medium rounded-lg transition"
            >
              View
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition"
            >
              Edit
            </button>
            {exercise.is_custom && onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 border border-red-300 text-red-600 text-xs rounded-lg hover:bg-red-50 transition"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VideoPlayer({ src }: { src: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error("Video play error:", err));
    }
  };

  return (
    <div
      className="relative aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center cursor-pointer group"
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        playsInline
        onEnded={() => setIsPlaying(false)}
      />
      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute p-4 rounded-full bg-white/90 shadow-lg hover:bg-white text-green-700 hover:scale-105 transition flex items-center justify-center z-10"
          aria-label="Play video"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 fill-current" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Sidebar icons ──────────────────────────────────────────────────────────

function AdminHomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

function AdminUsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

function AdminDumbbellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z"/>
    </svg>
  );
}

function AdminAssignIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  );
}

function AdminCameraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 14c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
    </svg>
  );
}

function AdminLogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  );
}
