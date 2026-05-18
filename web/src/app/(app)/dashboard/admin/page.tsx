"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

type Tab = "users" | "exercises" | "assignments";

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
  // Patient-specific fields
  diagnosis?: string;
  prescription?: string;
  condition?: string;
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

  const [activeTab, setActiveTab] = useState<Tab>("users");
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
    diagnosis: "",
    prescription: "",
    condition: "",
    therapistIDNum: "",
    specialty: ""
  });
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);
  const [statusVisible, setStatusVisible] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserName, setDeleteUserName] = useState<string | null>(null);

  useEffect(() => {
    if (!statusMessage) {
      setStatusVisible(false);
      return;
    }

    setStatusVisible(true);

    const hideTimer = window.setTimeout(() => {
      setStatusVisible(false);
    }, 4700);

    const clearTimer = window.setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 5000);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [statusMessage]);

  // Assignment state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string | null>(null);

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

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.firstName || !newUser.lastName || !newUser.role) return;

    if (newUser.role === "patient") {
      if (!newUser.email || !newUser.dateOfBirth || !newUser.age || !newUser.gender || !newUser.diagnosis || !newUser.prescription || !newUser.condition) return;
    } else if (newUser.role === "therapist") {
      if (!newUser.email || !newUser.dateOfBirth || !newUser.age || !newUser.gender || !newUser.specialty) return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers([...users, data.user]);
        setStatusType("success");
        setStatusMessage("User successfully added.");
      } else {
        setStatusType("error");
        setStatusMessage(data?.error || "Unable to add user. Please try again.");
      }
    } catch (err) {
      console.error("Failed to add user:", err);
      setStatusType("error");
      setStatusMessage("Unable to add user. Please try again.");
    }

    setNewUser({ firstName: "", middleName: "", lastName: "", email: "", role: "patient", dateOfBirth: "", age: undefined, gender: "", diagnosis: "", prescription: "", condition: "", therapistIDNum: "", specialty: "" });
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

  const confirmDeleteUser = async () => {
    if (!deleteUserId) return;

    try {
      const res = await fetch(`/api/users/${deleteUserId}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to delete user.");
      }
      setUsers(users.filter((u) => u.id !== deleteUserId));
      setStatusType("success");
      setStatusMessage("User successfully deleted.");
    } catch (err) {
      console.error("Failed to delete user:", err);
      setStatusType("error");
      setStatusMessage("Unable to delete user. Please try again.");
    } finally {
      closeDeleteModal();
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser({ ...user });
    setEditingUserId(user.id);
    setShowUserForm(false);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || (!editingUser.name && !editingUser.firstName)) return;

    try {
      const res = await fetch(`/api/users/${editingUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingUser),
      });
      const data = await res.json();
      if (res.ok) setUsers(users.map((u) => (u.id === editingUserId ? data.user : u)));
    } catch (err) {
      console.error("Failed to update user:", err);
    }

    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleAssignPatient = async () => {
    if (!selectedPatientId || !selectedTherapistId) return;

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
      }
    } catch (err) {
      console.error("Failed to assign patient:", err);
    }

    setSelectedPatientId(null);
    setSelectedTherapistId(null);
  };

  const handleUnassignPatient = async (patientId: string) => {
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

  // Helper functions
  const patients = users.filter((u) => u.role === "patient");
  const therapists = users.filter((u) => u.role === "therapist");
  const unassignedPatients = patients.filter((p) => !p.therapistId);
  const assignedPatients = patients.filter((p) => p.therapistId);

  const getTherapistName = (therapistId: string) => {
    return therapists.find((t) => t.id === therapistId)?.name || "Unknown";
  };

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-sm text-gray-400 mt-1">{user?.name}</p>
        </div>

        <nav className="space-y-2">
          <button
            onClick={() => setActiveTab("users")}
            className={`w-full text-left px-4 py-3 rounded transition ${
              activeTab === "users"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
          >
            👥 Manage Users
          </button>
          <button
            onClick={() => setActiveTab("exercises")}
            className={`w-full text-left px-4 py-3 rounded transition ${
              activeTab === "exercises"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
          >
            💪 Manage Exercises
          </button>
          <button
            onClick={() => setActiveTab("assignments")}
            className={`w-full text-left px-4 py-3 rounded transition ${
              activeTab === "assignments"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
          >
            🔗 Assign Patients
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
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
                        diagnosis: "",
                        prescription: "",
                        condition: "",
                        therapistIDNum: "",
                        specialty: ""
                      });
                    }
                  }
                }}
                className={`px-4 py-2 rounded transition text-white ${
                  editingUserId
                    ? "bg-gray-600 hover:bg-gray-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {editingUserId ? "Cancel Edit" : showUserForm ? "Cancel" : "+ Add User"}
              </button>
            </div>

            {showUserForm && !editingUserId && (
              <div className="bg-white p-6 rounded shadow mb-6">
                <h3 className="text-xl font-semibold mb-4">Add New User</h3>
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
                            className="w-full p-4 border-2 border-gray-300 rounded hover:border-blue-500 hover:bg-blue-50 transition text-left font-medium"
                          >
                            👤 Patient
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRole("therapist");
                              setNewUser({ ...newUser, role: "therapist" });
                            }}
                            className="w-full p-4 border-2 border-gray-300 rounded hover:border-blue-500 hover:bg-blue-50 transition text-left font-medium"
                          >
                            👨‍⚕️ Therapist
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4 pb-4 border-b">
                        <h4 className="text-lg font-semibold">
                          {selectedRole === "patient" ? "👤 Patient Information" : "👨‍⚕️ Therapist Information"}
                        </h4>
                        <button
                          type="button"
                          onClick={() => setSelectedRole(null)}
                          className="text-sm text-blue-600 hover:text-blue-800"
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
                            onChange={(e) => setNewUser({ ...newUser, dateOfBirth: e.target.value })}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            max={new Date().toISOString().split('T')[0]}
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
                            value={newUser.age || ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value.length <= 3) {
                                setNewUser({ ...newUser, age: value ? parseInt(value) : undefined });
                              }
                            }}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            min="0"
                            max="150"
                            required
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
                              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Diagnosis <span className="text-red-500">*</span>
                            </label>
                            <textarea
                              value={newUser.diagnosis || ""}
                              onChange={(e) => setNewUser({ ...newUser, diagnosis: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              rows={4}
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Prescription <span className="text-red-500">*</span>
                            </label>
                            <textarea
                              value={newUser.prescription || ""}
                              onChange={(e) => setNewUser({ ...newUser, prescription: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              rows={4}
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Condition <span className="text-red-500">*</span>
                            </label>
                            <textarea
                              value={newUser.condition || ""}
                              onChange={(e) => setNewUser({ ...newUser, condition: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              rows={4}
                              required
                            />
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
                              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                              className="w-full border border-gray-300 rounded px-3 py-2"
                              required
                            />
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
                        className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
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
              <div className="bg-white p-6 rounded shadow mb-6 border-l-4 border-yellow-500">
                <h3 className="text-xl font-semibold mb-4">Edit User Details</h3>
                <form onSubmit={handleSaveEditUser} className="space-y-4">
                  <h4 className="text-lg font-semibold">
                    {editingUser.role === "patient" ? "👤 Patient Information" : "👨‍⚕️ Therapist Information"}
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
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, dateOfBirth: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        max={new Date().toISOString().split('T')[0]}
                        min="1900-01-01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Age
                      </label>
                      <input
                        type="number"
                        value={editingUser.age || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value.length <= 3) {
                            setEditingUser({ ...editingUser, age: value ? parseInt(value) : undefined });
                          }
                        }}
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        min="0"
                        max="150"
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
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, email: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Diagnosis
                        </label>
                        <textarea
                          value={editingUser.diagnosis || ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, diagnosis: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          rows={4}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Prescription
                        </label>
                        <textarea
                          value={editingUser.prescription || ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, prescription: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          rows={4}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Condition
                        </label>
                        <textarea
                          value={editingUser.condition || ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, condition: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          rows={4}
                        />
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
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, email: e.target.value })
                          }
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
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
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
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

            {statusMessage && (
              <div className={`mb-4 rounded-lg border p-3 text-sm transition-opacity duration-300 ${statusVisible ? "opacity-100" : "opacity-0"} ${statusType === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm" : "border-red-200 bg-red-50 text-red-900"}`} aria-live="polite">
                {statusMessage}
              </div>
            )}

            {isDeleteModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <h3 className="text-xl font-semibold text-gray-900">Confirm Delete</h3>
                  <p className="mt-3 text-sm text-gray-600">
                    Are you sure you want to delete <span className="font-semibold text-gray-900">{deleteUserName}</span>?
                    This action cannot be undone.
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={closeDeleteModal}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeleteUser}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Users List */}
            <div className="bg-white rounded shadow overflow-hidden">
              <table className="w-full">
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
                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditUser(u)}
                            className="text-blue-600 hover:text-blue-800 font-medium"
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
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
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
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
                          className="w-full border border-gray-300 rounded px-3 py-2 mb-4"
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
                          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded transition font-medium"
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
              <div className="bg-white rounded shadow overflow-hidden">
                <table className="w-full">
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
          </div>
        )}
      </main>
    </div>
  );
}
