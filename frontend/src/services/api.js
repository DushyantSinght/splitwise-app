import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');

// Groups
export const getGroups = () => api.get('/groups');
export const createGroup = (data) => api.post('/groups', data);
export const getGroup = (id) => api.get(`/groups/${id}`);
export const addMember = (groupId, data) => api.post(`/groups/${groupId}/members`, data);
export const removeMember = (groupId, userId, data) => api.delete(`/groups/${groupId}/members/${userId}`, { data });
export const getBalances = (groupId) => api.get(`/groups/${groupId}/balances`);

// Expenses
export const getExpenses = (groupId, params) => api.get(`/groups/${groupId}/expenses`, { params });
export const createExpense = (groupId, data) => api.post(`/groups/${groupId}/expenses`, data);
export const updateExpense = (id, data) => api.put(`/expenses/${id}`, data);
export const deleteExpense = (id) => api.delete(`/expenses/${id}`);
export const getMemberExpenses = (groupId, userId) => api.get(`/groups/${groupId}/members/${userId}/expenses`);
export const recordSettlement = (groupId, data) => api.post(`/groups/${groupId}/settlements`, data);

// Import
export const importCSV = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const getImportReport = (batchId) => api.get(`/import/${batchId}/report`);
export const getPendingReviews = () => api.get('/import/reviews/pending');
export const resolveReview = (id, decision) => api.patch(`/import/reviews/${id}`, { decision });

export default api;
