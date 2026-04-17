"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

type Tab = "users" | "exercises" | "assignments";

interface User {
  id: string;
  name: string;
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
  duration: number;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([
    { id: "patient_001", name: "John Patient", email: "patient@example.com", role: "patient", therapistId: "therapist_001" },
    { id: "patient_002", name: "Jane Patient", email: "jane.patient@example.com", role: "patient", therapistId: "therapist_001" },
    { id: "patient_003", name: "Mike Patient", email: "mike.patient@example.com", role: "patient", therapistId: "therapist_001" },
    { id: "therapist_001", name: "Sarah Therapist", email: "therapist@clinic.com", role: "therapist" },
  ]);
  const [exercises, setExercises] = useState<Exercise[]>([
    {
      id: "ex_001",
      name: "Lateral Arm Raises",
      description: "Raise arms to the side at shoulder height. Improves shoulder strength and posture.",
      duration: 30,
    },
    {
      id: "ex_002",
      name: "Overhead Arm Raises",
      description: "Raise arms straight up overhead. Strengthens shoulders and improves upper back flexibility.",
      duration: 30,
    },
    {
      id: "ex_003",
      name: "Shoulder Shrugs",
      description: "Lift shoulders towards ears and release. Relieves tension and strengthens trapezius.",
      duration: 20,
    },
    {
      id: "ex_004",
      name: "Neck Lateral Flexion",
      description: "Bend neck to each side gently. Improves neck flexibility and reduces stiffness.",
      duration: 25,
    },
    {
      id: "ex_005",
      name: "Standing Side Bends",
      description: "Bend torso to the side while standing. Strengthens obliques and improves spinal mobility.",
      duration: 35,
    },
    {
      id: "ex_006",
      name: "Arm Abduction at 90°",
      description: "Raise arms to 90 degrees from body. Targets shoulder stability and strength.",
      duration: 30,
    },
  ]);

  // User form state
  const [selectedRole, setSelectedRole] = useState<"patient" | "therapist" | null>(null);
  const [newUser, setNewUser] = useState<Partial<User>>({ 
    name: "", 
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

  // Assignment state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedTherapistId, setSelectedTherapistId] = useState<string | null>(null);

  // Exercise form state
  const [newExercise, setNewExercise] = useState<{
    name: string;
    description: string;
    duration: number;
  }>({
    name: "",
    description: "",
    duration: 30,
  });
  const [showExerciseForm, setShowExerciseForm] = useState(false);

  // Initialize and persist users data to localStorage
  useEffect(() => {
    // Load from localStorage if exists, otherwise use initial state
    const storedUsers = localStorage.getItem("admin_users");
    if (storedUsers) {
      try {
        setUsers(JSON.parse(storedUsers));
      } catch (error) {
        console.error("Error loading users from storage:", error);
      }
    } else {
      // Initialize localStorage with initial users on first load
      localStorage.setItem("admin_users", JSON.stringify(users));
    }
  }, []); // Only run on mount

  // Persist users data to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("admin_users", JSON.stringify(users));
  }, [users]);

  // Initialize and persist exercises data to localStorage
  useEffect(() => {
    const storedExercises = localStorage.getItem("admin_exercises");
    if (storedExercises) {
      try {
        setExercises(JSON.parse(storedExercises));
      } catch (error) {
        console.error("Error loading exercises from storage:", error);
      }
    } else {
      // Initialize localStorage with initial exercises on first load
      localStorage.setItem("admin_exercises", JSON.stringify(exercises));
    }
  }, []); // Only run on mount

  // Persist exercises data to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("admin_exercises", JSON.stringify(exercises));
  }, [exercises]);

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.role) return;

    // Validate role-specific required fields
    if (newUser.role === "patient") {
      if (!newUser.email || !newUser.dateOfBirth || !newUser.age || !newUser.gender || !newUser.diagnosis || !newUser.prescription || !newUser.condition) return;
    } else if (newUser.role === "therapist") {
      if (!newUser.dateOfBirth || !newUser.age || !newUser.gender || !newUser.therapistIDNum || !newUser.specialty) return;
    }

    const user: User = {
      id: `user_${Date.now()}`,
      name: newUser.name!,
      email: newUser.email,
      role: newUser.role as "patient" | "therapist",
      dateOfBirth: newUser.dateOfBirth,
      age: newUser.age,
      gender: newUser.gender,
      diagnosis: newUser.diagnosis,
      prescription: newUser.prescription,
      condition: newUser.condition,
      therapistIDNum: newUser.therapistIDNum,
      specialty: newUser.specialty,
    };
    setUsers([...users, user]);
    setNewUser({ 
      name: "", 
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
    setSelectedRole(null);
    setShowUserForm(false);
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    setUsers(users.filter((u) => u.id !== id));
  };

  const handleEditUser = (user: User) => {
    setEditingUser({ ...user });
    setEditingUserId(user.id);
    setShowUserForm(false);
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !editingUser.name) return;

    setUsers(
      users.map((u) => (u.id === editingUserId ? editingUser : u))
    );
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditingUser(null);
  };

  const handleAssignPatient = () => {
    if (!selectedPatientId || !selectedTherapistId) return;

    setUsers(
      users.map((u) =>
        u.id === selectedPatientId ? { ...u, therapistId: selectedTherapistId } : u
      )
    );
    setSelectedPatientId(null);
    setSelectedTherapistId(null);
  };

  const handleUnassignPatient = (patientId: string) => {
    setUsers(
      users.map((u) =>
        u.id === patientId ? { ...u, therapistId: undefined } : u
      )
    );
  };

  const handleAddExercise = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExercise.name || !newExercise.description) return;

    const exercise: Exercise = {
      id: `ex_${Date.now()}`,
      ...newExercise,
    };
    setExercises([...exercises, exercise]);
    setNewExercise({ name: "", description: "", duration: 30 });
    setShowExerciseForm(false);
  };

  const handleDeleteExercise = (id: string) => {
    setExercises(exercises.filter((e) => e.id !== id));
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
                        name: "",
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
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Full Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={newUser.name || ""}
                          onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                          required
                        />
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
                            onChange={(e) => setNewUser({ ...newUser, age: e.target.value ? parseInt(e.target.value) : undefined })}
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
                          <option value="other">Other</option>
                          <option value="prefer-not-to-say">Prefer Not To Say</option>
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
                              Therapist ID <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={newUser.therapistIDNum || ""}
                              onChange={(e) => setNewUser({ ...newUser, therapistIDNum: e.target.value })}
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={editingUser.name}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, name: e.target.value })
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2"
                      required
                    />
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
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Age
                      </label>
                      <input
                        type="number"
                        value={editingUser.age || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, age: e.target.value ? parseInt(e.target.value) : undefined })
                        }
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
                      <option value="other">Other</option>
                      <option value="prefer-not-to-say">Prefer Not To Say</option>
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
                          Therapist ID
                        </label>
                        <input
                          type="text"
                          value={editingUser.therapistIDNum || ""}
                          onChange={(e) =>
                            setEditingUser({ ...editingUser, therapistIDNum: e.target.value })
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
                            onClick={() => handleDeleteUser(u.id)}
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

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Duration (seconds)
                      </label>
                      <input
                        type="number"
                        value={newExercise.duration}
                        onChange={(e) =>
                          setNewExercise({
                            ...newExercise,
                            duration: parseInt(e.target.value),
                          })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                        min="1"
                        required
                      />
                    </div>

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

                  <div className="flex justify-between items-center mb-4">
                    <div className="text-sm text-gray-500">
                      <span className="block">⏱ {ex.duration}s</span>
                    </div>
                  </div>

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
            {assignedPatients.length > 0 && (
              <div className="mt-8">
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">Currently Assigned Patients</h3>
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
                      {assignedPatients.map((patient) => (
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
