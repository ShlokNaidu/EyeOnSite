import React, { useState, useEffect } from 'react';
import { getAdminUsers, getAdminSites, createAdminUser, deleteAdminUser, createAdminSite, deleteAdminSite } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Users, UserPlus, Building, Trash2, Mail, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import ConfirmDialog from '../components/ConfirmDialog';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteUserConfirm, setDeleteUserConfirm] = useState({ open: false, id: null });
  const [deleteSiteConfirm, setDeleteSiteConfirm] = useState({ open: false, id: null });
  
  // Forms
  const [showUserForm, setShowUserForm] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  
  const [userForm, setUserForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'site_officer',
    site_id: ''
  });
  
  const [siteForm, setSiteForm] = useState({
    name: '',
    address: ''
  });

  const { t } = useLanguage();
  const { isAdmin, isSuperAdmin } = useAuth();

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin]);

  async function loadData() {
    setLoading(true);
    try {
      const [usersRes, sitesRes] = await Promise.all([
        getAdminUsers(),
        getAdminSites()
      ]);
      setUsers(usersRes.data || []);
      setSites(sitesRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    }
    setLoading(false);
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setError('');
    try {
      if (userForm.role === 'site_officer' && !userForm.site_id) {
        throw new Error('Please select a site for the Site Officer');
      }
      await createAdminUser(userForm);
      setShowUserForm(false);
      setUserForm({ email: '', password: '', fullName: '', role: 'site_officer', site_id: '' });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateSite(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await createAdminSite(siteForm);
      setShowSiteForm(false);
      setSiteForm({ name: '', address: '' });
      await loadData();
      // Auto-select the new site in user form
      setUserForm(prev => ({ ...prev, site_id: res.data.site_id }));
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDeleteUser(userId) {
    setDeleteUserConfirm({ open: true, id: userId });
  }

  async function doDeleteUser() {
    const userId = deleteUserConfirm.id;
    setDeleteUserConfirm({ open: false, id: null });
    try {
      await deleteAdminUser(userId);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDeleteSite(siteId) {
    setDeleteSiteConfirm({ open: true, id: siteId });
  }

  async function doDeleteSite() {
    const siteId = deleteSiteConfirm.id;
    setDeleteSiteConfirm({ open: false, id: null });
    try {
      await deleteAdminSite(siteId);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!isAdmin) {
    return <div className="p-6 text-red-500">Access Denied. Admins only.</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Users className="w-6 h-6 text-sky-500" />
          User Management
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowSiteForm(true); setShowUserForm(false); }}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg transition-colors border border-slate-300"
          >
            <Building className="w-4 h-4" /> Create Site
          </button>
          <button
            onClick={() => { setShowUserForm(true); setShowSiteForm(false); }}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Create User
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-600 p-3 rounded-lg mb-6 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" /> {error}
        </div>
      )}

      {/* Forms Area */}
      {showSiteForm && (
        <form onSubmit={handleCreateSite} className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-sm max-w-2xl">
          <h2 className="text-lg font-semibold mb-4 text-slate-700">Create New Site</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Site Name *</label>
              <input required type="text" value={siteForm.name} onChange={e => setSiteForm({...siteForm, name: e.target.value})} className="w-full border rounded px-3 py-2" placeholder="e.g. North Factory" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Location Details</label>
              <input type="text" value={siteForm.address} onChange={e => setSiteForm({...siteForm, address: e.target.value})} className="w-full border rounded px-3 py-2" placeholder="e.g. Sector 5 Industrial Area" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowSiteForm(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-sky-500 text-white rounded hover:bg-sky-600">Save Site</button>
          </div>
        </form>
      )}

      {showUserForm && (
        <form onSubmit={handleCreateUser} className="bg-white border border-sky-200 rounded-lg p-5 mb-6 shadow-sm max-w-3xl">
          <h2 className="text-lg font-semibold mb-4 text-slate-700">Create New User</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Full Name *</label>
              <input required type="text" value={userForm.fullName} onChange={e => setUserForm({...userForm, fullName: e.target.value})} className="w-full border rounded px-3 py-2" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Email * (Login ID)</label>
              <input required type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} className="w-full border rounded px-3 py-2" placeholder="john@example.com" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Password *</label>
              <input required type="text" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} className="w-full border rounded px-3 py-2" placeholder="At least 6 chars" minLength={6} />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Role *</label>
              <select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} className="w-full border rounded px-3 py-2 bg-white">
                <option value="site_officer">Site Officer (Assigned to one site)</option>
                {isSuperAdmin && <option value="admin">Admin (Can manage sub-users & sites)</option>}
              </select>
            </div>
            
            {userForm.role === 'site_officer' && (
              <div className="md:col-span-2">
                <label className="block text-sm text-slate-600 mb-1">Assign to Site *</label>
                <div className="flex gap-2">
                  <select required value={userForm.site_id} onChange={e => setUserForm({...userForm, site_id: e.target.value})} className="flex-1 border rounded px-3 py-2 bg-white">
                    <option value="">-- Select a Site --</option>
                    {sites.map(s => (
                      <option key={s.site_id} value={s.site_id}>{s.name} ({s.site_id})</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setShowSiteForm(true); setShowUserForm(false); }} className="px-3 py-2 bg-slate-100 text-slate-600 border rounded hover:bg-slate-200">
                    + New Site
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowUserForm(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-sky-500 text-white rounded hover:bg-sky-600">Create Account</button>
          </div>
        </form>
      )}

      {/* Users List */}
      <h2 className="text-lg font-semibold mb-4 text-slate-700 mt-8">Your Managed Users</h2>
      {loading ? (
        <div className="text-slate-500">Loading users...</div>
      ) : users.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center text-slate-500">
          No users found. Create your first site and site officer to begin.
        </div>
      ) : (
        <div className="bg-white border text-sm rounded-lg overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-3 font-medium text-slate-600">Name</th>
                <th className="p-3 font-medium text-slate-600">Role</th>
                <th className="p-3 font-medium text-slate-600">Site</th>
                <th className="p-3 font-medium text-slate-600">Joined</th>
                <th className="p-3 font-medium text-slate-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u._id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-medium text-slate-800">{u.fullName}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><Mail className="w-3 h-3"/> {u.email}</div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {u.role === 'admin' ? 'Admin' : 'Site Officer'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">
                    {u.role === 'admin' ? <span className="text-slate-400 italic">Hierarchical</span> : u.siteName || <span className="text-red-400">Unassigned</span>}
                  </td>
                  <td className="p-3 text-slate-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeleteUser(u._id)} className="text-red-400 hover:text-red-600 p-1" title="Delete User">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sites List */}
      <h2 className="text-lg font-semibold mb-4 text-slate-700 mt-8">Your Managed Sites</h2>
      {loading ? (
        <div className="text-slate-500">Loading sites...</div>
      ) : sites.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center text-slate-500 mb-8">
          No sites found.
        </div>
      ) : (
        <div className="bg-white border text-sm rounded-lg overflow-hidden shadow-sm mb-8">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="p-3 font-medium text-slate-600">Site ID</th>
                <th className="p-3 font-medium text-slate-600">Name</th>
                <th className="p-3 font-medium text-slate-600">Address</th>
                <th className="p-3 font-medium text-slate-600">Created At</th>
                <th className="p-3 font-medium text-slate-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y border-t border-slate-200">
              {sites.map(s => (
                <tr key={s._id} className="hover:bg-slate-50">
                  <td className="p-3 text-slate-500 font-mono text-xs">{s.site_id}</td>
                  <td className="p-3 font-medium text-slate-800">{s.name}</td>
                  <td className="p-3 text-slate-600">{s.address || <span className="text-slate-400 italic">None provided</span>}</td>
                  <td className="p-3 text-slate-500">
                    {new Date(s.created_at || s.createdAt || Date.now()).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeleteSite(s.site_id)} className="text-red-400 hover:text-red-600 p-1" title="Delete Site">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteUserConfirm.open}
        title="Delete this user?"
        message="This will permanently remove the user account. They will no longer be able to log in."
        onConfirm={doDeleteUser}
        onCancel={() => setDeleteUserConfirm({ open: false, id: null })}
      />
      <ConfirmDialog
        isOpen={deleteSiteConfirm.open}
        title="Delete this site?"
        message="This will permanently delete the site and all associated cameras, zones, and users. This cannot be undone."
        onConfirm={doDeleteSite}
        onCancel={() => setDeleteSiteConfirm({ open: false, id: null })}
      />
    </div>
  );
}
