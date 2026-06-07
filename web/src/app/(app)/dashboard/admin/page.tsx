"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

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
}

interface Exercise {
  id: string;
  name: string;
  description: string;
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
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isFinalConfirmOpen, setIsFinalConfirmOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserName, setDeleteUserName] = useState<string | null>(null);
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

  const handleDeleteUser = async (id: string) => {
    try {
      await fetch(`/api/users/${id}`, { method: "DELETE" });
      setUsers(users.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Failed to delete user:", err);
    }
  };

  const openDeleteModal = (user: User) => {
    setDeleteUserId(user.id);
    setDeleteUserName(user.name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "this user");
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteUserId(null);
    setDeleteUserName(null);
  };

  const confirmDeleteUser = () => {
    if (!deleteUserId) return;
    setIsDeleteModalOpen(false);
    setIsFinalConfirmOpen(true);
  };

  const handleFinalDelete = async () => {
    if (!deleteUserId) return;
    try {
      const res = await fetch(`/api/users/${deleteUserId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user.");
      const deletedEmail = users.find((u) => u.id === deleteUserId)?.email;
      setUsers(users.filter((u) => u.id !== deleteUserId));
      setStatusModalType("success");
      setStatusModalMsg(
        deletedEmail
          ? `${deleteUserName} successfully deleted. An email notification has been sent to ${deletedEmail}.`
          : `${deleteUserName} successfully deleted.`
      );
      setShowStatusModal(true);
    } catch (err) {
      console.error("Failed to delete user:", err);
      setStatusModalType("error");
      setStatusModalMsg("Unable to delete user. Please try again.");
      setShowStatusModal(true);
    } finally {
      setIsFinalConfirmOpen(false);
      setDeleteUserId(null);
      setDeleteUserName(null);
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
        body: JSON.stringify(newExercise),
      });
      const data = await res.json();
      if (res.ok) setExercises([...exercises, data.exercise]);
    } catch (err) {
      console.error("Failed to add exercise:", err);
    }

    setNewExercise({ name: "", description: "" });
    setShowExerciseForm(false);
  };

  const handleDeleteExercise = async (id: string) => {
    try {
      await fetch(`/api/exercises/${id}`, { method: "DELETE" });
      setExercises(exercises.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete exercise:", err);
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
  const patients = users.filter((u) => u.role === "patient");
  const therapists = users.filter((u) => u.role === "therapist");
  const unassignedPatients = patients.filter((p) => !p.therapistId);
  const assignedPatients = patients.filter((p) => p.therapistId);

  const getTherapistName = (therapistId: string) => {
    return therapists.find((t) => t.id === therapistId)?.name || "Unknown";
  };

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
        <button
          className="md:hidden mb-4 flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition"
          onClick={() => setSidebarOpen(true)}
        >
          ☰ Menu
        </button>
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

            {isDeleteModalOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={closeDeleteModal} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Confirm Delete</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      Are you sure you want to delete <span className="font-semibold text-gray-900">{deleteUserName}</span>? This action cannot be undone.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={closeDeleteModal}
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

            {isFinalConfirmOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setIsFinalConfirmOpen(false); setDeleteUserId(null); setDeleteUserName(null); }} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Final Confirmation</h2>
                    <p className="text-sm text-gray-500 mb-5">
                      This is your final confirmation. Deleting <span className="font-semibold text-gray-900">{deleteUserName}</span> is permanent and cannot be recovered.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsFinalConfirmOpen(false); setDeleteUserId(null); setDeleteUserName(null); }}
                        className="flex-1 px-4 py-2 border border-gray-300 bg-white text-sm text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFinalDelete}
                        className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
                      >
                        Yes, Delete Permanently
                      </button>
                    </div>
                  </div>
                </div>
              </>
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
                      Confirm & Add User
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
                          Confirm & Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Users List */}
            <div className="bg-white rounded shadow overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u) => (
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
                            onClick={() => openDeleteModal(u)}
                            className="text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                <h3 className="text-xl font-semibold mb-4">Add New Exercise</h3>
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
                      className="w-full border border-gray-300 rounded px-3 py-2"
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
                      className="w-full border border-gray-300 rounded px-3 py-2"
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

            {/* Exercises Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {exercises.map((ex) => (
                <div key={ex.id} className="bg-white p-6 rounded shadow hover:shadow-lg transition">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{ex.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{ex.description}</p>

                  <button
                    onClick={() => handleDeleteExercise(ex.id)}
                    className="w-full px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded transition font-medium"
                  >
                    Delete
                  </button>
                </div>
              ))}
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
